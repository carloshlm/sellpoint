import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../../src/infrastructure/redis/redis.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

const REFRESH_COOKIE_NAME = "sp_refresh";
const PASSWORD = "twelve-characters";
const NEW_PASSWORD = "brand-new-password-12";

/**
 * e2e de U5 (f1-auth): forgot-password → reset-password, con Postgres/Redis
 * reales. AUTH-REQ-08 (a prueba de enumeración) + AUTH-REQ-09 (reset revoca
 * TODAS las familias + bump de perm-epoch, AD-8).
 */
describe("POST /auth/forgot-password + POST /auth/reset-password (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let mailer: NoopMailer;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `owner-${randomUUID()}@example.com`;
  }

  async function registerActiveUser(): Promise<{
    tenantId: string;
    userId: string;
    email: string;
  }> {
    const email = uniqueEmail();
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
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    return { ...(registerResponse.body as { tenantId: string; userId: string }), email };
  }

  function extractRefreshCookie(setCookieHeader: string[] | undefined): { header: string } {
    const cookieLine = setCookieHeader?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!cookieLine) {
      throw new Error("sp_refresh cookie no encontrada en Set-Cookie");
    }
    return { header: `${REFRESH_COOKIE_NAME}=${cookieLine.split(";")[0]?.split("=")[1] ?? ""}` };
  }

  async function requestResetToken(email: string): Promise<string> {
    mailer.sent.length = 0;
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email }).expect(202);
    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    if (!token) {
      throw new Error("token de reset no encontrado en el mail capturado");
    }
    return token;
  }

  it("email existente: 202 + PasswordResetToken creado (TTL 30min) + mail con el link", async () => {
    const user = await registerActiveUser();
    mailer.sent.length = 0;

    const response = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: user.email })
      .expect(202);

    expect(response.body).toEqual({ accepted: true });

    const sentMail = mailer.sent.find((m) => m.to === user.email);
    expect(sentMail?.template).toBe("reset-password");
    expect(sentMail?.vars.link).toMatch(/\/reset-password\?token=.+/);

    const tokenRow = await prisma.passwordResetToken.findFirst({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(tokenRow).toBeTruthy();
    expect(tokenRow?.usedAt).toBeNull();
    // `expiresAt` se calcula desde ClockPort ANTES del INSERT; `createdAt`
    // es `now()` de Postgres en el momento del INSERT — un par de ms de
    // drift entre ambos relojes es esperable, no un bug.
    const ttlMs = (tokenRow?.expiresAt.getTime() ?? 0) - (tokenRow?.createdAt.getTime() ?? 0);
    expect(ttlMs).toBeGreaterThan(30 * 60 * 1000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it("email inexistente: 202 IDÉNTICO, sin crear token ni mail (anti-enumeración AUTH-REQ-08)", async () => {
    const unknownEmail = `nadie-${randomUUID()}@example.com`;
    mailer.sent.length = 0;

    const response = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: unknownEmail })
      .expect(202);

    expect(response.body).toEqual({ accepted: true });
    expect(mailer.sent.find((m) => m.to === unknownEmail)).toBeUndefined();
  });

  it("pedir un segundo reset invalida el token anterior sin usar", async () => {
    const user = await registerActiveUser();

    const firstToken = await requestResetToken(user.email);
    await requestResetToken(user.email);

    const rows = await prisma.passwordResetToken.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usedAt).not.toBeNull();
    expect(rows[1]?.usedAt).toBeNull();

    // El primer token, ahora invalidado, ya no sirve para resetear.
    const response = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: firstToken, password: NEW_PASSWORD })
      .expect(400);
    expect(response.body).toMatchObject({ message: "auth.token_invalid" });
  });

  it("token inexistente → 400 auth.token_invalid", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: "token-que-nunca-existio", password: NEW_PASSWORD })
      .expect(400);

    expect(response.body).toMatchObject({ message: "auth.token_invalid" });
  });

  it("password < 12 caracteres → 400 auth.weak_password", async () => {
    const user = await registerActiveUser();
    const token = await requestResetToken(user.email);

    const response = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: "corta" })
      .expect(400);

    expect(response.body).toMatchObject({ message: "auth.weak_password" });
  });

  it("ciclo completo: reset exitoso → password actualizado, token consumido, TODAS las familias de refresh revocadas, perm-epoch bumpeado", async () => {
    const user = await registerActiveUser();

    // Abre DOS sesiones (dos familias distintas) antes del reset.
    const loginA = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const loginB = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const cookieA = extractRefreshCookie(loginA.headers["set-cookie"] as never);
    const cookieB = extractRefreshCookie(loginB.headers["set-cookie"] as never);

    const beforeReset = Math.floor(Date.now() / 1000);
    const token = await requestResetToken(user.email);

    const resetResponse = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: NEW_PASSWORD })
      .expect(204);
    expect(resetResponse.body).toEqual({});

    // Token consumido: reusarlo falla.
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: NEW_PASSWORD })
      .expect(400);

    // AUTH-REQ-09: TODAS las familias del usuario quedan revocadas — ambas
    // sesiones (login A y B) mueren, no solo la que generó el reset.
    const refreshRows = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
    expect(refreshRows.length).toBeGreaterThanOrEqual(2);
    expect(refreshRows.every((r) => r.revokedAt !== null)).toBe(true);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", cookieA.header)
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", cookieB.header)
      .expect(401);

    // Password viejo ya no sirve, el nuevo sí.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD })
      .expect(200);

    // AD-8: perm-epoch:{userId} bumpeado, SIN TTL, valor en unix segundos.
    const epoch = await redis.get(`perm-epoch:${user.userId}`);
    expect(epoch).toBeTruthy();
    expect(Number(epoch)).toBeGreaterThanOrEqual(beforeReset);
    const ttl = await redis.ttl(`perm-epoch:${user.userId}`);
    expect(ttl).toBe(-1);
  });
});
