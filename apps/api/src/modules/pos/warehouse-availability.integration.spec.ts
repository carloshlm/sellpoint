import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { sellableStock } from "./warehouse-availability";

/**
 * Integration (Postgres real) — F4-CART-01: qué hay REALMENTE para vender en
 * el almacén del turno.
 *
 * Los tres casos que separan esta función de un `SELECT quantity` a secas:
 *
 *  1. un producto con lotes vale lo que suman sus lotes NO vencidos —
 *     `stock_by_warehouse` incluye lo caducado y mentiría;
 *  2. un COMPUESTO no tiene existencias propias: vale lo que alcanzan sus
 *     componentes, la misma cuenta que F2-BOM-02;
 *  3. el almacén ACOTA: lo que está en otra bodega no se vende en este turno.
 */
describe("sellableStock (F4-CART-01)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let central: string;
  let sucursal: string;

  let simple: string;
  let conLotes: string;
  let todoVencido: string;
  let compuesto: string;
  let componenteEscaso: string;

  const AYER = new Date();
  AYER.setUTCDate(AYER.getUTCDate() - 1);
  const EL_AÑO_QUE_VIENE = new Date();
  EL_AÑO_QUE_VIENE.setUTCFullYear(EL_AÑO_QUE_VIENE.getUTCFullYear() + 1);

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant lookup ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      central = (await tx.warehouse.create({ data: { tenantId, name: `Central ${stamp}` } })).id;
      sucursal = (await tx.warehouse.create({ data: { tenantId, name: `Sucursal ${stamp}` } })).id;

      const producto = async (sku: string, extra: Record<string, unknown> = {}) =>
        (
          await tx.product.create({
            data: { tenantId, sku: `${sku}-${stamp}`, name: sku, ...extra },
          })
        ).id;

      const saldo = (productId: string, warehouseId: string, quantity: number) =>
        tx.stockByWarehouse.create({ data: { tenantId, productId, warehouseId, quantity } });

      const lote = async (
        productId: string,
        warehouseId: string,
        lotCode: string,
        expiresAt: Date | null,
        quantity: number,
      ) => {
        const lot = await tx.productLot.create({
          data: { tenantId, productId, lotCode: `${lotCode}-${stamp}`, expiresAt },
        });
        await tx.stockLot.create({
          data: { tenantId, lotId: lot.id, warehouseId, location: "", quantity },
        });
      };

      // 1. Simple: 7 en Central, 99 en Sucursal (que NO se debe contar).
      simple = await producto("SIMPLE");
      await saldo(simple, central, 7);
      await saldo(simple, sucursal, 99);

      // 2. Con lotes: 20 vivos + 5 vencidos. `stock_by_warehouse` dice 25.
      conLotes = await producto("LOTES", { tracksLots: true });
      await saldo(conLotes, central, 25);
      await lote(conLotes, central, "vivo", EL_AÑO_QUE_VIENE, 20);
      await lote(conLotes, central, "muerto", AYER, 5);

      // 3. Todo vencido: hay mercancía en el anaquel, pero nada vendible.
      todoVencido = await producto("VENCIDO", { tracksLots: true });
      await saldo(todoVencido, central, 12);
      await lote(todoVencido, central, "unico", AYER, 12);

      // 4. Compuesto: lleva 2 del componente escaso (hay 9 → alcanza para 4)
      //    y 1 del simple (hay 7 → alcanza para 7). El techo es 4.
      componenteEscaso = await producto("ESCASO");
      await saldo(componenteEscaso, central, 9);
      compuesto = await producto("COMBO", { isComposite: true });
      await tx.productComposition.createMany({
        data: [
          {
            tenantId,
            parentProductId: compuesto,
            componentProductId: componenteEscaso,
            quantity: 2,
          },
          { tenantId, parentProductId: compuesto, componentProductId: simple, quantity: 1 },
        ],
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const consultar = (warehouseId: string, ids: string[]) =>
    prisma.withTenantContext(tenantId, (tx) => sellableStock(tx, tenantId, warehouseId, ids));

  it("un producto simple vale su saldo en ESE almacén, no la suma de todos", async () => {
    const mapa = await consultar(central, [simple]);
    expect(mapa.get(simple)?.available.toString()).toBe("7");
  });

  it("un producto con lotes NO cuenta lo vencido, aunque el saldo total lo incluya", async () => {
    const mapa = await consultar(central, [conLotes]);
    // `stock_by_warehouse` dice 25. Vendible: 20.
    expect(mapa.get(conLotes)?.available.toString()).toBe("20");
    expect(mapa.get(conLotes)?.expired.toString()).toBe("5");
  });

  it("un producto con TODO su stock vencido queda en cero, y dice cuánto hay vencido", async () => {
    const mapa = await consultar(central, [todoVencido]);
    // El dato de vencido es lo que evita que el mensaje mienta: "no hay"
    // mientras el anaquel tiene doce cajas a la vista.
    expect(mapa.get(todoVencido)?.available.toString()).toBe("0");
    expect(mapa.get(todoVencido)?.expired.toString()).toBe("12");
  });

  it("un compuesto vale lo que alcanzan sus componentes, no un saldo propio", async () => {
    const mapa = await consultar(central, [compuesto]);
    // 9 escasos ÷ 2 = 4 (piso); 7 simples ÷ 1 = 7. Manda el que limita.
    expect(mapa.get(compuesto)?.available.toString()).toBe("4");
  });

  it("un compuesto sin componentes en ESTE almacén queda en cero", async () => {
    const mapa = await consultar(sucursal, [compuesto]);
    // En Sucursal hay 99 simples pero cero escasos: no se arma ninguno.
    expect(mapa.get(compuesto)?.available.toString()).toBe("0");
  });

  it("devuelve una entrada por cada producto pedido, aunque no tenga stock", async () => {
    const mapa = await consultar(sucursal, [conLotes, todoVencido]);
    expect(mapa.get(conLotes)?.available.toString()).toBe("0");
    expect(mapa.get(todoVencido)?.available.toString()).toBe("0");
  });
});
