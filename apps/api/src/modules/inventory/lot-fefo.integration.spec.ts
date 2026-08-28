import { ConfigService } from "@nestjs/config";
import type { MovementReason } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ResolvedLine } from "./line-resolver";
import { resolveLotsFefo } from "./lot-fefo";

/**
 * Integration (Postgres real) — F3-CORE-08: FEFO, *First Expired First Out*.
 *
 * Nace del pedido concreto de Carlos sobre un Excel real de cliente: el
 * producto KY6 con lotes st30, st10 y st60, y el requisito **"al vender, tiene
 * que restar del que vence el 01/07 y dejar el stock en 9"**. Ese ejemplo es
 * literalmente el primer test de abajo.
 *
 * Vive en el LEDGER y no en el POS a propósito: así la venta de F4 lo hereda
 * sin pedirle nada al cajero, y una salida por merma o un traspaso siguen la
 * misma regla que una venta.
 */
describe("resolveLotsFefo (F3-CORE-08)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let productId: string;
  let warehouseId: string;
  let st30: string;
  let st10: string;
  let st60: string;
  let sinFecha: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant fefo ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const product = await tx.product.create({
        data: { tenantId, sku: `KY6-${stamp}`, name: "KY6 TABLETA", tracksLots: true },
      });
      const warehouse = await tx.warehouse.create({
        data: { tenantId, name: `Central fefo ${stamp}` },
      });

      const lote = async (lotCode: string, expiresAt: string | null, quantity: number) => {
        const lot = await tx.productLot.create({
          data: {
            tenantId,
            productId: product.id,
            lotCode: `${lotCode}-${stamp}`,
            expiresAt: expiresAt === null ? null : new Date(expiresAt),
          },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId: warehouse.id, location: "", quantity },
        });
        return lot.id;
      };

      // El Excel del cliente, tal cual.
      st30 = await lote("st30", "2026-10-01", 20);
      st10 = await lote("st10", "2026-07-01", 10);
      st60 = await lote("st60", "2026-12-01", 1);
      sinFecha = await lote("sinfecha", null, 100);

      productId = product.id;
      warehouseId = warehouse.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const linea = (qty: number, extra: Partial<ResolvedLine> = {}): ResolvedLine => ({
    lineIndex: 0,
    productId,
    sku: "KY6",
    presentationId: null,
    quantityBase: new Prisma.Decimal(qty),
    quantityInput: new Prisma.Decimal(qty),
    unitCost: null,
    expand: false,
    ...extra,
  });

  const fefo = (lines: ResolvedLine[], reasonCode?: MovementReason) =>
    prisma.withTenantContext(tenantId, (tx) =>
      resolveLotsFefo(tx, tenantId, warehouseId, lines, reasonCode),
    );

  it("el ejemplo de Carlos: salida de 1 sale del lote que vence el 01/07", async () => {
    const result = await fefo([linea(1)]);

    expect(result).toHaveLength(1);
    expect(result[0]?.lotId).toBe(st10);
    expect(result[0]?.quantityBase.toString()).toBe("1");
  });

  /**
   * Una línea del usuario se puede volver N movimientos: pedir 12 cuando el
   * lote más próximo tiene 10 significa vaciar ese y seguir con el siguiente.
   * El usuario pidió "12", no "10 de acá y 2 de allá" — el reparto es del
   * sistema.
   */
  it("si el primer lote no alcanza, sigue por el que vence después", async () => {
    const result = await fefo([linea(12)]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ lotId: st10 });
    expect(result[0]?.quantityBase.toString()).toBe("10");
    expect(result[1]).toMatchObject({ lotId: st30 });
    expect(result[1]?.quantityBase.toString()).toBe("2");
  });

  it("un lote SIN caducidad va al final: lo que vence manda", async () => {
    // 31 = 10 (st10) + 20 (st30) + 1 (st60); el sin fecha recién después.
    const result = await fefo([linea(32)]);

    expect(result.map((r) => r.lotId)).toEqual([st10, st30, st60, sinFecha]);
    expect(result[3]?.quantityBase.toString()).toBe("1");
  });

  it("forzar un lote lo respeta: el usuario puede saber algo que el sistema no", async () => {
    const result = await fefo([linea(5, { lotId: st30, location: "" })]);

    expect(result).toHaveLength(1);
    expect(result[0]?.lotId).toBe(st30);
  });

  it("pedir más de lo que hay en TODOS los lotes se rechaza", async () => {
    await expect(fefo([linea(9999)])).rejects.toMatchObject({
      response: { message: "inventory.insufficient_stock" },
    });
  });

  it("un producto sin lotes pasa de largo sin tocar nada", async () => {
    const simple = await prisma.withTenantContext(tenantId, (tx) =>
      tx.product.create({ data: { tenantId, sku: `SIN-${Date.now()}`, name: "Sin lotes" } }),
    );

    const result = await fefo([linea(3, { productId: simple.id })]);

    expect(result).toHaveLength(1);
    expect(result[0]?.lotId).toBeUndefined();
  });

  it("cada sublínea conserva el índice de la línea original que la generó", async () => {
    const result = await fefo([linea(12)]);

    expect(result.every((r) => r.lineIndex === 0)).toBe(true);
  });

  /**
   * "No puedes vender un producto vencido" (Carlos, 2026-08-20).
   *
   * El agujero era silencioso y peor que un error: FEFO ordena por caducidad
   * ASCENDENTE, así que el lote VENCIDO era literalmente el PRIMERO que
   * elegía. El sistema no es que permitiera vender caducado — es que lo
   * prefería.
   *
   * El bloqueo se aplica SOLO a los motivos de `REASONS_REJECTING_EXPIRED_LOTS`.
   * `expired`, `loss`, `adjustment`, `physical_count` y `transfer` siguen
   * pudiendo mover lo vencido, o la mercancía caducada quedaría encerrada en el
   * sistema sin forma de darla de baja ni de cuadrar un conteo.
   */
  describe("Un lote vencido no se vende", () => {
    /** `st10` vence el 01/07/2026: para hoy ya es pasado. */
    it("con motivo `sale` FEFO salta el vencido y toma el siguiente", async () => {
      const result = await fefo([linea(1)], "sale");

      expect(result).toHaveLength(1);
      expect(result[0]?.lotId).toBe(st30);
      expect(result[0]?.lotId).not.toBe(st10);
    });

    it("con motivo `expired` sigue tomando el vencido: es justo para lo que existe", async () => {
      const result = await fefo([linea(1)], "expired");

      expect(result[0]?.lotId).toBe(st10);
    });

    it("con motivo `transfer` también lo toma: Carlos lo dejó fuera del bloqueo", async () => {
      const result = await fefo([linea(1)], "transfer");

      expect(result[0]?.lotId).toBe(st10);
    });

    /**
     * El mensaje importa tanto como el bloqueo. "No hay stock" con doce cajas
     * en el anaquel hace que la persona concluya que el sistema está roto.
     */
    it("si TODO el stock está vencido, el error dice que está vencido y no que falta", async () => {
      const stamp = Date.now();
      const { otroProducto, otroAlmacen } = await prisma.withTenantContext(tenantId, async (tx) => {
        const product = await tx.product.create({
          data: { tenantId, sku: `CAD-${stamp}`, name: "Todo vencido", tracksLots: true },
        });
        const warehouse = await tx.warehouse.create({
          data: { tenantId, name: `Cad ${stamp}` },
        });
        const lot = await tx.productLot.create({
          data: {
            tenantId,
            productId: product.id,
            lotCode: `viejo-${stamp}`,
            expiresAt: new Date("2020-01-01"),
          },
        });
        await tx.stockLot.create({
          data: {
            tenantId,
            lotId: lot.id,
            warehouseId: warehouse.id,
            location: "",
            quantity: 12,
          },
        });
        return { otroProducto: product.id, otroAlmacen: warehouse.id };
      });

      const lineas = [linea(3, { productId: otroProducto, sku: "CAD" })];

      await expect(
        prisma.withTenantContext(tenantId, (tx) =>
          resolveLotsFefo(tx, tenantId, otroAlmacen, lineas, "sale"),
        ),
      ).rejects.toMatchObject({
        response: {
          message: "inventory.expired_stock_not_sellable",
          args: expect.objectContaining({ expired: "12" }),
        },
      });
    });
  });

  describe("allowNegative (F7-POS-01) — vender sin stock asienta, no miente", () => {
    it("sin el flag, la regresión de F3/F4 sigue intacta: faltante lanza", async () => {
      await expect(fefo([linea(100000)])).rejects.toMatchObject({
        response: { message: "inventory.insufficient_stock" },
      });
    });

    it("con allowNegative el faltante no lanza: se suma al último lote elegido y el total pedido se respeta", async () => {
      const pedido = 100000;
      const result = await prisma.withTenantContext(tenantId, (tx) =>
        resolveLotsFefo(tx, tenantId, warehouseId, [linea(pedido)], undefined, {
          allowNegative: true,
        }),
      );

      const total = result.reduce((acc, l) => acc.plus(l.quantityBase), new Prisma.Decimal(0));
      expect(total.toString()).toBe(String(pedido));
      // El faltante quedó asignado a un lote REAL: el kardex por lote sigue
      // cuadrando con el saldo por almacén (Σ lots == by_warehouse).
      expect(result.every((l) => l.lotId !== undefined)).toBe(true);
    });
  });
});
