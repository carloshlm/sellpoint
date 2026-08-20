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
    // F3-HOME-03: el tenant NACE con «Almacén Central», así que la lista trae
    // dos — el inicial y este. Se busca el creado en vez de comparar la lista
    // entera: afirmar el largo ataría este test al onboarding.
    const creado = (list.body as { id: string; isActive: boolean }[]).find((w) => w.id === id);
    expect(creado).toMatchObject({ id, isActive: false });
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
    // Ve el SUYO (el inicial de F3-HOME-03) y ninguno del otro tenant: eso es
    // justo lo que este test protege.
    const nombresB = (listB.body as { name: string }[]).map((w) => w.name);
    expect(nombresB).not.toContain("Privado");

    await request(app.getHttpServer())
      .patch(`/warehouses/${(created.body as { id: string }).id}`)
      .set("Authorization", bearer(second))
      .send({ name: "Robado" })
      .expect(404);
  });
  /**
   * F3-CORE-03 — `?scoped=true`, el primer consumidor real de
   * `@CurrentUserScope()`. Lo usan los selectores de almacén de toda la Fase 3:
   * un Manager no tiene que poder ni siquiera ELEGIR un almacén que no
   * administra.
   */
  describe("F3-CORE-03 — ?scoped=true", () => {
    it("sin el flag lista todos: el comportamiento de F2 queda intacto", async () => {
      const token = await registerAndLogin();
      await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Central ${randomUUID()}` })
        .expect(201);
      await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Sucursal ${randomUUID()}` })
        .expect(201);

      const all = await request(app.getHttpServer())
        .get("/warehouses")
        .set("Authorization", bearer(token))
        .expect(200);

      expect((all.body as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    /**
     * El TenantAdmin que registra el tenant no tiene filas de alcance, así que
     * su scope es `all` por el default permisivo de F2-SCOPE-01 — y con el flag
     * sigue viendo todos. Lo que el flag SÍ filtra siempre es lo inactivo:
     * contra un almacén desactivado no se puede mover stock.
     */
    it("con el flag esconde los almacenes DESACTIVADOS", async () => {
      const token = await registerAndLogin();
      const activo = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Activo ${randomUUID()}` })
        .expect(201);
      const inactivo = await request(app.getHttpServer())
        .post("/warehouses")
        .set("Authorization", bearer(token))
        .send({ name: `Inactivo ${randomUUID()}` })
        .expect(201);
      const inactivoId = (inactivo.body as { id: string }).id;
      await request(app.getHttpServer())
        .patch(`/warehouses/${inactivoId}`)
        .set("Authorization", bearer(token))
        .send({ isActive: false })
        .expect(200);

      const scoped = await request(app.getHttpServer())
        .get("/warehouses?scoped=true")
        .set("Authorization", bearer(token))
        .expect(200);

      const ids = (scoped.body as { id: string }[]).map((w) => w.id);
      expect(ids).toContain((activo.body as { id: string }).id);
      expect(ids).not.toContain(inactivoId);
    });
  });
});
