import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, sellpoint_app) — F1-SCOPE-01/02: modelo
 * `UserWarehouseScope` + policy `tenant_isolation` en `user_warehouse_scopes`.
 * Mismo patrón de canario que `prisma.service.spec.ts` (users): sin
 * `set_config` no debe devolver filas, y el owner ya no está exento porque la
 * tabla nace con FORCE ROW LEVEL SECURITY.
 */
describe("user_warehouse_scopes — RLS (F1-SCOPE-01/02)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  const warehouseId = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenantA = await prisma.tenant.create({
      data: { name: "Tenant A - user_warehouse_scopes" },
    });
    const tenantB = await prisma.tenant.create({
      data: { name: "Tenant B - user_warehouse_scopes" },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const userA = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.user.create({
        data: {
          tenantId: tenantAId,
          email: `scope-user-a-${Date.now()}@example.com`,
          firstName: "Ana",
          lastNamePaternal: "Scope",
        },
      }),
    );
    userAId = userA.id;

    await prisma.withTenantContext(tenantAId, (tx) =>
      tx.userWarehouseScope.create({
        data: { userId: userAId, warehouseId, tenantId: tenantAId },
      }),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("filtra por tenant: dentro del contexto correcto ve sus propias filas", async () => {
    const scopes = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.userWarehouseScope.findMany({ where: { userId: userAId } }),
    );

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.warehouseId).toBe(warehouseId);
  });

  it("tenant ajeno → 0 filas (RLS aísla aunque la query no filtre explícitamente por tenantId)", async () => {
    const scopes = await prisma.withTenantContext(tenantBId, (tx) =>
      tx.userWarehouseScope.findMany(),
    );

    expect(scopes).toHaveLength(0);
  });

  it("SELECT sin set_config devuelve 0 filas (canario R1: FORCE ROW LEVEL SECURITY activo)", async () => {
    const rows = await prisma.$queryRaw<unknown[]>`SELECT * FROM user_warehouse_scopes`;

    expect(rows).toHaveLength(0);
  });

  it("sellpoint_app tiene grants de lectura/escritura vía ALTER DEFAULT PRIVILEGES", async () => {
    const privileges = await Promise.all(
      ["SELECT", "INSERT", "UPDATE", "DELETE"].map(async (privilege) => {
        const rows = await prisma.$queryRaw<
          { has_privilege: boolean }[]
        >`SELECT has_table_privilege('sellpoint_app', 'public.user_warehouse_scopes', ${privilege}) AS has_privilege`;
        return rows[0]?.has_privilege;
      }),
    );

    expect(privileges).toEqual([true, true, true, true]);
  });

  it("warehouse_id NO tiene FK todavía (la tabla warehouses llega en F2)", async () => {
    const constraints = await prisma.$queryRaw<
      { constraint_name: string }[]
    >`SELECT tc.constraint_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'user_warehouse_scopes'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'warehouse_id'`;

    expect(constraints).toHaveLength(0);
  });
});
