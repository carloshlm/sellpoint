import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { PRODUCTS_CATALOG_KEY } from "../../src/modules/tenants/role-catalog";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * e2e del motor de catálogos (F2-CAT). Registra tenants REALES por el flujo
 * público, igual que el resto de la suite — sin fixtures que se salteen la
 * lógica que se quiere probar.
 */
describe("Motor de catálogos (F2-CAT)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerTenant(): Promise<{ tenantId: string; userId: string }> {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant catálogo ${randomUUID()}`,
        email: `owner-${randomUUID()}@example.com`,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    return response.body as { tenantId: string; userId: string };
  }

  /** Tenant verificado + logueado: devuelve su access token real. */
  async function registerAndLogin(): Promise<{ tenantId: string; token: string }> {
    const email = `owner-${randomUUID()}@example.com`;
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant catálogo ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);

    return {
      tenantId: (response.body as { tenantId: string }).tenantId,
      token: (login.body as { accessToken: string }).accessToken,
    };
  }

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  describe("F2-CAT-01 — Catálogo de Productos del sistema", () => {
    it("un tenant recién registrado ya tiene su Catálogo de Productos", async () => {
      const { tenantId } = await registerTenant();

      const catalogs = await prisma.withTenantContext(tenantId, (tx) => tx.catalog.findMany());

      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]).toMatchObject({ systemKey: PRODUCTS_CATALOG_KEY, isSystem: true });
    });

    it("cada tenant tiene el SUYO: el catálogo no se comparte entre negocios", async () => {
      // Secuencial a propósito: la suite corre con `maxWorkers: 1` y el
      // servidor efímero de supertest da ECONNRESET con flujos de registro
      // concurrentes. La concurrencia acá no prueba nada extra.
      const first = await registerTenant();
      const second = await registerTenant();

      const firstCatalogs = await prisma.withTenantContext(first.tenantId, (tx) =>
        tx.catalog.findMany(),
      );
      const secondCatalogs = await prisma.withTenantContext(second.tenantId, (tx) =>
        tx.catalog.findMany(),
      );

      expect(firstCatalogs).toHaveLength(1);
      expect(secondCatalogs).toHaveLength(1);
      expect(firstCatalogs[0]?.id).not.toBe(secondCatalogs[0]?.id);
    });

    it("el backfill le da catálogo a un tenant PRE-F2 y es idempotente", async () => {
      // Se replaya la migración de backfill como corre de verdad
      // (`prisma migrate deploy` con el superuser, que bypasea RLS — mismo
      // patrón que `tenants-me.e2e-spec.ts`). No se puede afirmar "ningún
      // tenant sin catálogo" globalmente: otras suites crean tenants crudos
      // con `prisma.tenant.create()`, salteándose `provision()` a propósito.
      const adminConnectionString = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
      if (!adminConnectionString) {
        throw new Error("Falta DATABASE_URL_ADMIN (o DATABASE_URL) para replayar la migración");
      }
      const adminPrisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminConnectionString }),
      });

      try {
        // Un tenant "viejo": creado sin pasar por provision(), como los que
        // existían antes de Fase 2.
        const legacy = await adminPrisma.tenant.create({
          data: { name: `Tenant pre-F2 ${randomUUID()}` },
        });

        const before = await adminPrisma.catalog.count({ where: { tenantId: legacy.id } });
        expect(before).toBe(0);

        const migrationSql = readFileSync(
          join(
            __dirname,
            "../../prisma/migrations/20260816212000_products_catalog_backfill/migration.sql",
          ),
          "utf-8",
        );
        const statements = migrationSql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0);

        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }

        const after = await adminPrisma.catalog.findMany({ where: { tenantId: legacy.id } });
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({ systemKey: PRODUCTS_CATALOG_KEY, isSystem: true });

        // Segunda pasada: el NOT EXISTS no debe duplicar ni romper.
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
        expect(await adminPrisma.catalog.count({ where: { tenantId: legacy.id } })).toBe(1);
      } finally {
        await adminPrisma.$disconnect();
      }
    });
  });

  describe("F2-CAT-02 — CRUD de catálogos", () => {
    it("GET /catalogs devuelve el del sistema primero", async () => {
      const { token } = await registerAndLogin();

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: "Aaa primero alfabeticamente" })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);

      const catalogs = response.body as { isSystem: boolean; name: string }[];
      expect(catalogs).toHaveLength(2);
      // Aunque el subcatálogo gane por nombre, el del sistema va primero: es
      // el que el usuario viene a editar el 90% de las veces.
      expect(catalogs[0]?.isSystem).toBe(true);
    });

    it("crea un subcatálogo y lo renombra", async () => {
      const { token } = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send({ name: "Unidades de medida" })
        .expect(201);

      const { id } = created.body as { id: string };
      expect(created.body).toMatchObject({ isSystem: false, systemKey: null, isActive: true });

      const renamed = await request(app.getHttpServer())
        .patch(`/catalogs/${id}`)
        .set("Authorization", bearer(token))
        .send({ name: "Unidades" })
        .expect(200);

      expect(renamed.body).toMatchObject({ name: "Unidades" });
    });

    it("nombre repetido dentro del tenant → 409", async () => {
      const { token } = await registerAndLogin();
      const payload = { name: `Proveedores ${randomUUID()}` };

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(token))
        .send(payload)
        .expect(409);
    });

    it("el catálogo del sistema NO se renombra ni se archiva → 409", async () => {
      const { token } = await registerAndLogin();
      const list = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(token))
        .expect(200);
      const system = (list.body as { id: string; isSystem: boolean }[]).find((c) => c.isSystem);

      await request(app.getHttpServer())
        .patch(`/catalogs/${system?.id}`)
        .set("Authorization", bearer(token))
        .send({ name: "Mis cosas" })
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/catalogs/${system?.id}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(409);
    });

    it("un tenant NO ve ni toca los catálogos de otro", async () => {
      const first = await registerAndLogin();
      const second = await registerAndLogin();

      const created = await request(app.getHttpServer())
        .post("/catalogs")
        .set("Authorization", bearer(first.token))
        .send({ name: `Privado ${randomUUID()}` })
        .expect(201);
      const { id } = created.body as { id: string };

      // El de B solo ve SU catálogo del sistema.
      const listB = await request(app.getHttpServer())
        .get("/catalogs")
        .set("Authorization", bearer(second.token))
        .expect(200);
      expect(listB.body).toHaveLength(1);

      // Y tocar el de A por id es 404, no 403: no se confirma que exista.
      await request(app.getHttpServer())
        .patch(`/catalogs/${id}`)
        .set("Authorization", bearer(second.token))
        .send({ name: "Robado" })
        .expect(404);
    });

    it("sin autenticación no se llega al motor", async () => {
      await request(app.getHttpServer()).get("/catalogs").expect(401);
    });
  });

  it("un Viewer LEE los catálogos pero no puede crear ni modificar (403)", async () => {
    // El gate declarativo es una línea por endpoint: `catalogs:read` para
    // leer, `catalogs:manage` para tocar la estructura. Poner el code
    // equivocado en un @RequirePermissions no rompe ningún otro test.
    const owner = await registerAndLogin();

    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.token))
      .expect(200);
    const viewerRoleId = (roles.body as { id: string; name: string }[]).find(
      (role) => role.name === "Viewer",
    )?.id;

    const email = `viewer-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.token))
      .send({ email, firstName: "Bruno", lastNamePaternal: "Díaz", roleIds: [viewerRoleId] })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const inviteToken = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: inviteToken, password: OWNER_PASSWORD })
      .expect(204);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: OWNER_PASSWORD })
      .expect(200);
    const viewerToken = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get("/catalogs")
      .set("Authorization", bearer(viewerToken))
      .expect(200);

    await request(app.getHttpServer())
      .post("/catalogs")
      .set("Authorization", bearer(viewerToken))
      .send({ name: "No deberia poder" })
      .expect(403);
  });
});
