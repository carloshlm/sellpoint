import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

/**
 * e2e de U2 (f1-auth): register-tenant → verify-email, con Postgres/Redis
 * reales y `overrideProvider(MAILER).useClass(NoopMailer)` (design §8) — el
 * link de verificación se extrae del array `sent[]` del noop, nunca de un
 * servidor SMTP real. Tenant/email únicos por test (`randomUUID()`): no hay
 * TRUNCATE en el harness todavía, así que cada test es independiente por
 * construcción.
 */
describe("POST /auth/register-tenant + POST /auth/verify-email (e2e)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    mailer = app.get(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `owner-${randomUUID()}@example.com`;
  }

  function registerPayload(overrides: Record<string, unknown> = {}) {
    return {
      tenantName: `Acme ${randomUUID()}`,
      email: uniqueEmail(),
      password: "twelve-characters",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      ...overrides,
    };
  }

  it("registro exitoso: 201 con tenantId/userId y dispara el mail de verificación con el link", async () => {
    const payload = registerPayload();

    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send(payload)
      .expect(201);

    expect(response.body).toEqual({
      tenantId: expect.any(String),
      userId: expect.any(String),
    });

    const sentMail = mailer.sent.find((m) => m.to === payload.email);
    expect(sentMail).toBeDefined();
    expect(sentMail?.template).toBe("verify-email");
    expect(sentMail?.vars.link).toMatch(/\/verify-email\?token=.+/);
  });

  it("email ya usado en un tenant existente → 409 auth.email_taken", async () => {
    const payload = registerPayload();
    await request(app.getHttpServer()).post("/auth/register-tenant").send(payload).expect(201);

    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send(registerPayload({ email: payload.email }))
      .expect(409);

    expect(response.body).toMatchObject({ code: "auth.email_taken" });
  });

  it("password < 12 caracteres → 400 auth.weak_password", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send(registerPayload({ password: "corta" }))
      .expect(400);

    expect(response.body).toMatchObject({ code: "auth.weak_password" });
  });

  it("ciclo completo: verificar con el token real del mail capturado activa al usuario", async () => {
    const payload = registerPayload();
    await request(app.getHttpServer()).post("/auth/register-tenant").send(payload).expect(201);

    const sentMail = mailer.sent.find((m) => m.to === payload.email);
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    expect(token).toBeTruthy();

    const response = await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token })
      .expect(200);

    expect(response.body).toEqual({ verified: true });
  });

  it("token ya usado (segunda verificación) → 400 auth.token_invalid", async () => {
    const payload = registerPayload();
    await request(app.getHttpServer()).post("/auth/register-tenant").send(payload).expect(201);
    const sentMail = mailer.sent.find((m) => m.to === payload.email);
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");

    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const response = await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token })
      .expect(400);

    expect(response.body).toMatchObject({ code: "auth.token_invalid" });
  });

  it("token inexistente → 400 auth.token_invalid", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: "token-que-nunca-existio" })
      .expect(400);

    expect(response.body).toMatchObject({ code: "auth.token_invalid" });
  });
});
