import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
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
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const REFRESH_COOKIE_NAME = "sp_refresh";
const PASSWORD = "twelve-characters";
const NEW_PASSWORD = "brand-new-password-12";

/**
 * e2e de F1-WEB-AUTH-10 / W1 de f1-auth: `POST /auth/change-password` y
 * `GET /auth/sessions` contra Postgres/Redis reales.
 *
 * El test que importa de verdad es "el access token devuelto SOBREVIVE al
 * bump de epoch": si la implementación firma el token ANTES de bumpear
 * `perm-epoch:{userId}`, `JwtAuthGuard` lo ve con `iat < maxEpoch` y el
 * usuario se auto-expulsa al cambiar su propia password. Se prueba usándolo
 * de verdad contra `GET /me`.
 */
describe("POST /auth/change-password + GET /auth/sessions (e2e)", () => {
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
    await startTestApp(app);
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    mailer = app.get<NoopMailer>(MAILER);
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
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    return { ...(registerResponse.body as { tenantId: string; userId: string }), email };
  }

  function extractRefreshCookie(setCookieHeader: string[] | undefined): string {
    const cookieLine = setCookieHeader?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!cookieLine) {
      throw new Error("sp_refresh cookie no encontrada en Set-Cookie");
    }
    return `${REFRESH_COOKIE_NAME}=${cookieLine.split(";")[0]?.split("=")[1] ?? ""}`;
  }

  async function loginSession(email: string, password = PASSWORD) {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    const body = response.body as { accessToken: string };
    return {
      accessToken: body.accessToken,
      cookie: extractRefreshCookie(response.headers["set-cookie"] as never),
    };
  }

  it("password actual incorrecta → 401 auth.invalid_credentials y la password NO cambia", async () => {
    const user = await registerActiveUser();
    const session = await loginSession(user.email);

    const response = await request(app.getHttpServer())
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Cookie", session.cookie)
      .send({ currentPassword: "no-es-esta-password", newPassword: NEW_PASSWORD })
      .expect(401);

    // MISMA clave que login: no se revela nada distinto.
    expect(response.body).toMatchObject({ code: "auth.invalid_credentials" });

    // La password sigue siendo la vieja, y la nueva no sirve.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD })
      .expect(401);

    // El intento fallido queda auditado (audit_logs tiene RLS: hace falta contexto).
    const audit = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { userId: user.userId, action: "auth.password.change_failed" },
      }),
    );
    expect(audit).toBeTruthy();
  });

  it("password nueva de 11 caracteres → 400 auth.weak_password (política NIST compartida)", async () => {
    const user = await registerActiveUser();
    const session = await loginSession(user.email);

    const response = await request(app.getHttpServer())
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${session.accessToken}`)
      .set("Cookie", session.cookie)
      .send({ currentPassword: PASSWORD, newPassword: "once-chars." })
      .expect(400);

    expect(response.body).toMatchObject({ code: "auth.weak_password" });
  });

  it("sin access token → 401 (no es @Public: exige sesión autenticada)", async () => {
    await request(app.getHttpServer())
      .post("/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);

    await request(app.getHttpServer()).get("/auth/sessions").expect(401);
  });

  it("camino feliz: cambia la password, mata las OTRAS sesiones, preserva la propia y devuelve un token que SIGUE SIRVIENDO", async () => {
    const user = await registerActiveUser();

    // Dos sesiones: A (otro dispositivo) y B (desde donde cambia la password).
    const sessionA = await loginSession(user.email);
    const sessionB = await loginSession(user.email);

    const familyIdB = (
      await prisma.refreshToken.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: "desc" },
        take: 1,
      })
    )[0]?.familyId;
    expect(familyIdB).toBeTruthy();

    // El epoch tiene granularidad de SEGUNDO y `JwtAuthGuard` compara
    // `iat < maxEpoch`. Sin esta espera, los tokens de A y B podrían tener el
    // MISMO `iat` que el epoch nuevo y el test sería flaky.
    await sleep(1100);
    const beforeChange = Math.floor(Date.now() / 1000);

    const response = await request(app.getHttpServer())
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${sessionB.accessToken}`)
      .set("Cookie", sessionB.cookie)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    const { accessToken: freshToken, expiresIn } = response.body as {
      accessToken: string;
      expiresIn: number;
    };
    expect(typeof freshToken).toBe("string");
    expect(expiresIn).toBeGreaterThan(0);
    expect(freshToken).not.toBe(sessionB.accessToken);

    // ── El resultado de la invariante epoch → firma ────────────────────────
    // El token devuelto se firmó DESPUÉS del bump, así que sirve YA. OJO: el
    // candado del ORDEN es el test unitario de `invocationCallOrder`; acá la
    // granularidad de segundo del epoch hace que invertir el orden solo falle
    // cuando firma y bump caen a ambos lados de un borde de segundo. Este
    // test prueba el RESULTADO observable, no el orden.
    const meResponse = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${freshToken}`)
      .expect(200);
    expect(meResponse.body).toMatchObject({ id: user.userId, email: user.email });

    // ...y los access tokens de ANTES del cambio quedaron obsoletos (prueba
    // que el epoch se movió de verdad, no que el guard no chequee nada).
    await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${sessionA.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${sessionB.accessToken}`)
      .expect(401);

    // Refresh: la familia de B (la que cambió la password) sobrevive; la de A muere.
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", sessionA.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", sessionB.cookie)
      .expect(200);

    const rows = await prisma.refreshToken.findMany({ where: { userId: user.userId } });
    const familyB = rows.filter((r) => r.familyId === familyIdB);
    const otherFamilies = rows.filter((r) => r.familyId !== familyIdB);
    expect(otherFamilies.length).toBeGreaterThan(0);
    expect(otherFamilies.every((r) => r.revokedAt !== null)).toBe(true);
    // El token con el que B llegó se consumió en el refresh de arriba, pero
    // ninguna fila de su familia quedó REVOCADA por el cambio de password.
    expect(familyB.some((r) => r.revokedAt === null)).toBe(true);

    // Password vieja muerta, nueva viva.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: NEW_PASSWORD })
      .expect(200);

    // AD-8: epoch bumpeado, SIN TTL, en unix segundos.
    const epoch = await redis.get(`perm-epoch:${user.userId}`);
    expect(Number(epoch)).toBeGreaterThanOrEqual(beforeChange);
    expect(await redis.ttl(`perm-epoch:${user.userId}`)).toBe(-1);

    const audit = await prisma.withTenantContext(user.tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { userId: user.userId, action: "auth.password.changed" },
      }),
    );
    expect(audit).toBeTruthy();
  });

  it("GET /auth/sessions: una entrada por familia viva, marca la propia como current y no filtra hashes", async () => {
    const user = await registerActiveUser();
    const sessionA = await loginSession(user.email);
    const sessionB = await loginSession(user.email);

    // Rota la familia de B: sigue siendo UNA sola sesión, no dos.
    const rotated = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", sessionB.cookie)
      .expect(200);
    const rotatedCookie = extractRefreshCookie(rotated.headers["set-cookie"] as never);

    const response = await request(app.getHttpServer())
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${sessionB.accessToken}`)
      .set("Cookie", rotatedCookie)
      .expect(200);

    const sessions = response.body as {
      familyId: string;
      createdAt: string;
      expiresAt: string;
      current: boolean;
    }[];

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    for (const session of sessions) {
      expect(Object.keys(session).sort()).toEqual([
        "createdAt",
        "current",
        "expiresAt",
        "familyId",
      ]);
    }
    expect(JSON.stringify(sessions)).not.toContain("tokenHash");

    // Tras cerrar A, su familia deja de aparecer (revocada ≠ activa).
    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", sessionA.cookie)
      .expect(204);

    const afterLogout = await request(app.getHttpServer())
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${sessionB.accessToken}`)
      .set("Cookie", rotatedCookie)
      .expect(200);
    const remaining = afterLogout.body as { current: boolean }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.current).toBe(true);
  });

  it("las sesiones son POR USUARIO: el listado de un usuario nunca incluye familias de otro", async () => {
    const userA = await registerActiveUser();
    const userB = await registerActiveUser();
    await loginSession(userB.email);
    const sessionA = await loginSession(userA.email);

    const response = await request(app.getHttpServer())
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${sessionA.accessToken}`)
      .set("Cookie", sessionA.cookie)
      .expect(200);

    const sessions = response.body as { familyId: string }[];
    expect(sessions).toHaveLength(1);

    const familiesOfB = await prisma.refreshToken.findMany({
      where: { userId: userB.userId },
      select: { familyId: true },
    });
    expect(familiesOfB.length).toBeGreaterThan(0);
    const listedFamilies = new Set(sessions.map((s) => s.familyId));
    for (const row of familiesOfB) {
      expect(listedFamilies.has(row.familyId)).toBe(false);
    }
  });
});
