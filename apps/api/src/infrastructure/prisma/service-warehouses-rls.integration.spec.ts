import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F3-SVC-06: aislamiento por
 * tenant de `service_warehouses`, la puente que decide EN QUÉ ALMACENES se
 * ofrece cada servicio.
 *
 * Los cuatro canarios canónicos más el ESTRUCTURAL de `pg_class`: la app
 * conecta como `sellpoint_app`, que no es owner, y a un no-owner la RLS se le
 * aplica con FORCE o sin él — el FORCE protege del rol OWNER (migraciones y
 * seed), así que su ausencia solo se ve mirando el catálogo de Postgres.
 */
describe("RLS de servicios por almacén (F3-SVC-06)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let servicioAId: string;
  let almacenAId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant SW A ${Date.now()}` } }),
      prisma.tenant.create({ data: { name: `Tenant SW B ${Date.now()}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    await prisma.withTenantContext(tenantAId, async (tx) => {
      const servicio = await tx.service.create({
        data: { tenantId: tenantAId, code: `SW-${Date.now()}`, name: "Corte" },
      });
      const almacen = await tx.warehouse.create({
        data: { tenantId: tenantAId, name: `Central SW ${Date.now()}` },
      });
      servicioAId = servicio.id;
      almacenAId = almacen.id;
      await tx.serviceWarehouse.create({
        data: { tenantId: tenantAId, serviceId: servicio.id, warehouseId: almacen.id },
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function contar(tenantId?: string): Promise<number> {
    const query = (client: { $queryRawUnsafe: <T>(sql: string) => Promise<T> }) =>
      client
        .$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "service_warehouses"`)
        .then((rows) => Number(rows[0]?.count ?? -1));

    return tenantId
      ? prisma.withTenantContext(tenantId, (tx) =>
          query(tx as unknown as { $queryRawUnsafe: <T>(sql: string) => Promise<T> }),
        )
      : query(prisma);
  }

  it("ve sus filas con su contexto y CERO con el de otro tenant", async () => {
    expect(await contar(tenantAId)).toBeGreaterThanOrEqual(1);
    expect(await contar(tenantBId)).toBe(0);
  });

  it("sin set_config no devuelve filas", async () => {
    expect(await contar()).toBe(0);
  });

  it("escribir con el contexto de otro tenant es rechazado (canario del WITH CHECK)", async () => {
    await expect(
      prisma.withTenantContext(tenantBId, (tx) =>
        tx.serviceWarehouse.create({
          data: { tenantId: tenantAId, serviceId: servicioAId, warehouseId: almacenAId },
        }),
      ),
    ).rejects.toThrow();
  });

  it("la tabla tiene la policy tenant_isolation con ENABLE y FORCE", async () => {
    const rows = await prisma.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'service_warehouses'`;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
    expect(Number(rows[0]?.policies)).toBe(1);
  });

  /**
   * La query ESTRELLA del POS de F4 es la inversa: «qué servicios se ofrecen en
   * ESTE almacén». `user_warehouse_scopes` no tiene índice por almacén y esa
   * omisión no se copia — sin él, cada búsqueda del carrito sería un scan.
   */
  it("tiene índice por warehouse_id: la query del POS va por almacén", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'service_warehouses'`;

    const porAlmacen = rows.filter((r) => /\(warehouse_id\)/.test(r.indexdef));
    expect(porAlmacen).toHaveLength(1);
  });

  it("el mismo par servicio-almacén no se puede repetir", async () => {
    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.serviceWarehouse.create({
          data: { tenantId: tenantAId, serviceId: servicioAId, warehouseId: almacenAId },
        }),
      ),
    ).rejects.toThrow();
  });
});
