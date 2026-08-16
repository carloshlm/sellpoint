import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";

/**
 * e2e de F1-LOCALE-05 (PATCH /me). Login (U3 de f1-auth) todavía no existe
 * en este repo, así que el access token se firma directo con la MISMA
 * instancia de `TokenService` que usa la app (vía `app.get`) — mismas claves
 * RS256 efímeras del proceso, no un mock de firma. El user real se crea con
 * el flujo real (register-tenant + verify-email) para no inventar un shape
 * de fila que no pase por dominio.
 */
describe("/me (e2e)", () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerActiveUser(): Promise<{
    tenantId: string;
    userId: string;
    email: string;
  }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registerResponse = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Acme ${randomUUID()}`,
        email,
        password: "twelve-characters",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);

    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const body = registerResponse.body as { tenantId: string; userId: string };
    return { ...body, email };
  }

  function accessTokenFor(user: { tenantId: string; userId: string }): string {
    return tokenService.signAccessToken({
      sub: user.userId,
      tenantId: user.tenantId,
      permissions: [],
      locale: "es",
    });
  }

  it("GET /me con token válido devuelve el shape que consume el front (bootstrap de sesión)", async () => {
    const user = await registerActiveUser();
    const accessToken = tokenService.signAccessToken({
      sub: user.userId,
      tenantId: user.tenantId,
      permissions: ["products:read"],
      locale: "es",
    });

    const response = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      id: user.userId,
      email: user.email,
      firstName: "Ana",
      locale: "es",
      permissions: ["products:read"],
      // F1-WEB-ONBOARD-01 (A1 del design): mismo shape que
      // `LoginResult.user.tenant` — ver tenants-me.e2e-spec.ts "Contrato".
      tenant: {
        id: user.tenantId,
        name: expect.any(String),
        legalName: null,
        taxId: null,
        address: null,
        timezone: expect.any(String),
        currency: "MXN",
        templateChoice: null,
        onboarded: false,
        country: null,
      },
    });
    expect(response.body).not.toHaveProperty("passwordHash");
  });

  it("GET /me sin Authorization -> 401 (secure by default)", () => {
    return request(app.getHttpServer()).get("/me").expect(401);
  });

  it("actualiza el locale del user autenticado y lo devuelve en la respuesta", async () => {
    const user = await registerActiveUser();
    const accessToken = accessTokenFor(user);

    const response = await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locale: "en" })
      .expect(200);

    expect(response.body).toMatchObject({ id: user.userId, locale: "en" });
    expect(response.body).not.toHaveProperty("passwordHash");
  });

  it("locale fuera de SUPPORTED_LOCALES -> 400 users.invalid_body", async () => {
    const user = await registerActiveUser();
    const accessToken = accessTokenFor(user);

    const response = await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locale: "fr" })
      .expect(400);

    expect(response.body).toMatchObject({ code: "users.invalid_body" });
  });

  it("sin Authorization -> 401 (secure by default)", () => {
    return request(app.getHttpServer()).patch("/me").send({ locale: "en" }).expect(401);
  });
});
