import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/** F2-WH-01 — CRUD de almacenes con tenants reales. */
describe("Almacenes (F2-WH)", () => {
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
        tenantName: `Tenant almacen ${randomUUID()}`,
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

  it("crea, lista, edita y desactiva un almacén", async () => {
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central", address: "Calle 1" })
      .expect(201);
    const { id } = created.body as { id: string };
    expect(created.body).toMatchObject({ name: "Central", isActive: true });

    await request(app.getHttpServer())
      .patch(`/warehouses/${id}`)
      .set("Authorization", bearer(token))
      .send({ isActive: false })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(token))
      .expect(200);
    expect(list.body).toMatchObject([{ id, isActive: false }]);
  });

  it("la dirección es OPCIONAL: un almacén sin dirección es válido", async () => {
    // MERCADOS.md § 4: los formatos postales difieren entre los 26 mercados,
    // así que no se exige ni se estructura.
    const token = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Sin dirección" })
      .expect(201);

    expect(created.body).toMatchObject({ address: null });
  });

  it("nombre repetido dentro del tenant → 409", async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(token))
      .send({ name: "Central" })
      .expect(409);
  });

  it("un tenant no ve ni toca los almacenes de otro", async () => {
    const first = await registerAndLogin();
    const second = await registerAndLogin();

    const created = await request(app.getHttpServer())
      .post("/warehouses")
      .set("Authorization", bearer(first))
      .send({ name: "Privado" })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get("/warehouses")
      .set("Authorization", bearer(second))
      .expect(200);
    expect(listB.body).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/warehouses/${(created.body as { id: string }).id}`)
      .set("Authorization", bearer(second))
      .send({ name: "Robado" })
      .expect(404);
  });
});
