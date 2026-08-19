import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, `sellpoint_app`) — F3-SVC-01: aislamiento por
 * tenant de `services`.
 *
 * Los cuatro canarios canónicos, más el ESTRUCTURAL que lee `pg_class`. El
 * quinto no es redundante: la app conecta como `sellpoint_app`, que no es
 * owner, y a un no-owner la RLS se le aplica con FORCE o sin él. El FORCE
 * protege del rol OWNER —el de migraciones y seed—, así que su ausencia es
 * invisible desde la app y solo se ve mirando el catálogo de Postgres.
 */
describe("RLS de servicios (F3-SVC-01)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const [a, b] = await Promise.all([
      prisma.tenant.create({ data: { name: `Tenant SVC A ${Date.now()}` } }),
      prisma.tenant.create({ data: { name: `Tenant SVC B ${Date.now()}` } }),
    ]);
    tenantAId = a.id;
    tenantBId = b.id;

    await prisma.withTenantContext(tenantAId, async (tx) => {
      await tx.service.create({
        data: { tenantId: tenantAId, code: `SVC-${Date.now()}`, name: "Servicio RLS" },
      });
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function countServices(tenantId?: string): Promise<number> {
    const query = (client: { $queryRawUnsafe: <T>(sql: string) => Promise<T> }) =>
      client
        .$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM "services"`)
        .then((rows) => Number(rows[0]?.count ?? -1));

    return tenantId
      ? prisma.withTenantContext(tenantId, (tx) =>
          query(tx as unknown as { $queryRawUnsafe: <T>(sql: string) => Promise<T> }),
        )
      : query(prisma);
  }

  it("ve sus filas con su contexto y CERO con el de otro tenant", async () => {
    expect(await countServices(tenantAId)).toBeGreaterThanOrEqual(1);
    expect(await countServices(tenantBId)).toBe(0);
  });

  it("sin set_config no devuelve filas", async () => {
    expect(await countServices()).toBe(0);
  });

  it("escribir con el contexto de otro tenant es rechazado (canario del WITH CHECK)", async () => {
    // Sin WITH CHECK la policy filtraría lecturas pero dejaría INSERTAR filas
    // marcadas con el tenant_id de otro: aislamiento a medias.
    await expect(
      prisma.withTenantContext(tenantBId, (tx) =>
        tx.service.create({
          data: { tenantId: tenantAId, code: `INTRUSO-${Date.now()}`, name: "Intruso" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("la tabla tiene la policy tenant_isolation con ENABLE y FORCE", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: bigint }[]
    >`SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'services'`;

    expect(rows).toHaveLength(1);
    const fila = rows[0];
    expect(fila?.relrowsecurity).toBe(true);
    expect(fila?.relforcerowsecurity).toBe(true);
    expect(Number(fila?.policies)).toBe(1);
  });

  it("el código es único por tenant, pero dos tenants pueden usar el mismo", async () => {
    const code = `DUP-${Date.now()}`;
    await prisma.withTenantContext(tenantAId, (tx) =>
      tx.service.create({ data: { tenantId: tenantAId, code, name: "Corte" } }),
    );

    // El mismo code en OTRO tenant es legal: el catálogo es de cada negocio.
    await expect(
      prisma.withTenantContext(tenantBId, (tx) =>
        tx.service.create({ data: { tenantId: tenantBId, code, name: "Corte" } }),
      ),
    ).resolves.toBeDefined();

    // Repetirlo dentro del MISMO tenant, no.
    await expect(
      prisma.withTenantContext(tenantAId, (tx) =>
        tx.service.create({ data: { tenantId: tenantAId, code, name: "Otro" } }),
      ),
    ).rejects.toThrow();
  });
});
