import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F2-DB-09: aislamiento por
 * tenant en las 8 tablas nuevas de Fase 2.
 *
 * Replica los cuatro canarios canónicos de F1
 * (`user-warehouse-scope-rls.integration.spec.ts`) sobre cada tabla:
 *
 *  1. Dentro del contexto propio, ve sus filas.
 *  2. Dentro del contexto de OTRO tenant, ve cero — aunque la query no filtre
 *     por `tenant_id`.
 *  3. Sin `set_config`, ve cero — la policy filtra aunque no haya contexto.
 *  4. Escribir con el contexto de otro tenant es rechazado — canario del
 *     WITH CHECK, sin el cual el aislamiento sería solo de lectura.
 *
 * Quién cubre el **FORCE** (verificado con contraprueba: se le quitó a
 * `catalogs` y se corrió la suite): NO los canarios de arriba, sino el test
 * ESTRUCTURAL que lee `pg_class`. La razón es que la app conecta como
 * `sellpoint_app`, que no es owner de las tablas, y a un no-owner la RLS se le
 * aplica con FORCE o sin él. El FORCE protege del rol OWNER — el que usan
 * migraciones y seed —, así que su ausencia es invisible desde la app y solo
 * se detecta mirando el catálogo de Postgres.
 *
 * Un guardián recorre las 8 tablas y reporta TODAS las violaciones juntas, en
 * vez de un `it.each` que infle la suite con 32 pruebas (LEY de CONTRIBUTING).
 */
const RLS_TABLES = [
  "catalogs",
  "catalog_fields",
  "catalog_records",
  "products",
  "product_presentations",
  "product_compositions",
  "warehouses",
  "stock_by_warehouse",
] as const;

describe("RLS de Fase 2 (F2-DB-09)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant RLS A ${Date.now()}` } }),
      prisma.tenant.create({ data: { name: `Tenant RLS B ${Date.now()}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    // Una fila por tabla en el tenant A, encadenadas por sus FKs.
    await prisma.withTenantContext(tenantAId, async (tx) => {
      const catalog = await tx.catalog.create({
        data: { tenantId: tenantAId, name: `Catálogo RLS ${Date.now()}` },
      });
      await tx.catalogField.create({
        data: {
          tenantId: tenantAId,
          catalogId: catalog.id,
          key: "campo",
          label: "Campo",
          fieldType: "text",
        },
      });
      await tx.catalogRecord.create({
        data: { tenantId: tenantAId, catalogId: catalog.id, code: `c-${Date.now()}` },
      });

      const product = await tx.product.create({
        data: { tenantId: tenantAId, sku: `RLS-${Date.now()}`, name: "Producto RLS" },
      });
      const component = await tx.product.create({
        data: { tenantId: tenantAId, sku: `RLS-C-${Date.now()}`, name: "Componente RLS" },
      });
      await tx.productPresentation.create({
        data: {
          tenantId: tenantAId,
          productId: product.id,
          name: "Unidad",
          factor: 1,
          allowFractionalInput: false,
        },
      });
      await tx.productComposition.create({
        data: {
          tenantId: tenantAId,
          parentProductId: product.id,
          componentProductId: component.id,
          quantity: 1,
        },
      });

      const warehouse = await tx.warehouse.create({
        data: {
          tenantId: tenantAId,
          code: `WH-${Math.random().toString(36).slice(2, 10)}`,
          name: `Almacén RLS ${Date.now()}`,
        },
      });
      await tx.stockByWarehouse.create({
        data: { tenantId: tenantAId, productId: product.id, warehouseId: warehouse.id },
      });
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

  it("sin set_config ninguna tabla devuelve filas (canario de FORCE ROW LEVEL SECURITY)", async () => {
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
    // Sin WITH CHECK, la policy filtraría lecturas pero dejaría INSERTAR filas
    // marcadas con el tenant_id de otro: aislamiento a medias.
    await expect(
      prisma.withTenantContext(tenantBId, (tx) =>
        tx.catalog.create({
          data: { tenantId: tenantAId, name: `Intruso ${Date.now()}` },
        }),
      ),
    ).rejects.toThrow();
  });

  it("las 8 tablas tienen la policy tenant_isolation con ENABLE y FORCE", async () => {
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
         AND c.relname = ANY(ARRAY['catalogs','catalog_fields','catalog_records','products',
                                   'product_presentations','product_compositions','warehouses',
                                   'stock_by_warehouse'])`;

    const violations = rows
      .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || Number(r.policies) !== 1)
      .map(
        (r) =>
          `${r.relname}: enable=${r.relrowsecurity} force=${r.relforcerowsecurity} policies=${r.policies}`,
      );

    expect(rows).toHaveLength(RLS_TABLES.length);
    expect(violations).toEqual([]);
  });

  it("units NO tiene RLS: es catálogo global, como currencies", async () => {
    const [unit] = await prisma.$queryRaw<
      { relrowsecurity: boolean }[]
    >`SELECT relrowsecurity FROM pg_class WHERE relname = 'units'`;

    expect(unit?.relrowsecurity).toBe(false);
  });
});
