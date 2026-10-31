import { ConfigService } from "@nestjs/config";
import type { MovementReason } from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ResolvedLine } from "./line-resolver";
import { planLotsFefo, resolveLotsFefo } from "./lot-fefo";

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
        data: {
          tenantId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Central fefo ${stamp}`,
        },
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

      // El Excel del cliente, con st10 tal cual. st30 y st60 vencían con fecha
      // fija (2026-10-01 y 2026-12-01): desde el 2 de octubre st30 ya estaba
      // vencido y «un lote vencido no se vende» tomaba st60 (bomba de tiempo,
      // vista el 2026-10-21). Ahora vencen a 30 y 60 días de HOY: siempre
      // vigentes, siempre después de st10 y en el mismo orden.
      const enDias = (dias: number) =>
        new Date(stamp + dias * 86_400_000).toISOString().slice(0, 10);
      st30 = await lote("st30", enDias(30), 20);
      st10 = await lote("st10", "2026-07-01", 10);
      st60 = await lote("st60", enDias(60), 1);
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
          data: {
            tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: `Cad ${stamp}`,
          },
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

    /**
     * Antes el faltante se sumaba al ÚLTIMO lote del reparto y lo dejaba en
     * negativo. Desde «que salga Lo sin lote primero» (Carlos, 2026-10-31) el
     * faltante es saldo SIN lote: ningún lote queda debiendo lo que nunca tuvo.
     */
    it("con allowNegative el faltante no lanza: va SIN lote y ningún lote queda en negativo", async () => {
      const pedido = 100000;
      const result = await prisma.withTenantContext(tenantId, (tx) =>
        resolveLotsFefo(tx, tenantId, warehouseId, [linea(pedido)], undefined, {
          allowNegative: true,
        }),
      );

      const total = result.reduce((acc, l) => acc.plus(l.quantityBase), new Prisma.Decimal(0));
      expect(total.toString()).toBe(String(pedido));
      // Cada lote da a lo más lo que tiene: 10 + 20 + 1 + 100.
      expect(
        result.filter((l) => l.lotId !== undefined).map((l) => l.quantityBase.toString()),
      ).toEqual(["10", "20", "1", "100"]);
      // Este almacén no tiene residuo (no hay fila de saldo): lo que falta va
      // entero a una sola toma sin lote, la primera.
      expect(result[0]?.lotId).toBeUndefined();
      expect(result[0]?.quantityBase.toString()).toBe(String(pedido - 131));
      expect(result.filter((l) => l.lotId === undefined)).toHaveLength(1);
    });
  });

  /**
   * «que salga Lo sin lote primero» (Carlos, 2026-10-31).
   *
   * Un producto que controla lotes puede tener saldo SIN lote: lo que había
   * antes de prender el control, o lo que entró sin capturarlo. Ese saldo no
   * tiene fila propia; es `stock_by_warehouse − Σ stock_lots`. FEFO lo
   * ignoraba y rechazaba la venta con el anaquel lleno. Ahora sale PRIMERO,
   * como una toma sin lote, y después los lotes en su orden de siempre.
   */
  describe("Lo sin lote sale primero (Carlos, 2026-10-31)", () => {
    const enDias = (dias: number) =>
      new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

    /**
     * Un producto con lotes en un almacén propio. `total` es el saldo de
     * `stock_by_warehouse`; lo que los lotes no cubren es el residuo sin lote.
     */
    async function productoMixto(
      total: number,
      lotes: { code: string; expiresAt: string | null; quantity: number }[],
    ) {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return prisma.withTenantContext(tenantId, async (tx) => {
        const product = await tx.product.create({
          data: { tenantId, sku: `MIX-${stamp}`, name: "Mixto", tracksLots: true },
        });
        const warehouse = await tx.warehouse.create({
          data: {
            tenantId,
            code: `WH-${Math.random().toString(36).slice(2, 10)}`,
            name: `Mixto ${stamp}`,
          },
        });
        await tx.stockByWarehouse.create({
          data: { tenantId, productId: product.id, warehouseId: warehouse.id, quantity: total },
        });
        const lotIds: Record<string, string> = {};
        for (const l of lotes) {
          const lot = await tx.productLot.create({
            data: {
              tenantId,
              productId: product.id,
              lotCode: `${l.code}-${stamp}`,
              expiresAt: l.expiresAt === null ? null : new Date(l.expiresAt),
            },
          });
          await tx.stockLot.create({
            data: {
              tenantId,
              lotId: lot.id,
              warehouseId: warehouse.id,
              location: "",
              quantity: l.quantity,
            },
          });
          lotIds[l.code] = lot.id;
        }
        return { productId: product.id, warehouseId: warehouse.id, lotIds };
      });
    }

    const repartir = (
      warehouse: string,
      lines: ResolvedLine[],
      reasonCode?: MovementReason,
      options?: { allowNegative?: boolean },
    ) =>
      prisma.withTenantContext(tenantId, (tx) =>
        resolveLotsFefo(tx, tenantId, warehouse, lines, reasonCode, options),
      );

    /** El reparto como pares [lote, cantidad]; `null` es la toma sin lote. */
    const resumen = (result: ResolvedLine[]) =>
      result.map((r) => [r.lotId ?? null, r.quantityBase.toString()]);

    /** Residuo 9 sin lote y L1 con 10: el caso que Carlos describió. */
    const mixto = () => productoMixto(19, [{ code: "L1", expiresAt: enDias(30), quantity: 10 }]);

    it("(a) pedir 12 saca primero los 9 sin lote y después 3 de L1", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();

      const result = await repartir(w, [linea(12, { productId: p })]);

      expect(resumen(result)).toEqual([
        [null, "9"],
        [lotIds.L1, "3"],
      ]);
      expect(result.every((r) => r.lineIndex === 0)).toBe(true);
    });

    it("(b) pedir 19 vacía las dos cosas: 9 sin lote y 10 de L1", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();

      const result = await repartir(w, [linea(19, { productId: p })]);

      expect(resumen(result)).toEqual([
        [null, "9"],
        [lotIds.L1, "10"],
      ]);
    });

    it("(c) pedir 20 sin permitir negativos se rechaza con disponible 19", async () => {
      const { productId: p, warehouseId: w } = await mixto();

      await expect(repartir(w, [linea(20, { productId: p })])).rejects.toMatchObject({
        response: {
          message: "inventory.insufficient_stock",
          args: expect.objectContaining({ available: "19", requested: "20" }),
        },
      });
    });

    it("(d) con allowNegative, pedir 25 deja el faltante sin lote: 15 sin lote y 10 de L1", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();

      const result = await repartir(w, [linea(25, { productId: p })], "sale", {
        allowNegative: true,
      });

      // L1 da sus 10 y ni uno más: un lote nunca queda en negativo por FEFO.
      expect(resumen(result)).toEqual([
        [null, "15"],
        [lotIds.L1, "10"],
      ]);
    });

    it("(e) un producto sin lotes, con saldo, pasa de largo igual que antes", async () => {
      const simple = await prisma.withTenantContext(tenantId, async (tx) => {
        const product = await tx.product.create({
          data: { tenantId, sku: `SIMPLE-${Date.now()}`, name: "Sin lotes con saldo" },
        });
        await tx.stockByWarehouse.create({
          data: { tenantId, productId: product.id, warehouseId, quantity: 7 },
        });
        return product.id;
      });
      const original = linea(5, { productId: simple });

      const result = await fefo([original]);

      expect(result).toEqual([original]);
    });

    it("(f) con el residuo en cero solo salen lotes", async () => {
      const {
        productId: p,
        warehouseId: w,
        lotIds,
      } = await productoMixto(10, [{ code: "L1", expiresAt: enDias(30), quantity: 10 }]);

      const result = await repartir(w, [linea(4, { productId: p })]);

      expect(resumen(result)).toEqual([[lotIds.L1, "4"]]);
    });

    it("(f) con el residuo negativo solo salen lotes: lo que falta no se inventa", async () => {
      // Los lotes suman 10 y el producto dice 5: el residuo es −5.
      const {
        productId: p,
        warehouseId: w,
        lotIds,
      } = await productoMixto(5, [{ code: "L1", expiresAt: enDias(30), quantity: 10 }]);

      const result = await repartir(w, [linea(4, { productId: p })]);

      expect(resumen(result)).toEqual([[lotIds.L1, "4"]]);
    });

    it("dos líneas del mismo producto no se reparten dos veces el mismo residuo", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();

      const result = await repartir(w, [
        linea(6, { productId: p, lineIndex: 0 }),
        linea(6, { productId: p, lineIndex: 1 }),
      ]);

      expect(result.map((r) => [r.lineIndex, r.lotId ?? null, r.quantityBase.toString()])).toEqual([
        [0, null, "6"],
        [1, null, "3"],
        [1, lotIds.L1, "3"],
      ]);
    });

    it("con motivo `sale` el residuo sale primero y el lote vencido se sigue saltando", async () => {
      // Residuo 9 = 24 − (10 vencido + 5 vivo).
      const {
        productId: p,
        warehouseId: w,
        lotIds,
      } = await productoMixto(24, [
        { code: "VIEJO", expiresAt: "2020-01-01", quantity: 10 },
        { code: "VIVO", expiresAt: enDias(30), quantity: 5 },
      ]);

      const result = await repartir(w, [linea(12, { productId: p })], "sale");

      expect(resumen(result)).toEqual([
        [null, "9"],
        [lotIds.VIVO, "3"],
      ]);
    });

    it("si falta y hay vencido, el error dice que está vencido y el disponible cuenta el residuo", async () => {
      const { productId: p, warehouseId: w } = await productoMixto(24, [
        { code: "VIEJO", expiresAt: "2020-01-01", quantity: 10 },
        { code: "VIVO", expiresAt: enDias(30), quantity: 5 },
      ]);

      await expect(repartir(w, [linea(20, { productId: p })], "sale")).rejects.toMatchObject({
        response: {
          message: "inventory.expired_stock_not_sellable",
          // 9 sin lote + 5 vivos; los 10 vencidos se nombran aparte.
          args: expect.objectContaining({ available: "14", expired: "10", requested: "20" }),
        },
      });
    });

    /**
     * Dar de baja lo caducado es sacar LOTES vencidos: lo sin lote no tiene
     * caducidad. Con «sin lote primero» una baja por Caducado sin lote
     * elegido se llevaba lo sin lote y dejaba el lote vencido donde estaba.
     */
    it("una salida por Caducado saca primero el lote vencido, no lo sin lote", async () => {
      const {
        productId: p,
        warehouseId: w,
        lotIds,
      } = await productoMixto(14, [{ code: "VENCIDO", expiresAt: "2020-01-01", quantity: 5 }]);

      const result = await repartir(w, [linea(5, { productId: p })], "expired");
      const previa = await prisma.withTenantContext(tenantId, (tx) =>
        planLotsFefo(
          tx,
          tenantId,
          w,
          [{ lineIndex: 0, productId: p, quantityBase: new Prisma.Decimal(5) }],
          "expired",
        ),
      );

      expect(resumen(result)).toEqual([[lotIds.VENCIDO, "5"]]);
      expect(previa[0]?.takes.map((take) => take.quantity.toString())).toEqual(["5"]);
      expect(previa[0]?.unlotted.toString()).toBe("0");
    });

    /**
     * El candado del residuo se toma ANTES que el del ledger. Si la fila del
     * saldo todavía no existe, el ledger la inserta después con `ON CONFLICT`,
     * y ese INSERT espera a otra transacción que insertó la misma llave: un
     * bloqueo mutuo posible. Crear la fila antes de bloquearla lo evita.
     */
    it("bloquear el residuo crea la fila del saldo que todavía no existe", async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { productId: p, warehouseId: w } = await prisma.withTenantContext(
        tenantId,
        async (tx) => {
          const product = await tx.product.create({
            data: { tenantId, sku: `NUEVO-${stamp}`, name: "Nunca almacenado", tracksLots: true },
          });
          const warehouse = await tx.warehouse.create({
            data: {
              tenantId,
              code: `WH-${Math.random().toString(36).slice(2, 10)}`,
              name: `Vacío ${stamp}`,
            },
          });
          return { productId: product.id, warehouseId: warehouse.id };
        },
      );

      await repartir(w, [linea(3, { productId: p })], "sale", { allowNegative: true });

      const fila = await prisma.withTenantContext(tenantId, (tx) =>
        tx.stockByWarehouse.findFirst({ where: { productId: p, warehouseId: w } }),
      );
      expect(fila?.quantity.toString()).toBe("0");
    });

    it("la previa (planLotsFefo) dice lo mismo que el confirm: los 9 sin lote primero", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();

      const [plan] = await prisma.withTenantContext(tenantId, (tx) =>
        planLotsFefo(tx, tenantId, w, [
          { lineIndex: 0, productId: p, quantityBase: new Prisma.Decimal(12) },
        ]),
      );

      expect(plan?.unlotted.toString()).toBe("9");
      expect(plan?.takes.map((t) => [t.lotId, t.quantity.toString()])).toEqual([[lotIds.L1, "3"]]);
      expect(plan?.shortfall.toString()).toBe("0");
    });

    /**
     * El residuo se lee BLOQUEADO. Sin el candado, dos ventas simultáneas leen
     * el mismo 9 sin lote, las dos lo toman y el producto queda con menos
     * saldo que la suma de sus lotes.
     */
    it("dos salidas a la vez no se llevan el mismo residuo: la segunda espera y relee", async () => {
      const { productId: p, warehouseId: w, lotIds } = await mixto();
      let avisar: () => void = () => undefined;
      const primeraRepartio = new Promise<void>((resolve) => {
        avisar = resolve;
      });

      const primera = prisma.withTenantContext(tenantId, async (tx) => {
        const reparto = await resolveLotsFefo(tx, tenantId, w, [linea(9, { productId: p })]);
        avisar();
        // Lo que haría el ledger con la toma sin lote: bajar el total. Se
        // demora a propósito para que la segunda alcance a toparse con el
        // candado antes de que esta termine.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.$executeRaw`
          UPDATE stock_by_warehouse SET quantity = quantity - 9
           WHERE tenant_id = ${tenantId}::uuid
             AND warehouse_id = ${w}::uuid
             AND product_id = ${p}::uuid`;
        return reparto;
      });
      await primeraRepartio;
      const segunda = repartir(w, [linea(9, { productId: p })]);

      const [a, b] = await Promise.all([primera, segunda]);

      expect(resumen(a)).toEqual([[null, "9"]]);
      expect(resumen(b)).toEqual([[lotIds.L1, "9"]]);
    });
  });
});
