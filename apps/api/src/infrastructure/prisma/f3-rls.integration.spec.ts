import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F3-DB-04: aislamiento por
 * tenant y append-only en las tablas de Fase 3.
 *
 * Replica los cuatro canarios canónicos de F1 y F2 sobre cada tabla:
 *
 *  1. Dentro del contexto propio, ve sus filas.
 *  2. Dentro del contexto de OTRO tenant, ve cero — aunque la query no filtre
 *     por `tenant_id`.
 *  3. Sin `set_config`, ve cero.
 *  4. Escribir con el contexto de otro tenant es rechazado (WITH CHECK).
 *
 * El **FORCE** no lo cubren esos canarios sino el test ESTRUCTURAL que lee
 * `pg_class`: la app conecta como `sellpoint_app`, que no es owner, y a un
 * no-owner la RLS se le aplica igual. El FORCE protege del rol OWNER —el de
 * migraciones y seed—, así que su ausencia es invisible desde la app.
 *
 * Hay una razón concreta por la que esta tarea importa más de lo que parece:
 * mientras estas tablas existieron sin RLS, un test de `DocumentsService`
 * (F3-DOC-03) probó que un usuario de otro tenant podía anular un documento
 * ajeno. El filtro por `tenantId` en el service tapó ese caso, pero la RLS es
 * la barrera que no depende de que nadie se acuerde.
 */
const RLS_TABLES = [
  "stock_movements",
  "inventory_documents",
  "inventory_document_lines",
  "transfers",
  "transfer_lines",
  "tenant_sequences",
  // F3-DB-06: los lotes tenían el test ESTRUCTURAL en `lots-schema` pero no
  // los cuatro canarios de comportamiento — lo destapó el checklist de cierre
  // de la fase. Una policy que existe no es una policy que filtra.
  "product_lots",
  "stock_lots",
] as const;

