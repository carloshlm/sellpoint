import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { PrismaService } from "./prisma.service";

/**
 * Integration (Postgres real, conectado como sellpoint_app — f1-auth design
 * §8). Requiere las migraciones aplicadas en DATABASE_URL (sellpoint_dev).
 */
describe("PrismaService — withTenantContext (integration)", () => {
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();

    const tenantA = await prisma.tenant.create({ data: { name: "Tenant A - withTenantContext" } });
    const tenantB = await prisma.tenant.create({ data: { name: "Tenant B - withTenantContext" } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await prisma.withTenantContext(tenantAId, (tx) =>
      tx.user.create({
        data: {
          tenantId: tenantAId,
          email: `user-a-${Date.now()}@example.com`,
          firstName: "Ana",
          lastNamePaternal: "Test",
        },
      }),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("filtra por tenant: dentro del contexto correcto ve sus propias filas", async () => {
    const users = await prisma.withTenantContext(tenantAId, (tx) =>
      tx.user.findMany({ where: { tenantId: tenantAId } }),
    );

    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.tenantId === tenantAId)).toBe(true);
  });

  it("tenant ajeno → 0 filas (RLS aísla aunque la query no filtre explícitamente por tenantId)", async () => {
    const users = await prisma.withTenantContext(tenantBId, (tx) => tx.user.findMany());

    expect(users).toHaveLength(0);
  });

  it("el contexto no fuga fuera de la transacción: una query posterior sin contexto ve 0 filas", async () => {
    await prisma.withTenantContext(tenantAId, (tx) => tx.user.findMany());

    const usersSinContexto = await prisma.user.findMany();

    expect(usersSinContexto).toHaveLength(0);
  });

  describe("canario R1 (gap de infra): sellpoint_app sin contexto no puede leer nada", () => {
    it("SELECT * FROM users sin set_config devuelve 0 filas", async () => {
      const rows = await prisma.$queryRaw<unknown[]>`SELECT * FROM users`;

      expect(rows).toHaveLength(0);
    });
  });
});
