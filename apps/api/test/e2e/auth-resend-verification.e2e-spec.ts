import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER, type MailMessage } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * e2e de F10-MANFIX-11: pedir otro correo de verificación, con Postgres y
 * Redis reales.
 *
 * El problema que cierra: el enlace del registro dura 24 h y, vencido, no
 * había forma de pedir otro — registrarse de nuevo con el mismo correo
 * responde «Ya existe una cuenta…». El endpoint copia el molde de
 * forgot-password: el MISMO 202 exista o no la cuenta, esté o no verificada
 * (sin enumeración), y solo la cuenta que se registró sola y todavía no
 * verifica recibe el correo. El límite de intentos se prueba en
 * `auth-throttling.e2e-spec.ts`, la única suite con el throttle encendido.
 */
describe("POST /auth/resend-verification (e2e)", () => {
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
    await startTestApp(app);
    prisma = app.get(PrismaService);
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `owner-${randomUUID()}@example.com`;
  }

  function verifyMails(email: string): MailMessage[] {
    return mailer.sent.filter((m) => m.to === email && m.template === "verify-email");
  }

  function tokenOf(mail: MailMessage | undefined): string {
    const token = extractTokenFromLink(mail?.vars.link);
    if (!token) {
      throw new Error(`Correo sin token: ${mail?.vars.link}`);
    }
    return token;
  }

  async function registerUnverified(
    locale: "es" | "en" = "es",
  ): Promise<{ tenantId: string; userId: string; email: string }> {
    const email = uniqueEmail();
    const response = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Acme ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastName: "Pérez",
        locale,
      })
      .expect(201);
    return { ...(response.body as { tenantId: string; userId: string }), email };
  }

  function verify(token: string) {
    return request(app.getHttpServer()).post("/auth/verify-email").send({ token });
  }

  function resend(email: string) {
    return request(app.getHttpServer()).post("/auth/resend-verification").send({ email });
  }

  it("enlace vencido: pedir otro manda un correo nuevo con el que la cuenta se verifica y entra", async () => {
    const owner = await registerUnverified();
    const expiredToken = tokenOf(verifyMails(owner.email).at(-1));
    // Lo que pasa en 24 h, sin esperarlas: el enlace del registro vence.
    await prisma.emailVerificationToken.updateMany({
      where: { userId: owner.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await verify(expiredToken).expect(400);

    const response = await resend(owner.email).expect(202);

    expect(response.body).toEqual({ accepted: true });
    const mails = verifyMails(owner.email);
    expect(mails).toHaveLength(2);
    // D3 (#347): el enlace nuevo también viaja por fragmento.
    expect(mails.at(-1)?.vars.link).toMatch(/\/verify-email#token=.+/);
    expect(mails.at(-1)?.vars.firstName).toBe("Ana");
    const freshToken = tokenOf(mails.at(-1));
    expect(freshToken).not.toBe(expiredToken);

    await verify(freshToken).expect(200);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
  });

  it("solo sirve el último enlace: pedir otro invalida el anterior aunque siga vigente, y el nuevo dura 24 h", async () => {
    const owner = await registerUnverified();
    const firstToken = tokenOf(verifyMails(owner.email).at(-1));

    await resend(owner.email).expect(202);

    const rows = await prisma.emailVerificationToken.findMany({
      where: { userId: owner.userId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usedAt).not.toBeNull();
    expect(rows[1]?.usedAt).toBeNull();
    // `expiresAt` sale del reloj del API y `createdAt` del de Postgres: un par
    // de milisegundos de diferencia entre los dos es esperable.
    const ttlMs = (rows[1]?.expiresAt.getTime() ?? 0) - (rows[1]?.createdAt.getTime() ?? 0);
    expect(ttlMs).toBeGreaterThan(EMAIL_VERIFICATION_TTL_MS - 1000);
    expect(ttlMs).toBeLessThanOrEqual(EMAIL_VERIFICATION_TTL_MS);

    const response = await verify(firstToken).expect(400);
    expect(response.body).toMatchObject({ code: "auth.token_invalid" });
  });

  it("respuesta IDÉNTICA exista o no la cuenta y esté o no verificada: solo la cuenta sin verificar recibe correo", async () => {
    const pending = await registerUnverified();
    const verified = await registerUnverified();
    await verify(tokenOf(verifyMails(verified.email).at(-1))).expect(200);
    const unknown = `nadie-${randomUUID()}@example.com`;
    mailer.sent.length = 0;

    const toPending = await resend(pending.email);
    const toVerified = await resend(verified.email);
    const toUnknown = await resend(unknown);

    for (const response of [toPending, toVerified, toUnknown]) {
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ accepted: true });
    }
    expect(verifyMails(pending.email)).toHaveLength(1);
    expect(mailer.sent.filter((m) => m.to === verified.email)).toEqual([]);
    expect(mailer.sent.filter((m) => m.to === unknown)).toEqual([]);
    // La cuenta verificada no gana un enlace nuevo: sigue con el que ya usó.
    await expect(
      prisma.emailVerificationToken.count({ where: { userId: verified.userId } }),
    ).resolves.toBe(1);
  });

  it("el correo sale en el idioma de la cuenta, y el email se normaliza como en forgot-password", async () => {
    const owner = await registerUnverified("en");
    mailer.sent.length = 0;

    await resend(`  ${owner.email.toUpperCase()}  `).expect(202);

    expect(verifyMails(owner.email)).toEqual([expect.objectContaining({ locale: "en" })]);
  });

  it("un invitado sin contraseña no recibe correo de verificación: lo dejaría activo y sin contraseña", async () => {
    const owner = await registerUnverified();
    await verify(tokenOf(verifyMails(owner.email).at(-1))).expect(200);
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    const auth = `Bearer ${login.body.accessToken as string}`;
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", auth)
      .expect(200);
    const viewer = (roles.body as Array<{ id: string; name: string }>).find(
      (role) => role.name === "Viewer",
    );
    const inviteeEmail = `invitado-${randomUUID()}@example.com`;
    const invitee = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", auth)
      .send({
        email: inviteeEmail,
        firstName: "Bruno",
        lastName: "Díaz",
        locale: "es",
        roleIds: [viewer?.id],
      })
      .expect(201);
    mailer.sent.length = 0;

    const response = await resend(inviteeEmail).expect(202);

    expect(response.body).toEqual({ accepted: true });
    expect(mailer.sent.filter((m) => m.to === inviteeEmail)).toEqual([]);
    await expect(
      prisma.emailVerificationToken.count({ where: { userId: invitee.body.id as string } }),
    ).resolves.toBe(0);
  });

  it("un email inválido → 400 auth.invalid_body, igual que forgot-password", async () => {
    const response = await resend("esto-no-es-un-correo").expect(400);

    expect(response.body).toMatchObject({ code: "auth.invalid_body" });
  });
});
