import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * F3-SVC-03 — CRUD del catálogo de Servicios con tenants reales.
 *
 * Un servicio se vende pero NO mueve inventario: acá se prueba el catálogo;
 * que el POS lo cobre llega en F4.
 */
describe("Servicios (F3-SVC)", () => {
  let app: INestApplication<App>;
  const OWNER_PASSWORD = "twelve-characters";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant servicios ${randomUUID()}`,
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
    return (login.body as { accessToken: string }).accessToken;
  }

  const bearer = (token: string) => `Bearer ${token}`;

  it("crea, lista, edita, desactiva y elimina un servicio", async () => {
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "CORTE", name: "Corte de cabello", cost: 40, price: 150 })
      .expect(201);
    const id = (created.body as { id: string }).id;
    // Los importes viajan como string, igual que en productos: un Decimal
    // serializado a number pierde precisión en el camino.
    expect(created.body).toMatchObject({ code: "CORTE", price: "150", isActive: true });

    const listed = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((listed.body as { code: string }[]).map((s) => s.code)).toEqual(["CORTE"]);

    await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(token))
      .send({ name: "Corte y peinado", price: 180 })
      .expect(200);

    const desactivado = await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);
    expect((desactivado.body as { isActive: boolean }).isActive).toBe(false);

    await request(app.getHttpServer())
      .delete(`/services/${id}`)
      .set("Authorization", bearer(token))
      .expect(204);

    const vacio = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(token))
      .expect(200);
    expect(vacio.body).toEqual([]);
  });

  it("el código repetido en el mismo tenant da 409", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "LAVADO", name: "Lavado" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "LAVADO", name: "Otro lavado" })
      .expect(409);
    expect((res.body as { code: string }).code).toBe("services.code_taken");
  });

  /** El catálogo es de cada negocio: dos peluquerías usan "CORTE" sin chocar. */
  it("dos tenants pueden usar el mismo código", async () => {
    // Secuencial y no `Promise.all`: dos registros concurrentes contra el mismo
    // servidor de pruebas no aportan nada al caso y sí ruido al diagnóstico.
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const body = { code: "MISMO", name: "Servicio" };

    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(a))
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(b))
      .send(body)
      .expect(201);
  });

  it("un tenant no ve ni toca los servicios de otro", async () => {
    // Secuencial y no `Promise.all`: dos registros concurrentes contra el mismo
    // servidor de pruebas no aportan nada al caso y sí ruido al diagnóstico.
    const a = await registerAndLogin();
    const b = await registerAndLogin();
    const created = await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(a))
      .send({ code: "PRIVADO", name: "Solo de A" })
      .expect(201);
    const id = (created.body as { id: string }).id;

    const listado = await request(app.getHttpServer())
      .get("/services")
      .set("Authorization", bearer(b))
      .expect(200);
    expect(listado.body).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/services/${id}`)
      .set("Authorization", bearer(b))
      .send({ name: "Robado" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/services/${id}`)
      .set("Authorization", bearer(b))
      .expect(404);
  });

  it("busca por código y por nombre, sin distinguir mayúsculas", async () => {
    const token = await registerAndLogin();
    for (const s of [
      { code: "TINTE", name: "Tinte completo" },
      { code: "MANI", name: "Manicura" },
    ]) {
      await request(app.getHttpServer())
        .post("/services")
        .set("Authorization", bearer(token))
        .send(s)
        .expect(201);
    }

    const porNombre = await request(app.getHttpServer())
      .get("/services?query=manicu")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((porNombre.body as { code: string }[]).map((s) => s.code)).toEqual(["MANI"]);

    const porCodigo = await request(app.getHttpServer())
      .get("/services?query=tin")
      .set("Authorization", bearer(token))
      .expect(200);
    expect((porCodigo.body as { code: string }[]).map((s) => s.code)).toEqual(["TINTE"]);
  });

  it("un precio negativo o con demasiados decimales se rechaza", async () => {
    const token = await registerAndLogin();

    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "NEG", name: "Negativo", price: -1 })
      .expect(400);
    await request(app.getHttpServer())
      .post("/services")
      .set("Authorization", bearer(token))
      .send({ code: "DEC", name: "Decimales", price: 10.123 })
      .expect(400);
  });
});
