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
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { TenantTransactionsGate } from "../../src/modules/tenants/tenant-transactions.gate";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";

/**
 * e2e de F1-WEB-ONBOARD-01: `GET/PATCH /tenants/me`,
 * `POST /tenants/me/complete-onboarding`, el bloque `tenant` de
 * `POST /auth/login` y `GET /me` (A1 del design), y la data migration de
 * `tenants:manage`.
 */
describe("/tenants/me (e2e, F1-WEB-ONBOARD-01)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
  let tokenService: TokenService;
  let prisma: PrismaService;
  let gate: TenantTransactionsGate;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    mailer = app.get<NoopMailer>(MAILER);
    tokenService = app.get(TokenService);
    prisma = app.get(PrismaService);
    gate = app.get(TenantTransactionsGate);
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  async function registerActiveOwner(): Promise<{
    tenantId: string;
    userId: string;
    email: string;
    accessToken: string;
  }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registerResponse = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Acme ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    const body = registerResponse.body as { tenantId: string; userId: string };
    return { ...body, email, accessToken: login.body.accessToken as string };
  }

  describe("PATCH /tenants/me", () => {
    it("sin tenants:manage -> 403", async () => {
      const owner = await registerActiveOwner();
      // Token propio (mismo tenant) pero SIN tenants:manage — mismo patrón
      // que rbac-users-roles-matrix.e2e-spec.ts: firmar el JWT directo, sin
      // pasar por una invitación real.
      const noPermToken = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId: owner.tenantId,
        permissions: [],
        locale: "es",
      });

      const response = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(noPermToken))
        .send({ legalName: "Acme SA de CV" })
        .expect(403);

      expect(response.body).toMatchObject({ statusCode: 403 });
    });

    // 01.5: el guard se ejercita con el mock AISLADO (mockResolvedValueOnce +
    // mockRestore) — el caso real (F1: hasTransactions siempre false) se
    // prueba en un test APARTE, sin tocar el mock, para que un mock que
    // quede pegado no maquille un falso verde.
    it("moneda bloqueada: TenantCurrencyChangeableGuard con hasTransactions=true -> 403 tenants.currency_locked", async () => {
      const owner = await registerActiveOwner();
      const spy = jest.spyOn(gate, "hasTransactions").mockResolvedValueOnce(true);

      try {
        const response = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ currency: "USD" })
          .expect(403);

        expect(response.body).toMatchObject({ code: "tenants.currency_locked" });
      } finally {
        spy.mockRestore();
      }
    });

    it("moneda editable en F1 (real, SIN mock — hasTransactions siempre false hoy): PATCH currency responde 200", async () => {
      const owner = await registerActiveOwner();

      const response = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ currency: "USD" })
        .expect(200);

      expect(response.body).toMatchObject({ currency: "USD" });
    });

    // Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2): `country` es ISO
    // 3166-1 alpha-2, validado contra `isCountryCode` (`@sellpoint/shared`)
    // — mismo catálogo que el selector del front, sin CHECK SQL.
    it("país válido: PATCH country persiste y un GET posterior lo refleja", async () => {
      const owner = await registerActiveOwner();

      const patchResponse = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ country: "MX" })
        .expect(200);

      expect(patchResponse.body).toMatchObject({ country: "MX" });

      const getResponse = await request(app.getHttpServer())
        .get("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      expect(getResponse.body).toMatchObject({ country: "MX" });
    });

    it("país en formato inválido (minúsculas) -> 400 tenants.invalid_country", async () => {
      const owner = await registerActiveOwner();

      const response = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ country: "mx" })
        .expect(400);

      expect(response.body).toMatchObject({ code: "tenants.invalid_country" });
    });

    it("país inexistente ('XX' no está en el catálogo) -> 400 tenants.invalid_country", async () => {
      const owner = await registerActiveOwner();

      const response = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ country: "XX" })
        .expect(400);

      expect(response.body).toMatchObject({ code: "tenants.invalid_country" });
    });

    it("actualización parcial exitosa: persiste y un GET posterior refleja los cambios", async () => {
      const owner = await registerActiveOwner();

      const patchResponse = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          timezone: "America/Monterrey",
        })
        .expect(200);

      expect(patchResponse.body).toMatchObject({
        legalName: "Acme SA de CV",
        taxId: "ACM010101AAA",
        address: "Av. Siempre Viva 123",
        timezone: "America/Monterrey",
      });

      const getResponse = await request(app.getHttpServer())
        .get("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);

      expect(getResponse.body).toMatchObject({
        legalName: "Acme SA de CV",
        taxId: "ACM010101AAA",
        address: "Av. Siempre Viva 123",
        timezone: "America/Monterrey",
      });
    });

    // W4 (verify-report #357, revierte Deviation 6): `warehouseStepSeen`
    // existió y se eliminó — el DTO ya no lo acepta, así que enviarlo
    // (junto con `legalName`, para que el body no quede vacío) simplemente
    // se ignora, sin 400 ni columna que persistir.
    it("W4: warehouseStepSeen ya NO es un campo del DTO — se ignora silenciosamente", async () => {
      const owner = await registerActiveOwner();

      const patchResponse = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ legalName: "Acme SA de CV", warehouseStepSeen: true })
        .expect(200);

      expect(patchResponse.body).toMatchObject({ legalName: "Acme SA de CV" });
      expect(patchResponse.body).not.toHaveProperty("warehouseStepSeen");
    });

    /**
     * Teléfono del negocio (Carlos, 2026-08-25): editable desde "Mi perfil",
     * NO desde el wizard. Es el único campo del tenant que se puede BORRAR
     * (null): el wizard nunca lo pidió, así que exigirlo una vez capturado
     * sería atrapar al usuario con un dato que siempre fue opcional.
     */
    describe("phone (Mi perfil, 2026-08-25)", () => {
      it("PATCH phone persiste y un GET posterior lo refleja", async () => {
        const owner = await registerActiveOwner();

        const patchResponse = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: "+52 55 1234 5678" })
          .expect(200);

        expect(patchResponse.body).toMatchObject({ phone: "+52 55 1234 5678" });

        const getResponse = await request(app.getHttpServer())
          .get("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .expect(200);

        expect(getResponse.body).toMatchObject({ phone: "+52 55 1234 5678" });
      });

      it("phone: null lo BORRA (es opcional también después de capturarlo)", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: "+52 55 1234 5678" })
          .expect(200);

        const cleared = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: null })
          .expect(200);

        expect(cleared.body).toMatchObject({ phone: null });
      });

      it("un phone que no cabe en la columna (más de 20) -> 400", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: "+52 55 1234 5678 9999 0000" })
          .expect(400);
      });
    });

    it("body vacío -> 400 tenants.invalid_body", async () => {
      const owner = await registerActiveOwner();

      const response = await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({ code: "tenants.invalid_body" });
    });

    it("sin Authorization -> 401 (secure by default)", () => {
      return request(app.getHttpServer()).patch("/tenants/me").send({ legalName: "x" }).expect(401);
    });

    // 01.7: registra tenant.updated en audit_logs.
    it("audita tenant.updated", async () => {
      const owner = await registerActiveOwner();

      await request(app.getHttpServer())
        .patch("/tenants/me")
        .set("Authorization", bearer(owner.accessToken))
        .send({ legalName: "Acme Auditada SA" })
        .expect(200);

      const audit = await prisma.withTenantContext(owner.tenantId, (tx) =>
        tx.auditLog.findFirst({
          where: { tenantId: owner.tenantId, action: "tenant.updated" },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(audit).toMatchObject({ resourceType: "tenant", resourceId: owner.tenantId });
    });
  });

  describe("POST /tenants/me/complete-onboarding", () => {
    it("marca onboarded=true; llamarlo 2 veces es idempotente (sin error)", async () => {
      const owner = await registerActiveOwner();

      const first = await request(app.getHttpServer())
        .post("/tenants/me/complete-onboarding")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      expect(first.body).toMatchObject({ onboarded: true });

      const second = await request(app.getHttpServer())
        .post("/tenants/me/complete-onboarding")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      expect(second.body).toMatchObject({ onboarded: true });
    });

    it("sin tenants:manage -> 403", async () => {
      const owner = await registerActiveOwner();
      const noPermToken = tokenService.signAccessToken({
        sub: randomUUID(),
        tenantId: owner.tenantId,
        permissions: [],
        locale: "es",
      });

      await request(app.getHttpServer())
        .post("/tenants/me/complete-onboarding")
        .set("Authorization", bearer(noPermToken))
        .expect(403);
    });
  });

  // 01.9: mismo shape entre LoginResult.user.tenant y MeProfile.tenant (A1
  // del design) — el riesgo explícito es que diverjan con el tiempo.
  describe("Contrato: tenant en POST /auth/login === tenant en GET /me (A1)", () => {
    it("las mismas keys y los mismos valores en ambos endpoints", async () => {
      const email = `owner-${randomUUID()}@example.com`;
      const registerResponse = await request(app.getHttpServer())
        .post("/auth/register-tenant")
        .send({
          tenantName: `Acme ${randomUUID()}`,
          email,
          password: PASSWORD,
          firstName: "Ana",
          lastNamePaternal: "Pérez",
          locale: "es",
        })
        .expect(201);
      const sentMail = mailer.sent.find((m) => m.to === email);
      const token = extractTokenFromLink(sentMail?.vars.link);
      await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

      const loginResponse = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password: PASSWORD })
        .expect(200);

      const meResponse = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(loginResponse.body.accessToken as string))
        .expect(200);

      const loginTenant = loginResponse.body.user.tenant;
      const meTenant = meResponse.body.tenant;

      expect(loginTenant).toBeDefined();
      expect(meTenant).toBeDefined();
      expect(Object.keys(loginTenant).sort()).toEqual(Object.keys(meTenant).sort());
      expect(loginTenant).toEqual(meTenant);
      const body = registerResponse.body as { tenantId: string };
      expect(loginTenant).toMatchObject({ id: body.tenantId, onboarded: false });
    });
  });

  // 01.11/01.12: la data migration otorga `tenants:manage` a TenantAdmin de
  // tenants YA EXISTENTES (creados antes de que la migración corriera), sin
  // duplicar el grant. Se simula el estado "pre-migración" a mano (un tenant
  // + rol TenantAdmin SIN el permiso) y se re-ejecuta el SQL real de la
  // migración — así el test cae si alguien edita el archivo y rompe el
  // ON CONFLICT DO NOTHING.
  describe("Data migration: tenants:manage llega a TenantAdmin existentes", () => {
    it("otorga el permiso sin duplicar al re-aplicar el mismo SQL dos veces", async () => {
      // El tenant/rol "legacy" se crea con el cliente RUNTIME (sellpoint_app,
      // sujeto a RLS) — así nace cualquier tenant real.
      const tenant = await prisma.tenant.create({
        data: { name: `Legacy ${randomUUID()}` },
      });
      const role = await prisma.withTenantContext(tenant.id, (tx) =>
        tx.role.create({ data: { tenantId: tenant.id, name: "TenantAdmin" } }),
      );

      // La migración real corre con DATABASE_URL_ADMIN (superuser: bypasea
      // RLS — ver prisma.config.ts). Replayarla con el cliente RUNTIME
      // (sujeto a RLS) daría 0 filas en el `SELECT ... FROM roles` — un
      // falso rojo que no refleja cómo corre `prisma migrate deploy` de
      // verdad. Mismo cliente admin que `prisma/seed.ts`.
      const adminConnectionString = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
      if (!adminConnectionString) {
        throw new Error("Falta DATABASE_URL_ADMIN (o DATABASE_URL) para replayar la migración");
      }
      const adminPrisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminConnectionString }),
      });

      try {
        const migrationSql = readFileSync(
          join(
            __dirname,
            "../../prisma/migrations/20260815021155_tenants_manage_permission/migration.sql",
          ),
          "utf-8",
        );
        const sqlWithoutComments = migrationSql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n");
        const statements = sqlWithoutComments
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
        // Segunda pasada: el ON CONFLICT DO NOTHING no debe romper ni duplicar.
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
      } finally {
        await adminPrisma.$disconnect();
      }

      const grants = await prisma.withTenantContext(tenant.id, (tx) =>
        tx.rolePermission.findMany({
          where: { roleId: role.id, permission: { code: "tenants:manage" } },
        }),
      );
      expect(grants).toHaveLength(1);
    });
  });
});
