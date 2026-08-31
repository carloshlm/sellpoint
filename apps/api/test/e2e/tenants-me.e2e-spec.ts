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
    describe("monthlySalesGoal (F5-DASH-02, 2026-08-31)", () => {
      // La meta mensual de ventas: el número contra el que el dashboard pinta
      // su barra de «85% alcanzado». Nullable como phone — quitarla es tan
      // válido como ponerla.
      it("PATCH con meta la persiste y un GET posterior la refleja", async () => {
        const owner = await registerActiveOwner();

        const patchResponse = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ monthlySalesGoal: 800000 })
          .expect(200);

        expect(patchResponse.body).toMatchObject({ monthlySalesGoal: "800000" });

        const getResponse = await request(app.getHttpServer())
          .get("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .expect(200);

        expect(getResponse.body).toMatchObject({ monthlySalesGoal: "800000" });
      });

      it("null la BORRA: un negocio puede dejar de perseguir un número", async () => {
        const owner = await registerActiveOwner();
        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ monthlySalesGoal: 500000 })
          .expect(200);

        const res = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ monthlySalesGoal: null })
          .expect(200);

        expect(res.body).toMatchObject({ monthlySalesGoal: null });
      });

      it("una meta negativa -> 400 (contraprueba)", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ monthlySalesGoal: -100 })
          .expect(400);
      });

      it("una meta con más de 2 decimales -> 400: es dinero, no ciencia", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ monthlySalesGoal: 1000.555 })
          .expect(400);
      });
    });

    describe("phone (Mi perfil, 2026-08-25)", () => {
      it("PATCH phone en E.164 canónico persiste y un GET posterior lo refleja", async () => {
        const owner = await registerActiveOwner();

        const patchResponse = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: "+525512345678" })
          .expect(200);

        expect(patchResponse.body).toMatchObject({ phone: "+525512345678" });

        const getResponse = await request(app.getHttpServer())
          .get("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .expect(200);

        expect(getResponse.body).toMatchObject({ phone: "+525512345678" });
      });

      it("phone: null lo BORRA (es opcional también después de capturarlo)", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: "+525512345678" })
          .expect(200);

        const cleared = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone: null })
          .expect(200);

        expect(cleared.body).toMatchObject({ phone: null });
      });

      /**
       * Solo E.164 CANÓNICO (2026-08-25, segunda pasada): la UI compone
       * país + número y manda `+525512345678`; aceptar separadores acá
       * invitaría a que la base acumule cinco formatos del mismo teléfono.
       * La forma bonita es de quien pinta, no de quien guarda.
       */
      it.each([
        ["con separadores", "+52 55 1234 5678"],
        ["sin el prefijo +", "525512345678"],
        ["con letras", "+52ABC512345"],
        ["más largo que el máximo ITU (15 dígitos)", "+5255123456789012"],
        ["más corto que un número marcable", "+5255123"],
      ])("phone NO canónico (%s) -> 400", async (_label, phone) => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ phone })
          .expect(400);
      });
    });

    /**
     * El tema inicial del wizard (Carlos, 2026-08-25): el paso 3 guarda la
     * elección aunque los ESTILOS lleguen después — la columna existe para
     * que la preferencia no se pierda entre el wizard y el selector de
     * Mi perfil. Cuatro valores cerrados, mismo criterio de validación que
     * currency (enum en el DTO, sin CHECK SQL).
     */
    describe("theme (wizard de temas, 2026-08-25)", () => {
      it("PATCH theme válido persiste y un GET posterior lo refleja", async () => {
        const owner = await registerActiveOwner();

        const patchResponse = await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ theme: "grape" })
          .expect(200);
        expect(patchResponse.body).toMatchObject({ theme: "grape" });

        const getResponse = await request(app.getHttpServer())
          .get("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .expect(200);
        expect(getResponse.body).toMatchObject({ theme: "grape" });
      });

      it("los temas de la segunda tanda (2026-08-26) también persisten", async () => {
        const owner = await registerActiveOwner();

        for (const theme of ["emerald", "cabin", "cotton", "charcoal"]) {
          const response = await request(app.getHttpServer())
            .patch("/tenants/me")
            .set("Authorization", bearer(owner.accessToken))
            .send({ theme })
            .expect(200);
          expect(response.body).toMatchObject({ theme });
        }
      });

      it("un theme fuera del catálogo -> 400", async () => {
        const owner = await registerActiveOwner();

        await request(app.getHttpServer())
          .patch("/tenants/me")
          .set("Authorization", bearer(owner.accessToken))
          .send({ theme: "pink" })
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

  /**
   * Data migration de phone (2026-08-25, segunda pasada): el primer despliegue
   * aceptó teléfonos con separadores ("+52 55 1234 5678") y este endurecimiento
   * a E.164 canónico no puede dejar atrás filas que el propio API ya no
   * aceptaría. Mismo molde de replay que la data migration de tenants:manage:
   * se ejecuta el SQL REAL del archivo, dos veces, para probar contenido e
   * idempotencia de una sola pasada.
   */
  describe("Data migration: los phone guardados con separadores quedan canónicos", () => {
    it("normaliza al replay del SQL real y es idempotente", async () => {
      const dirty = await prisma.tenant.create({
        data: { name: `Sucio ${randomUUID()}`, phone: "+52 55 1234 5678" },
      });

      const adminConnectionString = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
      if (!adminConnectionString) {
        throw new Error("Falta DATABASE_URL_ADMIN (o DATABASE_URL) para replayar la migración");
      }
      const adminPrisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: adminConnectionString }),
      });

      try {
        const migrationSql = readFileSync(
          join(__dirname, "../../prisma/migrations/20260825230000_tenant_phone_e164/migration.sql"),
          "utf-8",
        );
        const statements = migrationSql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
      } finally {
        await adminPrisma.$disconnect();
      }

      const normalized = await prisma.tenant.findUniqueOrThrow({ where: { id: dirty.id } });
      expect(normalized.phone).toBe("+525512345678");
    });
  });

  /**
   * Data migration del rename de roles (Carlos, 2026-08-26):
   * TenantAdmin -> Admin y POS_Seller -> Seller para tenants ya
   * provisionados. Mismo molde de replay que las otras: el SQL REAL, dos
   * veces. La guarda NOT EXISTS respeta a un tenant que ya creó su propio
   * "Admin": su rol inicial conserva el nombre viejo en vez de chocar con
   * el unique(tenant_id, name).
   */
  describe("Data migration: los roles iniciales se renombran (2026-08-26)", () => {
    async function replayRename() {
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
            "../../prisma/migrations/20260826050000_rename_initial_roles/migration.sql",
          ),
          "utf-8",
        );
        const statements = migrationSql
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
        for (const statement of statements) {
          await adminPrisma.$executeRawUnsafe(statement);
        }
      } finally {
        await adminPrisma.$disconnect();
      }
    }

    it("renombra los roles viejos al replay del SQL real, idempotente", async () => {
      const tenant = await prisma.tenant.create({ data: { name: `Legacy roles ${randomUUID()}` } });
      await prisma.withTenantContext(tenant.id, async (tx) => {
        await tx.role.create({ data: { tenantId: tenant.id, name: "TenantAdmin" } });
        await tx.role.create({ data: { tenantId: tenant.id, name: "POS_Seller" } });
      });

      await replayRename();

      const nombres = await prisma.withTenantContext(tenant.id, (tx) =>
        tx.role.findMany({ where: { tenantId: tenant.id }, select: { name: true } }),
      );
      expect(nombres.map((r) => r.name).sort()).toEqual(["Admin", "Seller"]);
    });

    it("un tenant que YA tenía su propio rol «Admin» no choca: el inicial conserva el nombre viejo", async () => {
      const tenant = await prisma.tenant.create({ data: { name: `Conflicto ${randomUUID()}` } });
      await prisma.withTenantContext(tenant.id, async (tx) => {
        await tx.role.create({ data: { tenantId: tenant.id, name: "TenantAdmin" } });
        await tx.role.create({ data: { tenantId: tenant.id, name: "Admin" } });
      });

      await replayRename();

      const nombres = await prisma.withTenantContext(tenant.id, (tx) =>
        tx.role.findMany({ where: { tenantId: tenant.id }, select: { name: true } }),
      );
      expect(nombres.map((r) => r.name).sort()).toEqual(["Admin", "TenantAdmin"]);
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