describe("RLS y append-only de Fase 3 (F3-DB-04)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let documentId: string;
  let movementId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const stamp = Date.now();
    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant RLS F3 A ${stamp}` } }),
      prisma.tenant.create({ data: { name: `Tenant RLS F3 B ${stamp}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    // Una fila por tabla en el tenant A, encadenadas por sus FKs.
    await prisma.withTenantContext(tenantAId, async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: tenantAId,
          email: `rls-f3-${stamp}@example.com`,
          firstName: "RLS",
          lastNamePaternal: "F3",
        },
      });
      const product = await tx.product.create({
        data: { tenantId: tenantAId, sku: `RLS-F3-${stamp}`, name: "Producto RLS F3" },
      });
      const [origin, destination] = await Promise.all([
        tx.warehouse.create({ data: { tenantId: tenantAId, name: `Origen ${stamp}` } }),
        tx.warehouse.create({ data: { tenantId: tenantAId, name: `Destino ${stamp}` } }),
      ]);

      const transfer = await tx.transfer.create({
        data: {
          tenantId: tenantAId,
          originWarehouseId: origin.id,
          destinationWarehouseId: destination.id,
          createdBy: user.id,
        },
      });
      await tx.transferLine.create({
        data: {
          tenantId: tenantAId,
          transferId: transfer.id,
          productId: product.id,
          quantitySent: 5,
        },
      });
      await tx.tenantSequence.create({
        data: { tenantId: tenantAId, key: "entry", nextValue: 1n },
      });

      const document = await tx.inventoryDocument.create({
        data: {
          tenantId: tenantAId,
          folio: "ENT-000001",
          type: "entry",
          warehouseId: origin.id,
          createdBy: user.id,
        },
      });
      await tx.inventoryDocumentLine.create({
        data: {
          tenantId: tenantAId,
          documentId: document.id,
          lineNo: 1,
          productId: product.id,
          quantity: 5,
        },
      });

      // El movimiento necesita un documento CONFIRMADO: los movimientos solo
      // existen del lado de lo ya asentado.
      const sealed = await tx.inventoryDocument.create({
        data: {
          tenantId: tenantAId,
          folio: "ENT-000002",
          type: "entry",
          status: "confirmed",
          warehouseId: origin.id,
          reasonCode: "invoice",
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: new Date(),
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          tenantId: tenantAId,
          documentId: sealed.id,
          productId: product.id,
          warehouseId: origin.id,
          direction: "entry",
          reasonCode: "invoice",
          quantity: 5,
          createdBy: user.id,
        },
      });

      const lote = await tx.productLot.create({
        data: {
          tenantId: tenantAId,
          productId: product.id,
          lotCode: `RLS-${Date.now()}`,
        },
      });
      await tx.stockLot.create({
        data: {
          tenantId: tenantAId,
          warehouseId: origin.id,
          lotId: lote.id,
          quantity: 1,
        },
      });

      documentId = document.id;
      movementId = movement.id;
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function countIn(table: string, tenantId?: string): Promise<number> {
    const query = (client: { $queryRawUnsafe: <T>(sql: string) => Promise<T> }) =>
      client
        .$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "${table}"`)
        .then((rows) => Number(rows[0]?.count ?? -1));

    return tenantId
      ? prisma.withTenantContext(tenantId, (tx) =>
          query(tx as unknown as { $queryRawUnsafe: <T>(sql: string) => Promise<T> }),
        )
      : query(prisma);
  }

  it("cada tabla ve sus filas con su contexto y CERO con el de otro tenant", async () => {
    const violations: string[] = [];

    for (const table of RLS_TABLES) {
      const own = await countIn(table, tenantAId);
      const foreign = await countIn(table, tenantBId);

      if (own < 1) {
        violations.push(`${table}: el propio tenant ve ${own} filas (esperaba al menos 1)`);
      }
      if (foreign !== 0) {
        violations.push(`${table}: un tenant AJENO ve ${foreign} filas (esperaba 0)`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("sin set_config ninguna tabla devuelve filas", async () => {
    const violations: string[] = [];

    for (const table of RLS_TABLES) {
      const leaked = await countIn(table);
      if (leaked !== 0) {
        violations.push(`${table}: ${leaked} filas visibles SIN contexto de tenant`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("escribir con el contexto de otro tenant es rechazado (canario del WITH CHECK)", async () => {
    await expect(
      prisma.withTenantContext(tenantBId, (tx) =>
        tx.tenantSequence.create({ data: { tenantId: tenantAId, key: `intruso-${Date.now()}` } }),
      ),
    ).rejects.toThrow();
  });

  it("las 6 tablas tienen la policy tenant_isolation con ENABLE y FORCE", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY(ARRAY['stock_movements','inventory_documents','inventory_document_lines',
                                   'transfers','transfer_lines','tenant_sequences',
                                   'product_lots','stock_lots'])`;

    const violations = rows
      .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || Number(r.policies) !== 1)
      .map(
        (r) =>
          `${r.relname}: enable=${r.relrowsecurity} force=${r.relforcerowsecurity} policies=${r.policies}`,
      );

    expect(rows).toHaveLength(RLS_TABLES.length);
    expect(violations).toEqual([]);
  });

  describe("append-only: dos mecanismos distintos para dos problemas distintos", () => {
    /**
     * `stock_movements` se blinda por PRIVILEGIO: la app no puede escribirlo
     * de nuevo ni aunque quisiera. Es la barrera más fuerte y se puede usar
     * acá porque un movimiento nunca se edita.
     */
    it("la app NO puede hacer UPDATE ni DELETE sobre stock_movements (42501)", async () => {
      const privileges = await prisma.$queryRaw<{ privilege: string; has: boolean }[]>`
        SELECT p AS privilege,
               has_table_privilege('sellpoint_app', 'public.stock_movements', p) AS has
          FROM unnest(ARRAY['INSERT','SELECT','UPDATE','DELETE']) AS p`;
      const byName = new Map(privileges.map((r) => [r.privilege, r.has]));

      expect(byName.get("INSERT")).toBe(true);
      expect(byName.get("SELECT")).toBe(true);
      expect(byName.get("UPDATE")).toBe(false);
      expect(byName.get("DELETE")).toBe(false);
    });

    /**
     * El documento NO puede blindarse igual: un borrador se edita. Su
     * inmutabilidad es por ESTADO (trigger de F3-DOC-02), así que el
     * privilegio tiene que seguir estando.
     */
    it("sobre inventory_documents la app SÍ conserva UPDATE: el borrador se edita", async () => {
      const [row] = await prisma.$queryRaw<{ has: boolean }[]>`
        SELECT has_table_privilege('sellpoint_app', 'public.inventory_documents', 'UPDATE') AS has`;

      expect(row?.has).toBe(true);
    });

    it("y aun así un documento confirmado no se toca: lo frena el trigger", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.inventoryDocument.updateMany({
            where: { folio: "ENT-000002" },
            data: { reference: "no deberías" },
          }),
        ),
      ).rejects.toThrow(/42501/);
    });

    it("un borrador sí se edita, que es lo que el REVOKE habría impedido", async () => {
      await expect(
        prisma.withTenantContext(tenantAId, (tx) =>
          tx.inventoryDocument.update({
            where: { id: documentId },
            data: { reference: "F-1234" },
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("tenant_sequences SÍ admite UPDATE: es un contador, no un asiento", async () => {
      const [row] = await prisma.$queryRaw<{ has: boolean }[]>`
        SELECT has_table_privilege('sellpoint_app', 'public.tenant_sequences', 'UPDATE') AS has`;

      expect(row?.has).toBe(true);
    });

    it("insertar un movimiento sigue funcionando: append-only no es solo-lectura", async () => {
      expect(movementId).toBeDefined();
    });
  });
});
