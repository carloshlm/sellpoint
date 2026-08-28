import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const REFRESH_COOKIE_NAME = "sp_refresh";
const PASSWORD = "twelve-characters";

/**
 * e2e de U3+U4 (f1-auth): login → refresh (rotación + reuse) → logout, con
 * Postgres/Redis reales. `app.use(cookieParser())` replica lo que main.ts
 * hace en producción (design §7) — sin esto, `request.cookies` queda
 * `undefined` y refresh/logout nunca ven la cookie `sp_refresh`.
 */
describe("POST /auth/login + /auth/refresh + /auth/logout (e2e)", () => {
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
    app.use(cookieParser());
    await startTestApp(app);
    prisma = app.get(PrismaService);
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

    const mailer = app.get<NoopMailer>(MAILER);
    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    return { ...(registerResponse.body as { tenantId: string; userId: string }), email };
  }

  async function registerInvitedUser(): Promise<{ email: string }> {
    const email = uniqueEmail();
    await request(app.getHttpServer())
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
    return { email };
  }

  function extractRefreshCookie(setCookieHeader: string[] | undefined): {
    raw: string;
    header: string;
  } {
    const cookieLine = setCookieHeader?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!cookieLine) {
      throw new Error("sp_refresh cookie no encontrada en Set-Cookie");
    }
    const value = cookieLine.split(";")[0]?.split("=")[1] ?? "";
    return { raw: value, header: `${REFRESH_COOKIE_NAME}=${value}` };
  }

  it("login exitoso: 200 con accessToken+user, cookie sp_refresh httpOnly, SIN domain, refreshToken nunca en el body", async () => {
    const user = await registerActiveUser();

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    expect(response.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: expect.any(Number),
      user: {
        id: user.userId,
        email: user.email,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        lastNameMaternal: null,
        locale: "es",
        permissions: expect.any(Array),
        isPlatformAdmin: false,
        // F1-WEB-ONBOARD-01 (A1 del design): MISMO shape que `GET /me`
        // `tenant` — ver el contrato en tenants-me.e2e-spec.ts.
        tenant: {
          id: user.tenantId,
          name: expect.any(String),
          legalName: null,
          taxId: null,
          address: null,
          phone: null,
          theme: null,
          timezone: expect.any(String),
          currency: "MXN",
          templateChoice: null,
          onboarded: false,
          country: null,
          sellWithoutStock: false,
        },
        // F7-WEB-01 (A1): el plan efectivo — el tenant nace en trial Plus.
        subscription: expect.objectContaining({
          planCode: "plus",
          status: "trialing",
          daysLeft: expect.any(Number),
          writeAccess: true,
          stockControl: true,
        }),
      },
    });
    expect(response.body).not.toHaveProperty("refreshToken");

    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const cookieLine = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cookieLine).toContain("HttpOnly");
    expect(cookieLine).toContain("SameSite=Strict");
    expect(cookieLine?.toLowerCase()).not.toContain("domain=");
  });

  it("credenciales inválidas: email inexistente y password incorrecta devuelven EXACTAMENTE el mismo 401", async () => {
    const user = await registerActiveUser();

    const wrongPassword = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "password-incorrecta" })
      .expect(401);

    const unknownEmail = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: `nadie-${randomUUID()}@example.com`, password: PASSWORD })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toMatchObject({ code: "auth.invalid_credentials" });
  });

  it("usuario no verificado (invited) → 403 auth.email_not_verified", async () => {
    const user = await registerInvitedUser();

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(403);

    expect(response.body).toMatchObject({ code: "auth.email_not_verified" });
  });

  it("usuario suspendido → 403 auth.account_suspended", async () => {
    const user = await registerActiveUser();
    await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.update({ where: { id: user.userId }, data: { status: "suspended" } }),
    );

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(403);

    expect(response.body).toMatchObject({ code: "auth.account_suspended" });
  });

  it("ciclo refresh: rota DENTRO de la misma familia, el token anterior queda usedAt≠null", async () => {
    const user = await registerActiveUser();
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    const firstCookie = extractRefreshCookie(loginResponse.headers["set-cookie"] as never);
    const firstTokenRow = await prisma.refreshToken.findFirst({
      where: { userId: user.userId },
    });
    expect(firstTokenRow?.usedAt).toBeNull();

    const refreshResponse = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", firstCookie.header)
      .expect(200);

    expect(refreshResponse.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: expect.any(Number),
    });
    const rotatedCookie = extractRefreshCookie(refreshResponse.headers["set-cookie"] as never);
    expect(rotatedCookie.raw).not.toBe(firstCookie.raw);

    const rowsAfterRotation = await prisma.refreshToken.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "asc" },
    });
    expect(rowsAfterRotation).toHaveLength(2);
    expect(rowsAfterRotation[0]?.familyId).toBe(rowsAfterRotation[1]?.familyId);
    expect(rowsAfterRotation[0]?.usedAt).not.toBeNull();
    expect(rowsAfterRotation[1]?.usedAt).toBeNull();
  });

  it("REUSE: reusar un refresh ya rotado revoca TODA la familia y responde 401 auth.token_reused", async () => {
    const user = await registerActiveUser();
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const firstCookie = extractRefreshCookie(loginResponse.headers["set-cookie"] as never);

    // Rota una vez (legítimo) — el token original queda usedAt≠null.
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", firstCookie.header)
      .expect(200);

    // REUSO: el atacante (o una segunda pestaña) intenta usar el token YA
    // rotado de nuevo.
    const reuseResponse = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", firstCookie.header)
      .expect(401);

    expect(reuseResponse.body).toMatchObject({ code: "auth.token_reused" });
    const clearedCookie = extractRefreshCookie(reuseResponse.headers["set-cookie"] as never);
    expect(clearedCookie.raw).toBe("");

    const allTokens = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
    expect(allTokens.length).toBeGreaterThanOrEqual(2);
    expect(allTokens.every((t) => t.revokedAt !== null)).toBe(true);

    const reuseAudit = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: "auth.refresh.reuse_detected" } }),
    );
    expect(reuseAudit).toBeTruthy();
  });

  it("logout: revoca la familia entera, limpia la cookie, y el refresh posterior con ese token → 401", async () => {
    const user = await registerActiveUser();
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const cookie = extractRefreshCookie(loginResponse.headers["set-cookie"] as never);

    const logoutResponse = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", cookie.header)
      .expect(204);

    const clearedCookie = extractRefreshCookie(logoutResponse.headers["set-cookie"] as never);
    expect(clearedCookie.raw).toBe("");

    const rows = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
    expect(rows.every((t) => t.revokedAt !== null)).toBe(true);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", cookie.header)
      .expect(401);
  });

  it("logout sin cookie → 204 igual (silencioso, sin efectos observables)", async () => {
    await request(app.getHttpServer()).post("/auth/logout").expect(204);
  });
});
