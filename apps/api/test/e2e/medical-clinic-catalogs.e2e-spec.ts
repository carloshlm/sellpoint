import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { bearer, registerTenant, type TenantFixture } from "./support/billing-scenario";
import { adminDePlataforma, consultorio, usuarioConRol } from "./support/medical-clinic-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-CLINIC-18 — los catálogos de estudios y el guard del módulo.
 *
 * Lo que fija: sin el módulo, 402 en TODAS las rutas (también los GET); con
 * él, el CRUD de los dos catálogos; código repetido 409; lo de otro negocio
 * NO EXISTE (404); un Viewer lee y recibe 403 al crear.
 */
describe("Consultorio Médico — catálogos (F9-CLINIC-18)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;
  let otro: TenantFixture;
  let sinModulo: TenantFixture;
  let viewerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await adminDePlataforma(app, prisma, "clinic-admin");
    negocio = await consultorio(app, prisma, "clinic", admin, ["medical_clinic"]);
    otro = await consultorio(app, prisma, "clinic-otro", admin, ["medical_clinic"]);
    sinModulo = await registerTenant(app, "clinic-sin");
    viewerToken = await usuarioConRol(app, negocio, "Viewer", "clinic-viewer");
  });

  afterAll(async () => {
    await app.close();
  });

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer(token)),
    post: (url: string, body: object) =>
      request(app.getHttpServer()).post(url).set("Authorization", bearer(token)).send(body),
    patch: (url: string, body: object) =>
      request(app.getHttpServer()).patch(url).set("Authorization", bearer(token)).send(body),
    delete: (url: string) =>
      request(app.getHttpServer()).delete(url).set("Authorization", bearer(token)),
  });

  it("sin el módulo, hasta leer el catálogo responde 402", async () => {
    await api(sinModulo.token).get("/medical-clinic/lab-studies").expect(402);
    await api(sinModulo.token).get("/medical-clinic/diagnostic-studies").expect(402);
    await api(sinModulo.token).get("/medical-clinic/settings").expect(402);
  });

  it.each([
    ["laboratorio", "/medical-clinic/lab-studies"],
    ["diagnóstico", "/medical-clinic/diagnostic-studies"],
  ])("CRUD del catálogo de %s con costo y precio de venta", async (_n, ruta) => {
    const creado = await api(negocio.token)
      .post(ruta, { code: " bh ", name: "Biometría hemática", cost: 40, price: 180 })
      .expect(201);
    const id = (creado.body as { id: string }).id;
    expect(creado.body).toMatchObject({ code: "BH", cost: "40", price: "180", isActive: true });

    // El mismo código no cabe dos veces en el negocio…
    await api(negocio.token).post(ruta, { code: "BH", name: "Otra" }).expect(409);
    // …pero sí en otro negocio.
    await api(otro.token).post(ruta, { code: "BH", name: "Biometría" }).expect(201);

    const lista = await api(negocio.token).get(`${ruta}?query=biom`).expect(200);
    expect((lista.body as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([id]);

    await api(negocio.token)
      .patch(`${ruta}/${id}`, { price: 200, description: "En ayunas" })
      .expect(200);
    const detalle = await api(negocio.token).get(`${ruta}/${id}`).expect(200);
    expect(detalle.body).toMatchObject({ price: "200", description: "En ayunas" });

    // Lo de otro negocio NO EXISTE: 404, no 403.
    await api(otro.token).get(`${ruta}/${id}`).expect(404);
    await api(otro.token).patch(`${ruta}/${id}`, { name: "x" }).expect(404);
    await api(otro.token).delete(`${ruta}/${id}`).expect(404);

    await api(negocio.token).delete(`${ruta}/${id}`).expect(204);
    await api(negocio.token).get(`${ruta}/${id}`).expect(404);
  });

  it("un Viewer lee los catálogos y recibe 403 al crear", async () => {
    await api(viewerToken).get("/medical-clinic/lab-studies").expect(200);
    await api(viewerToken)
      .post("/medical-clinic/lab-studies", { code: "X", name: "x" })
      .expect(403);
  });

  it("la configuración nace vendiendo solo medicamentos y se cambia con tenants:manage", async () => {
    const inicial = await api(negocio.token).get("/medical-clinic/settings").expect(200);
    expect(inicial.body).toEqual({
      sellsMedications: true,
      sellsLabStudies: false,
      sellsDiagnosticStudies: false,
    });
    const cambiada = await request(app.getHttpServer())
      .put("/medical-clinic/settings")
      .set("Authorization", bearer(negocio.token))
      .send({ sellsLabStudies: true })
      .expect(200);
    expect(cambiada.body).toMatchObject({ sellsMedications: true, sellsLabStudies: true });
    await request(app.getHttpServer())
      .put("/medical-clinic/settings")
      .set("Authorization", bearer(viewerToken))
      .send({ sellsLabStudies: false })
      .expect(403);
  });
});
