import { UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ResolvedLine } from "./line-resolver";
import { StockLedgerService } from "./stock-ledger.service";

/**
 * Integration (Postgres REAL) — F3-CORE-05: la transacción que mueve el stock.
 *
 * Es el corazón de la fase y la primera concurrencia real del proyecto. Nada
 * de esto se puede probar con mocks: lo que se verifica es qué hace Postgres
 * cuando dos transacciones pelean por la misma fila.
 *
 * Las tres propiedades que sostiene:
 *   1. **Nunca oversell.** Dos salidas simultáneas de 60 sobre 100 no pueden
 *      pasar las dos, aunque las dos lean 100 antes de escribir.
 *   2. **Nunca deadlock.** Dos transacciones que tocan A y B en orden cruzado
 *      terminan; el `FOR UPDATE` va SIEMPRE en el mismo orden determinista.
 *   3. **Reconciliación.** Tras N movimientos, el saldo es exactamente
 *      Σentradas − Σsalidas, y la suma por lote iguala al total.
 */
describe("StockLedgerService.apply (F3-CORE-05)", () => {
  let prisma: PrismaService;
  let ledger: StockLedgerService;
  let tenantId: string;
  let userId: string;
  let productAId: string;
  let productBId: string;
  let loteadoId: string;
  let warehouseId: string;
  let documentId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    ledger = new StockLedgerService();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant ledger ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email: `ledger-${stamp}@example.com`,
          firstName: "L",
          lastNamePaternal: "G",
        },
      });
      const [a, b, loteado] = await Promise.all([
        tx.product.create({ data: { tenantId, sku: `LA-${stamp}`, name: "Producto A" } }),
        tx.product.create({ data: { tenantId, sku: `LB-${stamp}`, name: "Producto B" } }),
        tx.product.create({
          data: { tenantId, sku: `LL-${stamp}`, name: "Con lotes", tracksLots: true },
        }),
      ]);
      const warehouse = await tx.warehouse.create({
        data: { tenantId, name: `Central ledger ${stamp}` },
      });
      const document = await tx.inventoryDocument.create({
        data: {
          tenantId,
          folio: "ENT-000001",
          type: "entry",
          status: "confirmed",
          warehouseId: warehouse.id,
          reasonCode: "invoice",
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: new Date(),
        },
      });

      userId = user.id;
      productAId = a.id;
      productBId = b.id;
      loteadoId = loteado.id;
      warehouseId = warehouse.id;
      documentId = document.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const linea = (
    productId: string,
    qty: number,
    extra: Partial<ResolvedLine> = {},
  ): ResolvedLine => ({
    lineIndex: 0,
    productId,
    sku: "X",
    presentationId: null,
    quantityBase: new Prisma.Decimal(qty),
    quantityInput: new Prisma.Decimal(qty),
    unitCost: null,
    expand: false,
    ...extra,
  });

  const apply = (
    direction: "entry" | "exit",
    lines: ResolvedLine[],
    reasonCode: "invoice" | "adjustment" | "loss" = direction === "entry" ? "invoice" : "loss",
    wh = warehouseId,
  ) =>
    prisma.withTenantContext(tenantId, (tx) =>
      ledger.apply(tx, {
        tenantId,
        userId,
        direction,
        reasonCode,
        warehouseId: wh,
        lines,
        header: { documentId },
      }),
    );

  const saldo = async (productId: string, wh = warehouseId) => {
    const row = await prisma.withTenantContext(tenantId, (tx) =>
      tx.stockByWarehouse.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: wh } },
      }),
    );
    return row === null ? null : new Prisma.Decimal(row.quantity.toString()).toNumber();
  };

  describe("lo básico", () => {
    it("el primer movimiento sobre un producto sin fila la crea", async () => {
      expect(await saldo(productAId)).toBeNull();

      await apply("entry", [linea(productAId, 100)]);

      expect(await saldo(productAId)).toBe(100);
    });

    it("una salida descuenta", async () => {
      await apply("exit", [linea(productAId, 30)]);

      expect(await saldo(productAId)).toBe(70);
    });

    it("dos líneas del MISMO producto se suman antes de validar, no se validan por separado", async () => {
      await apply("entry", [linea(productBId, 10), { ...linea(productBId, 5), lineIndex: 1 }]);

      expect(await saldo(productBId)).toBe(15);
      // Pero se asientan DOS movimientos: el kardex tiene que mostrar las dos
      // líneas que el usuario capturó, no una fusionada.
      const count = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockMovement.count({ where: { productId: productBId } }),
      );
      expect(count).toBe(2);
    });

    it("salir de más se rechaza diciendo cuánto hay y cuánto se pidió", async () => {
      await expect(apply("exit", [linea(productBId, 999)])).rejects.toMatchObject({
        response: {
          message: "inventory.insufficient_stock",
          args: expect.objectContaining({ available: "15", requested: "999" }),
        },
      });

      expect(await saldo(productBId)).toBe(15);
    });
  });

  describe("concurrencia — lo que ningún mock puede probar", () => {
    /**
     * EL test de la tarea. Las dos transacciones leen 100 antes de que
     * cualquiera escriba. Sin `FOR UPDATE` las dos verían saldo suficiente y
     * el almacén quedaría en −20: vendimos algo que no teníamos.
     */
    it("dos salidas simultáneas de 60 sobre 100: una pasa, la otra 422, saldo 40", async () => {
      const producto = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({
          data: { tenantId, sku: `RACE-${Date.now()}`, name: "Disputado" },
        }),
      );
      await apply("entry", [linea(producto.id, 100)]);

      const intentos = await Promise.allSettled([
        apply("exit", [linea(producto.id, 60)]),
        apply("exit", [linea(producto.id, 60)]),
      ]);

      expect(intentos.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(intentos.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(await saldo(producto.id)).toBe(40);
    });

    /**
     * Dos transacciones que toman (A,B) y (B,A) se bloquean mutuamente para
     * siempre. Por eso el `FOR UPDATE` ordena SIEMPRE por (product_id,
     * warehouse_id): las dos piden en el mismo orden y una espera a la otra.
     */
    it("dos transacciones con productos en orden cruzado no se traban", async () => {
      await apply("entry", [linea(productAId, 50), { ...linea(productBId, 50), lineIndex: 1 }]);

      const resultados = await Promise.allSettled([
        apply("exit", [linea(productAId, 1), { ...linea(productBId, 1), lineIndex: 1 }]),
        apply("exit", [linea(productBId, 1), { ...linea(productAId, 1), lineIndex: 1 }]),
      ]);

      expect(resultados.every((r) => r.status === "fulfilled")).toBe(true);
    });
  });

  describe("lotes", () => {
    it("una entrada con lote mueve el total Y el saldo del lote", async () => {
      const lot = await prisma.withTenantContext(tenantId, (tx) =>
        tx.productLot.create({
          data: { tenantId, productId: loteadoId, lotCode: `st-${Date.now()}` },
        }),
      );

      await apply("entry", [linea(loteadoId, 20, { lotId: lot.id, location: "" })]);

      const stockLot = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockLot.findUnique({
          where: {
            lotId_warehouseId_location: { lotId: lot.id, warehouseId, location: "" },
          },
        }),
      );
      expect(await saldo(loteadoId)).toBe(20);
      expect(Number(stockLot?.quantity)).toBe(20);
    });

    it("una salida que excede el saldo DEL LOTE se rechaza aunque el total alcance", async () => {
      const [a, b] = await prisma.withTenantContext(tenantId, async (tx) => [
        await tx.productLot.create({
          data: { tenantId, productId: loteadoId, lotCode: `sa-${Date.now()}` },
        }),
        await tx.productLot.create({
          data: { tenantId, productId: loteadoId, lotCode: `sb-${Date.now()}` },
        }),
      ]);
      await apply("entry", [
        linea(loteadoId, 10, { lotId: a.id, location: "" }),
        { ...linea(loteadoId, 10, { lotId: b.id, location: "" }), lineIndex: 1 },
      ]);

      // El total tiene de sobra, pero ese lote no.
      await expect(
        apply("exit", [linea(loteadoId, 15, { lotId: a.id, location: "" })], "loss"),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  /**
   * LA propiedad central de la fase, y la razón por la que el ledger es un
   * solo servicio: después de N movimientos cualesquiera, el saldo TIENE que
   * ser exactamente la suma de lo que entró menos lo que salió. Si alguna vez
   * deja de cumplirse, el inventario dejó de ser confiable y ningún reporte
   * lo va a delatar.
   */
  it("reconciliación: tras N movimientos, saldo == Σentradas − Σsalidas", async () => {
    const producto = await prisma.withTenantContext(tenantId, (tx) =>
      tx.product.create({ data: { tenantId, sku: `REC-${Date.now()}`, name: "Reconciliado" } }),
    );

    const guion: ["entry" | "exit", number][] = [
      ["entry", 100],
      ["exit", 30],
      ["entry", 45],
      ["exit", 12],
      ["entry", 7],
      ["exit", 60],
    ];
    for (const [direction, qty] of guion) {
      await apply(direction, [linea(producto.id, qty)]);
    }

    const movimientos = await prisma.withTenantContext(tenantId, (tx) =>
      tx.stockMovement.findMany({ where: { productId: producto.id } }),
    );
    const esperado = movimientos.reduce(
      (acc, m) =>
        m.direction === "entry"
          ? acc.plus(new Prisma.Decimal(m.quantity.toString()))
          : acc.minus(new Prisma.Decimal(m.quantity.toString())),
      new Prisma.Decimal(0),
    );

    expect(await saldo(producto.id)).toBe(esperado.toNumber());
    expect(await saldo(producto.id)).toBe(50);
  });
});
