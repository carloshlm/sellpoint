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

  describe("withNewTenantContext (f1-auth U2, register-tenant)", () => {
    it("permite crear el tenant y recién después abrir su propio contexto en la misma tx", async () => {
      const result = await prisma.withNewTenantContext(async (tx, setTenantContext) => {
        const tenant = await tx.tenant.create({
          data: { name: "Tenant nuevo - withNewTenantContext" },
        });
        await setTenantContext(tenant.id);

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: `owner-${Date.now()}@example.com`,
            firstName: "Owner",
            lastNamePaternal: "Test",
          },
        });

        return { tenantId: tenant.id, userId: user.id };
      });

      const usersEnContexto = await prisma.withTenantContext(result.tenantId, (tx) =>
        tx.user.findMany({ where: { tenantId: result.tenantId } }),
      );
      expect(usersEnContexto).toHaveLength(1);
      expect(usersEnContexto[0]?.id).toBe(result.userId);
    });

    it("el contexto abierto adentro no fuga fuera de la transacción", async () => {
      await prisma.withNewTenantContext(async (tx, setTenantContext) => {
        const tenant = await tx.tenant.create({
          data: { name: "Tenant fuga - withNewTenantContext" },
        });
        await setTenantContext(tenant.id);
        return tenant.id;
      });

      const usersSinContexto = await prisma.user.findMany();
      expect(usersSinContexto).toHaveLength(0);
    });
  });
});

/**
 * El rol de conexión NO puede saltarse RLS.
 *
 * `setup-env.js` ya documenta la regla (f1-auth R1/U1-12: la API conecta
 * SIEMPRE como `sellpoint_app`, nunca como el superusuario `sellpoint`) y la
 * cuida con un default en los tests. Pero eso solo protege a los tests: un
 * `.env` viejo o un servidor mal configurado apuntan `DATABASE_URL` al
 * superusuario y la API arranca tan campante, con el aislamiento entre
 * negocios APAGADO y sin un solo error a la vista.
 *
 * Descubierto el 2026-08-31 en el entorno local de Carlos: un negocio recién
 * creado, sin un solo movimiento, recibía un 403 de "ya tienes transacciones"
 * porque el conteo veía las filas de TODOS los demás negocios.
 */
describe("PrismaService — el rol de conexión no puede saltarse RLS", () => {
  it("con un rol BYPASSRLS el arranque FALLA en vez de servir datos cruzados", async () => {
    const conSuperusuario = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL_ADMIN }),
    );

    await expect(conSuperusuario.onModuleInit()).rejects.toThrow(/RLS/);

    await conSuperusuario.onModuleDestroy();
  });

  it("con el rol de la aplicación arranca normal", async () => {
    const conRolDeApp = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );

    await expect(conRolDeApp.onModuleInit()).resolves.toBeUndefined();

    await conRolDeApp.onModuleDestroy();
  });
});
