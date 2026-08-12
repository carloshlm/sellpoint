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

const REFRESH_COOKIE_NAME = "sp_refresh";
const PASSWORD = "twelve-characters";
const NEW_PASSWORD = "brand-new-password-12";

/**
 * F1-AUTH-16 (U6-04, examen integrador de f1-auth): el ciclo COMPLETO
 * encadenado en un ÚNICO test, con Postgres/Redis reales — a diferencia de
 * los e2e por endpoint (`auth-register-verify`, `auth-login-refresh-logout`,
 * `auth-forgot-reset-password`, que siguen viviendo por separado y cubren
 * ramas de error que acá NO se repiten), esta suite prueba que el ESTADO
 * fluye correctamente de un paso al siguiente dentro de la MISMA sesión de
 * usuario:
 *
 *   register → verify-email → login → me → refresh (rotación) →
 *   reuso detectado (familia revocada) → logout → forgot → reset →
 *   login con password nueva
 */
describe("Ciclo completo de auth: register→verify→login→me→refresh→reuse→logout→forgot→reset→login (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  function extractLinkToken(mail: { vars: Record<string, string> } | undefined): string {
    const token = new URL(mail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    if (!token) {
      throw new Error("token no encontrado en el mail capturado");
    }
    return token;
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

  it("recorre las 10 etapas del ciclo completo sin perder estado entre pasos", async () => {
    const email = `owner-${randomUUID()}@example.com`;

    // 1. register-tenant → 201, usuario nace invited/emailVerifiedAt=null.
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
    const { tenantId, userId } = registerResponse.body as { tenantId: string; userId: string };

    // 2. verify-email → 200, status pasa a active.
    const verifyMail = mailer.sent.find((m) => m.to === email && m.template === "verify-email");
    const verifyToken = extractLinkToken(verifyMail);
    await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: verifyToken })
      .expect(200);

    const verifiedUser = await prisma.withTenantContext(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    expect(verifiedUser.status).toBe("active");
    expect(verifiedUser.emailVerifiedAt).not.toBeNull();

    // 3. login → 200, accessToken + cookie de refresh.
    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const { accessToken } = loginResponse.body as { accessToken: string };
    const firstCookie = extractRefreshCookie(loginResponse.headers["set-cookie"] as never);

    // 4. me → 200: prueba secure-by-default + @CurrentUser() con el
    // accessToken recién emitido, de punta a punta (no un mock del guard).
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locale: "en" })
      .expect(200);

    const afterMe = await prisma.withTenantContext(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    expect(afterMe.locale).toBe("en");

    // Sin token → 401 (secure by default, AUTH-REQ-16).
    await request(app.getHttpServer()).patch("/me").send({ locale: "es" }).expect(401);

    // 5. refresh → 200, rota DENTRO de la misma familia.
    const refreshResponse = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", firstCookie.header)
      .expect(200);
    const rotatedCookie = extractRefreshCookie(refreshResponse.headers["set-cookie"] as never);
    expect(rotatedCookie.raw).not.toBe(firstCookie.raw);

    const rowsAfterRotation = await prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    expect(rowsAfterRotation).toHaveLength(2);
    const familyId = rowsAfterRotation[0]?.familyId;
    expect(rowsAfterRotation[1]?.familyId).toBe(familyId);
    expect(rowsAfterRotation[0]?.usedAt).not.toBeNull();

    // 6. REUSO: reintentar el token YA rotado → 401 auth.token_reused,
    // TODA la familia (ambos refresh) queda revocada + audit.
    const reuseResponse = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", firstCookie.header)
      .expect(401);
    expect(reuseResponse.body).toMatchObject({ code: "auth.token_reused" });

    const rowsAfterReuse = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rowsAfterReuse).toHaveLength(2);
    expect(rowsAfterReuse.every((r) => r.familyId === familyId && r.revokedAt !== null)).toBe(true);

    const reuseAudit = await prisma.withTenantContext(tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: "auth.refresh.reuse_detected" } }),
    );
    expect(reuseAudit).toBeTruthy();

    // El refresh rotado (el más nuevo, nunca reusado) tampoco sirve más:
    // la familia entera está revocada, no solo el token reusado.
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", rotatedCookie.header)
      .expect(401);

    // 7. logout: aun con la familia ya revocada por el paso anterior, el
    // endpoint sigue siendo idempotente — encuentra la fila (existe, solo
    // que ya estaba revocada), la re-revoca sin error, y SIEMPRE 204.
    const logoutResponse = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", firstCookie.header)
      .expect(204);
    const clearedCookie = extractRefreshCookie(logoutResponse.headers["set-cookie"] as never);
    expect(clearedCookie.raw).toBe("");

    // 8. forgot-password → 202, token de un solo uso creado.
    mailer.sent.length = 0;
    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email }).expect(202);
    const resetMail = mailer.sent.find((m) => m.to === email && m.template === "reset-password");
    const resetToken = extractLinkToken(resetMail);

    // 9. reset-password → 204, password actualizado + epoch bumpeado.
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: resetToken, password: NEW_PASSWORD })
      .expect(204);

    // 10. login con la password VIEJA falla, con la NUEVA funciona.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(401);

    const finalLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: NEW_PASSWORD })
      .expect(200);
    expect(finalLogin.body).toMatchObject({
      accessToken: expect.any(String),
      user: { id: userId, email },
    });
  });
});
