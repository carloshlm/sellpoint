import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

/**
 * e2e de F1-LOCALE-09: si `POST /auth/register-tenant` no recibe `locale`
 * explícito en el body, usa el que `LocaleResolverMiddleware` resolvió desde
 * `Accept-Language` (ver AuthController.registerTenant).
 */
describe("POST /auth/register-tenant — fallback de Accept-Language (F1-LOCALE-09, e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function registerPayload(overrides: Record<string, unknown> = {}) {
    return {
      tenantName: `Acme ${randomUUID()}`,
      email: `owner-${randomUUID()}@example.com`,
      password: "twelve-characters",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      ...overrides,
    };
  }

  async function localeOf(user: { tenantId: string; userId: string }): Promise<string> {
    const row = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: user.userId }, select: { locale: true } }),
    );
    return row.locale;
  }

  it("signup desde browser en inglés (Accept-Language: en, sin locale en el body) crea user con locale='en'", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .set("Accept-Language", "en")
      .send(registerPayload())
      .expect(201);

    await expect(localeOf(response.body)).resolves.toBe("en");
  });

  it("sin Accept-Language y sin locale en el body -> DEFAULT_LOCALE (es)", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send(registerPayload())
      .expect(201);

    await expect(localeOf(response.body)).resolves.toBe("es");
  });

  it("locale explícito en el body gana sobre Accept-Language", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .set("Accept-Language", "en")
      .send(registerPayload({ locale: "es" }))
      .expect(201);

    await expect(localeOf(response.body)).resolves.toBe("es");
  });
});
