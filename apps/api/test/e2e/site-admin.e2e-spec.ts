import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  makePlatformAdmin,
  registerTenant,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F11-SITE-LEAD-08/09/10 — el sitio público dentro del backoffice.
 *
 * Lo primero que se prueba es lo que más importa: que un usuario normal —el
 * dueño de un negocio, con TODOS los permisos de su tenant— reciba 403. La
 * lista de prospectos son datos de gente que nos escribió; no es de nadie más
 * que de la plataforma.
 */
describe("El sitio público en el backoffice (F11-SITE-LEAD-08/09/10)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let normal: TenantFixture;
  const stamp = randomUUID().slice(0, 8);
  const marca = `admin-${stamp}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    normal = await registerTenant(app, "site-normal");
    admin = await registerTenant(app, "site-admin");
    // El ÚLTIMO en llamar a esta función es el único admin vigente (la
    // whitelist es una sola cadena): por eso va después del usuario normal.
    await makePlatformAdmin(app, prisma, admin);

    await prisma.siteLead.createMany({
      data: [
        {
          name: "Quien escribió primero",
          email: `uno-${stamp}@example.com`,
          country: "MX",
          locale: "es",
          route: "es-mx",
          planInterest: "pro",
          businessType: marca,
          consentAt: new Date("2026-09-10T18:00:00.000Z"),
          consentText: "Acepto.",
          createdAt: new Date("2026-09-10T18:00:00.000Z"),
          notifiedAt: new Date("2026-09-10T18:00:01.000Z"),
        },
        {
          name: "Quien escribió después",
          email: `dos-${stamp}@example.com`,
          country: "CA",
          locale: "fr",
          route: "fr-ca",
          planInterest: "custom",
          businessType: marca,
          consentAt: new Date("2026-09-12T18:00:00.000Z"),
          consentText: "J'accepte.",
          createdAt: new Date("2026-09-12T18:00:00.000Z"),
        },
      ],
    });
    await prisma.siteEvent.createMany({
      data: [
        {
          event: "form_open",
          market: "mx",
          locale: "es",
          section: marca,
          createdAt: new Date("2026-09-11T18:00:00.000Z"),
        },
        {
          event: "form_open",
          market: "mx",
          locale: "es",
          section: marca,
          createdAt: new Date("2026-09-11T18:00:00.000Z"),
        },
        {
          event: "form_submit",
          market: "mx",
          locale: "es",
          section: marca,
          referrerDomain: "google.com",
          createdAt: new Date("2026-09-11T19:00:00.000Z"),
        },
        {
          event: "cta_click",
          market: "ca",
          locale: "fr",
          section: marca,
          referrerDomain: "google.com",
          createdAt: new Date("2026-09-11T19:30:00.000Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.siteLead.deleteMany({ where: { businessType: marca } });
    await prisma.siteEvent.deleteMany({ where: { section: marca } });
    await app.close();
  });

  describe("la puerta", () => {
    it.each([
      ["GET", "/admin/site/leads"],
      ["GET", "/admin/site/events/summary?from=2026-09-01&to=2026-09-30"],
      ["POST", "/admin/site/leads/retention/run"],
    ])("un usuario normal recibe 403 en %s %s", async (metodo, ruta) => {
      const peticion =
        metodo === "GET"
          ? request(app.getHttpServer()).get(ruta)
          : request(app.getHttpServer()).post(ruta);

      await peticion.set("Authorization", bearer(normal.token)).expect(403);
    });

    it("sin token tampoco: la puerta es doble", async () => {
      await request(app.getHttpServer()).get("/admin/site/leads").expect(401);
    });
  });

  describe("GET /admin/site/leads", () => {
    it("devuelve items y total, el más nuevo primero, con `notified` derivado", async () => {
      const { body } = await request(app.getHttpServer())
        .get("/admin/site/leads?from=2026-09-01&to=2026-09-30&pageSize=200")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      const mios = (body.items as { email: string; notified: boolean; name: string }[]).filter(
        (fila) => fila.email.endsWith(`-${stamp}@example.com`),
      );
      expect(mios.map((fila) => fila.name)).toEqual([
        "Quien escribió después",
        "Quien escribió primero",
      ]);
      expect(mios[0]?.notified).toBe(false);
      expect(mios[1]?.notified).toBe(true);
      expect(typeof body.total).toBe("number");
    });

    it("un rango que no los alcanza no los trae", async () => {
      const { body } = await request(app.getHttpServer())
        .get("/admin/site/leads?from=2026-01-01&to=2026-01-31&pageSize=200")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      expect(
        (body.items as { email: string }[]).filter((fila) =>
          fila.email.endsWith(`-${stamp}@example.com`),
        ),
      ).toEqual([]);
    });

    it("un rango con formato inválido es 400, no un rango silencioso", async () => {
      await request(app.getHttpServer())
        .get("/admin/site/leads?from=01/09/2026")
        .set("Authorization", bearer(admin.token))
        .expect(400);
    });
  });

  describe("GET /admin/site/events/summary", () => {
    it("cuenta por evento y por mercado, con la tasa y el top de orígenes", async () => {
      const { body } = await request(app.getHttpServer())
        .get("/admin/site/events/summary?from=2026-09-11&to=2026-09-11")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      expect(body.byEvent).toMatchObject({ form_open: 2, form_submit: 1, cta_click: 1 });
      expect(body.byMarket).toMatchObject({ mx: 3, ca: 1 });
      expect(body.formOpenToSubmitRate).toBe(0.5);
      expect(body.topReferrers).toEqual([
        { domain: "google.com", formSubmit: 1, ctaClick: 1, total: 2 },
      ]);
    });

    it("filtrado por mercado deja fuera al otro", async () => {
      const { body } = await request(app.getHttpServer())
        .get("/admin/site/events/summary?from=2026-09-11&to=2026-09-11&market=ca")
        .set("Authorization", bearer(admin.token))
        .expect(200);

      expect(body.byEvent).toMatchObject({ cta_click: 1, form_open: 0 });
      expect(body.formOpenToSubmitRate).toBeNull();
    });

    it("el rango es obligatorio: sin él, 400", async () => {
      await request(app.getHttpServer())
        .get("/admin/site/events/summary")
        .set("Authorization", bearer(admin.token))
        .expect(400);
    });
  });

  describe("POST /admin/site/leads/retention/run", () => {
    it("responde cuántos borró y no se lleva a los recientes", async () => {
      const { body } = await request(app.getHttpServer())
        .post("/admin/site/leads/retention/run")
        .set("Authorization", bearer(admin.token))
        .expect(201);

      expect(typeof body.deleted).toBe("number");
      expect(await prisma.siteLead.count({ where: { businessType: marca } })).toBe(2);
    });
  });
});
