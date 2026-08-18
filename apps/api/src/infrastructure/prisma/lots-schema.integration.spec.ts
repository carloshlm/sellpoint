import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real) — F3-DB-06: lotes, caducidad y ubicación.
 *
 * Modelo de DOS NIVELES (Carlos, 2026-08-17, sobre un Excel real de cliente):
 * `stock_by_warehouse` sigue siendo el TOTAL y `stock_lots` es el detalle,
 * **solo** para los productos con `tracks_lots`. Quien no lo activa no ve un
 * lote jamás.
 *
 * Las dos decisiones que el schema codifica:
 *  · la **caducidad es del LOTE**, no de la fila de stock — el mismo lote en
 *    dos almacenes comparte fecha, que es como funciona un lote de fabricante;
 *  · la **ubicación PARTE el stock** — "hay 5 en A-3 y 15 en B-1" son dos
 *    filas, no una con una etiqueta.
 */
describe("lotes: product_lots y stock_lots (F3-DB-06)", () => {
  let prisma: PrismaService;
  let tenantId: string;
  let productId: string;
  let otherProductId: string;
  let warehouseId: string;
  let otherWarehouseId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const tenant = await prisma.tenant.create({ data: { name: `Tenant lotes ${stamp}` } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, async (tx) => {
      const [product, other] = await Promise.all([
        tx.product.create({
          data: { tenantId, sku: `LOT-${stamp}`, name: "Con lotes", tracksLots: true },
        }),
        tx.product.create({ data: { tenantId, sku: `LOT-B-${stamp}`, name: "Otro con lotes" } }),
      ]);
      const [warehouse, second] = await Promise.all([
        tx.warehouse.create({ data: { tenantId, name: `Central ${stamp}` } }),
        tx.warehouse.create({ data: { tenantId, name: `Sucursal ${stamp}` } }),
      ]);
      productId = product.id;
      otherProductId = other.id;
      warehouseId = warehouse.id;
      otherWarehouseId = second.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const createLot = (lotCode: string, data: Record<string, unknown> = {}, product = productId) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.productLot.create({ data: { tenantId, productId: product, lotCode, ...data } }),
    );

  const createStock = (lotId: string, data: Record<string, unknown> = {}) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.stockLot.create({
        // biome-ignore lint/suspicious/noExplicitAny: los overrides prueban combinaciones que el tipo prohíbe
        data: { tenantId, lotId, warehouseId, quantity: 10, ...data } as any,
      }),
    );

  describe("products.tracks_lots — opt-in por producto", () => {
    it("un producto nace SIN lotes: quien no los necesita no los ve", async () => {
      const plain = await prisma.withTenantContext(tenantId, (tx) =>
        tx.product.create({
          data: { tenantId, sku: `PLAIN-${Date.now()}`, name: "Jabón" },
        }),
      );

      expect(plain.tracksLots).toBe(false);
    });
  });

  describe("product_lots — la caducidad es del lote", () => {
    it("el mismo `lot_code` no se repite dentro de un producto, pero sí entre productos", async () => {
      const code = `st${Date.now()}`;
      await createLot(code);
      await createLot(code, {}, otherProductId);

      await expect(createLot(code)).rejects.toThrow();
    });

    it("la caducidad puede faltar: no todo producto con lote vence", async () => {
      await expect(createLot(`sin-fecha-${Date.now()}`)).resolves.toMatchObject({
        expiresAt: null,
      });
    });

    it("un lote con saldo no se borra (RESTRICT): su historia quedaría huérfana", async () => {
      const lot = await createLot(`borrar-${Date.now()}`);
      await createStock(lot.id);

      await expect(
        prisma.withTenantContext(tenantId, (tx) => tx.productLot.delete({ where: { id: lot.id } })),
      ).rejects.toThrow();
    });
  });

  describe("stock_lots — la ubicación parte el stock", () => {
    it("el mismo lote en dos ubicaciones del mismo almacén son DOS filas", async () => {
      const lot = await createLot(`ubic-${Date.now()}`);

      await createStock(lot.id, { location: "A-3", quantity: 5 });
      await expect(createStock(lot.id, { location: "B-1", quantity: 15 })).resolves.toBeDefined();
    });

    it("y la misma (lote, almacén, ubicación) no se duplica", async () => {
      const lot = await createLot(`dup-${Date.now()}`);
      await createStock(lot.id, { location: "A-3" });

      await expect(createStock(lot.id, { location: "A-3" })).rejects.toThrow();
    });

    it("sin ubicación es `''`, no NULL: entra en la clave primaria", async () => {
      const lot = await createLot(`vacia-${Date.now()}`);

      await expect(createStock(lot.id)).resolves.toMatchObject({ location: "" });
    });

    it("el mismo lote vive en dos almacenes y comparte su caducidad", async () => {
      const vence = new Date("2026-07-01");
      const lot = await createLot(`dos-almacenes-${Date.now()}`, { expiresAt: vence });

      await createStock(lot.id, { warehouseId });
      const second = await createStock(lot.id, { warehouseId: otherWarehouseId });

      // La fecha NO se repite por almacén: vive una sola vez, en el lote.
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_lots'`;
      expect(columns.map((c) => c.column_name)).not.toContain("expires_at");
      expect(second.warehouseId).toBe(otherWarehouseId);
    });

    it("el saldo de un lote nunca es negativo", async () => {
      const lot = await createLot(`negativo-${Date.now()}`);

      await expect(createStock(lot.id, { quantity: -1 })).rejects.toThrow();
    });
  });

  describe("aislamiento: las dos tablas nacen con su RLS", () => {
    it("tienen tenant_isolation con ENABLE y FORCE desde la migración que las crea", async () => {
      const rows = await prisma.$queryRaw<
        {
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          policies: bigint;
        }[]
      >`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy p
                 WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY['product_lots','stock_lots'])`;

      const violations = rows
        .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || Number(r.policies) !== 1)
        .map((r) => `${r.relname}: enable=${r.relrowsecurity} force=${r.relforcerowsecurity}`);

      expect(rows).toHaveLength(2);
      expect(violations).toEqual([]);
    });
  });
  /**
   * F3-DB-07 — el movimiento y la línea de traspaso dicen QUÉ LOTE movieron.
   * Sin esto, el kardex de un producto con lotes no podría explicar de cuál
   * salió cada unidad, que es justo para lo que existen los lotes.
   */
  describe("lot_id en movimientos y traspasos (F3-DB-07)", () => {
    it("un movimiento con lote SIEMPRE trae ubicación, aunque sea vacía", async () => {
      const lot = await createLot(`mov-${Date.now()}`);
      const [user, document] = await prisma.withTenantContext(tenantId, async (tx) => {
        const u = await tx.user.create({
          data: {
            tenantId,
            email: `lot-mov-${Date.now()}@example.com`,
            firstName: "L",
            lastNamePaternal: "M",
          },
        });
        const d = await tx.inventoryDocument.create({
          data: {
            tenantId,
            folio: `ENT-${String(Date.now()).slice(-6)}`,
            type: "entry",
            status: "confirmed",
            warehouseId,
            reasonCode: "invoice",
            createdBy: u.id,
            confirmedBy: u.id,
            confirmedAt: new Date(),
          },
        });
        return [u, d];
      });

      const movement = (extra: Record<string, unknown>) =>
        prisma.withTenantContext(tenantId, (tx) =>
          tx.stockMovement.create({
            data: {
              tenantId,
              documentId: document.id,
              productId,
              warehouseId,
              direction: "entry",
              reasonCode: "invoice",
              quantity: 1,
              createdBy: user.id,
              ...extra,
              // biome-ignore lint/suspicious/noExplicitAny: prueba combinaciones que el tipo permite y la base no
            } as any,
          }),
        );

      await expect(movement({ lotId: lot.id })).rejects.toThrow();
      await expect(movement({ lotId: lot.id, location: "" })).resolves.toBeDefined();
      // Sin lote no hace falta ubicación: es un producto que no los maneja.
      await expect(movement({})).resolves.toBeDefined();
    });

    it("un lote referenciado por un movimiento no se borra (RESTRICT)", async () => {
      // Dentro del contexto del tenant: con RLS + FORCE, un raw sin contexto
      // devuelve cero filas — como debe.
      const [row] = await prisma.withTenantContext(
        tenantId,
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          SELECT lot_id AS id FROM stock_movements WHERE lot_id IS NOT NULL LIMIT 1`,
      );

      // Si el movimiento con lote no existe, el test siguiente probaría nada.
      expect(row).toBeDefined();
      const lotId = row?.id ?? "";

      await expect(
        prisma.withTenantContext(tenantId, (tx) => tx.productLot.delete({ where: { id: lotId } })),
      ).rejects.toThrow();
    });

    it("un traspaso mueve un lote CONCRETO: dos lotes del mismo producto son dos líneas", async () => {
      const [a, b] = await Promise.all([
        createLot(`tra-a-${Date.now()}`),
        createLot(`tra-b-${Date.now()}`),
      ]);
      const transfer = await prisma.withTenantContext(tenantId, async (tx) => {
        const u = await tx.user.create({
          data: {
            tenantId,
            email: `lot-tra-${Date.now()}@example.com`,
            firstName: "L",
            lastNamePaternal: "T",
          },
        });
        return tx.transfer.create({
          data: {
            tenantId,
            originWarehouseId: warehouseId,
            destinationWarehouseId: otherWarehouseId,
            createdBy: u.id,
          },
        });
      });

      const line = (lotId: string) =>
        prisma.withTenantContext(tenantId, (tx) =>
          tx.transferLine.create({
            data: { tenantId, transferId: transfer.id, productId, quantitySent: 5, lotId },
          }),
        );

      await line(a.id);
      // Mismo producto, OTRO lote: el unique pasó a (traspaso, producto, lote).
      await expect(line(b.id)).resolves.toBeDefined();
      // Y el mismo lote dos veces sigue rechazado.
      await expect(line(a.id)).rejects.toThrow();
    });
  });
});
