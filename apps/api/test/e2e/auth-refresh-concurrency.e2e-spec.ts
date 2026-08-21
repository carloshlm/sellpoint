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
 * verify #271 C1: dos refresh CONCURRENTES con el MISMO token todavía
 * vigente. AD-6 exige que, sin importar cuál de los dos gana la carrera
 * atómica (`markUsedOrRevokeFamily`), la familia completa termine
 * REVOCADA y quede un audit `auth.refresh.reuse_detected` persistido.
 *
 * Antes del fix: el `throw new UnauthorizedException(...)` de la rama
 * `!rotated` en `AuthService.refresh()` vivía DENTRO del callback de
 * `withTenantContext` (un `$transaction` de Prisma) — el throw hacía
 * ROLLBACK de la revocación de familia Y del audit que esa misma rama
 * acababa de escribir. `auth.service.spec.ts:529` no detectaba esto
 * porque mockea `withTenantContext` como un pasamanos (`fn(tx)`) sin
 * semántica de rollback. Este test pega contra Postgres real — es el
 * único que puede probar la propiedad transaccional que causaba el bug.
 */
describe("Reuso CONCURRENTE de refresh (e2e, Postgres real) — verify #271 C1", () => {
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

  function extractLinkToken(mail: { vars: Record<string, string> } | undefined): string {
    const token = extractTokenFromLink(mail?.vars.link);
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

  async function registerVerifyAndLogin(mailer: NoopMailer): Promise<{
    tenantId: string;
    userId: string;
    cookie: { raw: string; header: string };
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
    const { tenantId, userId } = registerResponse.body as { tenantId: string; userId: string };

    const verifyMail = mailer.sent.find((m) => m.to === email && m.template === "verify-email");
    const verifyToken = extractLinkToken(verifyMail);
    await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: verifyToken })
      .expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = extractRefreshCookie(loginResponse.headers["set-cookie"] as never);

    return { tenantId, userId, cookie };
  }

  it("dos POST /auth/refresh simultáneos con el mismo token: familia COMPLETA revocada y audit reuse_detected persistido", async () => {
    const mailer = app.get<NoopMailer>(MAILER);
    const { tenantId, userId, cookie } = await registerVerifyAndLogin(mailer);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookie.header),
      request(app.getHttpServer()).post("/auth/refresh").set("Cookie", cookie.header),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);

    const loser = first.status === 401 ? first : second;
    expect(loser.body).toMatchObject({ code: "auth.token_reused" });

    // AD-6: la familia ENTERA queda revocada — incluye el token viejo
    // (ya usado) y el nuevo emitido por la rotación ganadora.
    const familyRows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(familyRows.length).toBeGreaterThanOrEqual(2);
    const familyId = familyRows[0]?.familyId;
    expect(familyRows.every((r) => r.familyId === familyId)).toBe(true);
    expect(familyRows.every((r) => r.revokedAt !== null)).toBe(true);

    // El audit del reuso concurrente tiene que sobrevivir — antes del fix
    // el rollback de la transacción se lo llevaba puesto.
    const reuseAudit = await prisma.withTenantContext(tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: "auth.refresh.reuse_detected", userId } }),
    );
    expect(reuseAudit).toBeTruthy();
  });
});
