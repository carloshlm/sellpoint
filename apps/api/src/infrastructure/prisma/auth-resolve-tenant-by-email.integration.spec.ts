import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, sellpoint_app): la función SECURITY DEFINER
 * `auth_resolve_tenant_by_email` — ÚNICA excepción de RLS del sistema
 * (f1-auth AD-2). Ver también prisma.service.spec.ts.
 */
describe("auth_resolve_tenant_by_email() — SECURITY DEFINER", () => {
  let prisma: PrismaService;
  let tenantId: string;
  const email = `security-definer-${Date.now()}@example.com`;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenant = await prisma.tenant.create({ data: { name: "Tenant SECURITY DEFINER" } });
    tenantId = tenant.id;

    await prisma.withTenantContext(tenantId, (tx) =>
      tx.user.create({
        data: { tenantId, email, firstName: "Def", lastNamePaternal: "Sec" },
      }),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("devuelve el tenant_id correcto para un email existente, SIN contexto de tenant abierto", async () => {
    const rows = await prisma.$queryRaw<
      { tenant_id: string | null }[]
    >`SELECT auth_resolve_tenant_by_email(${email}) AS tenant_id`;

    expect(rows[0].tenant_id).toBe(tenantId);
  });

  it("devuelve NULL para un email que no existe (sin filtrar existencia por otro medio)", async () => {
    const rows = await prisma.$queryRaw<
      { tenant_id: string | null }[]
    >`SELECT auth_resolve_tenant_by_email('no-existe-nadie@example.com') AS tenant_id`;

    expect(rows[0].tenant_id).toBeNull();
  });

  it("normaliza el email (case-insensitive + trim) igual que la unicidad global", async () => {
    const rows = await prisma.$queryRaw<
      { tenant_id: string | null }[]
    >`SELECT auth_resolve_tenant_by_email(${`  ${email.toUpperCase()}  `}) AS tenant_id`;

    expect(rows[0].tenant_id).toBe(tenantId);
  });

  it("EXECUTE está revocado de PUBLIC (solo sellpoint_app puede invocarla)", async () => {
    const grants = await prisma.$queryRaw<
      { grantee_oid: number; privilege_type: string }[]
    >`SELECT (aclexplode(proacl)).grantee AS grantee_oid, (aclexplode(proacl)).privilege_type
      FROM pg_proc WHERE proname = 'auth_resolve_tenant_by_email'`;

    // grantee_oid = 0 es el pseudo-rol PUBLIC en la representación de aclexplode.
    const publicExecuteGrant = grants.find(
      (g) => g.grantee_oid === 0 && g.privilege_type === "EXECUTE",
    );
    expect(publicExecuteGrant).toBeUndefined();

    const appExecuteGrant = await prisma.$queryRaw<
      { has_privilege: boolean }[]
    >`SELECT has_function_privilege('sellpoint_app', 'public.auth_resolve_tenant_by_email(text)', 'EXECUTE') AS has_privilege`;
    expect(appExecuteGrant[0].has_privilege).toBe(true);
  });

  it("el índice único de email es GLOBAL (case-insensitive) — un mismo email no puede repetirse ni en OTRO tenant", async () => {
    const otherTenant = await prisma.tenant.create({ data: { name: "Otro tenant, mismo email" } });

    await expect(
      prisma.withTenantContext(otherTenant.id, (tx) =>
        tx.user.create({
          data: {
            tenantId: otherTenant.id,
            email: email.toUpperCase(),
            firstName: "Duplicado",
            lastNamePaternal: "Test",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
