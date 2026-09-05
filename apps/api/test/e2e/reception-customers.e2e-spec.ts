import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  BILLING_TEST_PASSWORD,
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-RECEP-14 — el registro de clientes de punta a punta.
 *
 * Lo que fija:
 *  - el CRUD y el orden (más reciente primero) con la edad calculada;
 *  - RLS: lo de un negocio no se ve, ni se edita, ni se borra desde otro (404,
 *    no 403 — no confirmamos que exista);
 *  - el módulo apagado responde 402 en TODAS las rutas, también los GET
 *    (es el 402 real de `@RequiresModule`, prometido en F9-MOD-10);
 *  - el permiso: un Viewer lee y recibe 403 al crear;
 *  - un teléfono sin prefijo internacional rebota con 400.
 */
describe("Recepción — clientes (F9-RECEP-14)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let otro: TenantFixture;
  let sinModulo: TenantFixture;
  let viewerToken: string;

  const activarRecepcion = (tenantId: string) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/modules`)
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", customPrice: "1250.00", reason: "e2e" })
      .expect(201);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "recep-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "recep");
    otro = await registerTenant(app, "recep-otro");
    sinModulo = await registerTenant(app, "recep-sin");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
    await setTenantMarket(prisma, otro.tenantId, "MX");
    await activarRecepcion(negocio.tenantId);
    await activarRecepcion(otro.tenantId);

    // Un Viewer del negocio: invitado por el owner, canjea la invitación
    // (POST /auth/reset-password, no hay endpoint aparte) y entra.
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const viewer = (roles.body as { id: string; name: string }[]).find((r) => r.name === "Viewer");
    const email = `recep-viewer-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(negocio.token))
      .send({ email, firstName: "Vera", lastNamePaternal: "Vista", roleIds: [viewer?.id] })
      .expect(201);
    const mailer = app.get<NoopMailer>(MAILER);
    const token = extractTokenFromLink(mailer.sent.filter((m) => m.to === email).at(-1)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: BILLING_TEST_PASSWORD })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: BILLING_TEST_PASSWORD })
      .expect(200);
    viewerToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const crear = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post("/reception/customers")
      .set("Authorization", bearer(token))
      .send(body);

  it("alta, listado del más reciente al más viejo, edición y baja", async () => {
    const primero = await crear(negocio.token, {
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      birthDate: "1990-09-02",
      phone: "+525512345678",
    }).expect(201);
    const segundo = await crear(negocio.token, {
      firstName: "Luis",
      lastNamePaternal: "Gómez",
    }).expect(201);
    const idPrimero = (primero.body as { id: string }).id;
    const idSegundo = (segundo.body as { id: string }).id;

    const lista = await request(app.getHttpServer())
      .get("/reception/customers")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const filas = (
      lista.body as { rows: { id: string; age: number | null; birthDate: string | null }[] }
    ).rows;
    expect(filas.map((f) => f.id)).toEqual([idSegundo, idPrimero]);
    // F9-RECEP-20: por fecha de alta en el calendario del negocio. Hoy trae a
    // los dos; un rango pasado no trae a nadie; un rango al revés rebota.
    // «Hoy» es el del NEGOCIO (zona por defecto de `tenants.timezone`), no el
    // de `toISOString()`: ese es UTC, y de 6 de la tarde a medianoche en CDMX
    // ya va en mañana. Así reventó el CI el 2026-09-05 a las 00:03 UTC.
    const hoy = localCalendarDate("America/Mexico_City", new Date());
    const deHoy = await request(app.getHttpServer())
      .get(`/reception/customers?from=${hoy}&to=${hoy}`)
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((deHoy.body as { total: number }).total).toBeGreaterThanOrEqual(2);
    const pasado = await request(app.getHttpServer())
      .get("/reception/customers?from=2020-01-01&to=2020-01-31")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    expect((pasado.body as { total: number }).total).toBe(0);
    await request(app.getHttpServer())
      .get(`/reception/customers?from=${hoy}&to=2020-01-01`)
      .set("Authorization", bearer(negocio.token))
      .expect(400);
    expect(filas[1]?.birthDate).toBe("1990-09-02");
    expect(filas[1]?.age).toBeGreaterThanOrEqual(35);
    expect(filas[0]?.age).toBeNull();

    const editado = await request(app.getHttpServer())
      .patch(`/reception/customers/${idPrimero}`)
      .set("Authorization", bearer(negocio.token))
      .send({ notes: "VIP", birthDate: null })
      .expect(200);
    expect(editado.body).toMatchObject({ notes: "VIP", birthDate: null, age: null });

    await request(app.getHttpServer())
      .delete(`/reception/customers/${idSegundo}`)
      .set("Authorization", bearer(negocio.token))
      .expect(204);
    await request(app.getHttpServer())
      .get(`/reception/customers/${idSegundo}`)
      .set("Authorization", bearer(negocio.token))
      .expect(404);
  });

  it("RLS: el cliente de un negocio no se ve, ni se edita, ni se borra desde otro — 404, no 403", async () => {
    const creado = await crear(negocio.token, {
      firstName: "Rosa",
      lastNamePaternal: "Luna",
    }).expect(201);
    const id = (creado.body as { id: string }).id;
    await request(app.getHttpServer())
      .get(`/reception/customers/${id}`)
      .set("Authorization", bearer(otro.token))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/reception/customers/${id}`)
      .set("Authorization", bearer(otro.token))
      .send({ notes: "ajeno" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/reception/customers/${id}`)
      .set("Authorization", bearer(otro.token))
      .expect(404);
    const lista = await request(app.getHttpServer())
      .get("/reception/customers")
      .set("Authorization", bearer(otro.token))
      .expect(200);
    expect((lista.body as { rows: { id: string }[] }).rows.map((r) => r.id)).not.toContain(id);
  });

  it("sin el módulo activo, TODAS las rutas responden 402 — también los GET", async () => {
    const lectura = await request(app.getHttpServer())
      .get("/reception/customers")
      .set("Authorization", bearer(sinModulo.token))
      .expect(402);
    expect((lectura.body as { message: string }).message).toMatch(/módulo/i);
    await crear(sinModulo.token, { firstName: "Ana", lastNamePaternal: "Pérez" }).expect(402);
    await request(app.getHttpServer())
      .get("/reception/turns")
      .set("Authorization", bearer(sinModulo.token))
      .expect(402);
  });

  it("un Viewer lee el registro pero recibe 403 al crear", async () => {
    await request(app.getHttpServer())
      .get("/reception/customers")
      .set("Authorization", bearer(viewerToken))
      .expect(200);
    await crear(viewerToken, { firstName: "Ana", lastNamePaternal: "Pérez" }).expect(403);
  });

  it("un teléfono sin prefijo internacional rebota con 400", async () => {
    await crear(negocio.token, {
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      phone: "5512345678",
    }).expect(400);
  });
});
