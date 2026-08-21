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
import { INVITATION_TTL_MS } from "../../src/modules/users/user-invitation.service";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";
const INVITEE_PASSWORD = "mi-primera-password-larga";

/**
 * e2e del gap S1 (backlog de f1-rbac): un usuario dado de alta por un admin
 * no tenía NINGUNA forma de entrar — `POST /users` lo creaba `invited`, sin
 * password y sin mail. Acá se prueba el ciclo COMPLETO de punta a punta:
 * alta administrativa → mail de invitación → canje del token → login del
 * invitado.
 *
 * El canje reusa `POST /auth/reset-password`: NO hay endpoint nuevo. Lo que
 * se verifica es que ese canje, sobre un usuario `invited`, lo deje `active`
 * con `emailVerifiedAt` seteado (promoción del "estado zombie", commit
 * 474b183) — la invariante que hace que todo esto funcione sin código nuevo
 * de aceptación.
 */
describe("Aceptación de invitación (e2e, gap S1)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
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
    mailer = app.get<NoopMailer>(MAILER);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  function tokenFromLink(link: string | undefined): string {
    const value = extractTokenFromLink(link);
    if (!value) {
      throw new Error(`Link sin token: ${link}`);
    }
    return value;
  }

  function invitationMail(email: string) {
    return mailer.sent.filter((m) => m.to === email && m.template === "invite-user").at(-1);
  }

  async function registerActiveOwner(): Promise<{
    tenantId: string;
    userId: string;
    email: string;
    accessToken: string;
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

    const verifyMail = mailer.sent.find((m) => m.to === email && m.template === "verify-email");
    await request(app.getHttpServer())
      .post("/auth/verify-email")
      .send({ token: tokenFromLink(verifyMail?.vars.link) })
      .expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    const body = registerResponse.body as { tenantId: string; userId: string };
    return { ...body, email, accessToken: login.body.accessToken as string };
  }

  async function roleIdByName(accessToken: string, name: string): Promise<string> {
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(accessToken))
      .expect(200);
    const role = (roles.body as Array<{ id: string; name: string }>).find((r) => r.name === name);
    if (!role) {
      throw new Error(`Rol ${name} no encontrado`);
    }
    return role.id;
  }

  async function inviteUser(
    ownerToken: string,
    overrides?: { locale?: "es" | "en"; roleName?: string },
  ): Promise<{ id: string; email: string }> {
    const roleId = await roleIdByName(ownerToken, overrides?.roleName ?? "Viewer");
    const email = `invitado-${randomUUID()}@example.com`;
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(ownerToken))
      .send({
        email,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        locale: overrides?.locale ?? "es",
        roleIds: [roleId],
      })
      .expect(201);

    return { id: created.body.id as string, email };
  }

  it("POST /users manda el mail `invite-user` al /accept-invitation, con TTL de 7 días en DB", async () => {
    const owner = await registerActiveOwner();
    const beforeCreate = Date.now();

    const invitee = await inviteUser(owner.accessToken, { locale: "en" });

    const mail = invitationMail(invitee.email);
    expect(mail).toBeDefined();
    expect(mail?.template).toBe("invite-user");
    // El locale del INVITADO manda, no el del admin que lo dio de alta.
    expect(mail?.locale).toBe("en");
    // D3 (#347): el link viaja por fragmento, no por query string.
    expect(mail?.vars.link).toMatch(/\/accept-invitation#token=.+/);
    expect(mail?.vars.link).not.toContain("?token=");
    expect(mail?.vars.firstName).toBe("Bruno");

    const row = await prisma.passwordResetToken.findFirst({
      where: { userId: invitee.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    // Solo el HASH toca la DB: el token en claro vive únicamente en el link.
    expect(row?.tokenHash).not.toBe(tokenFromLink(mail?.vars.link));
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // 7 días, NO los 30 min del reset de password.
    const ttl = (row?.expiresAt.getTime() ?? 0) - beforeCreate;
    expect(ttl).toBeGreaterThan(INVITATION_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(INVITATION_TTL_MS + 60_000);
  });

  // W5 (verify-report #357): la spec #348 pide "GIVEN el driver de mail de
  // test/console activo, WHEN se invita a N personas, THEN el driver de
  // test recibe N mensajes" — nadie probaba la frontera con N > 1. El único
  // e2e existente (arriba) invita a UNA persona; el test del wizard en web
  // mockea `POST /users` y nunca toca el driver de mail. Esta es la costura
  // real: N invitaciones administrativas (mismo endpoint que usa el wizard,
  // "Requirement: El paso 4 del wizard es un punto de entrada adicional")
  // deben producir N mails `invite-user` DISTINTOS, uno por invitado.
  it("W5: invitar a N personas (N=3) deja N mails invite-user en el driver de test, uno por invitado", async () => {
    const owner = await registerActiveOwner();

    const invitees = await Promise.all([
      inviteUser(owner.accessToken),
      inviteUser(owner.accessToken),
      inviteUser(owner.accessToken),
    ]);

    expect(new Set(invitees.map((i) => i.email)).size).toBe(3);

    const mailsForInvitees = invitees.map((invitee) => invitationMail(invitee.email));
    for (const mail of mailsForInvitees) {
      expect(mail).toBeDefined();
      expect(mail?.template).toBe("invite-user");
    }

    // Cada invitado recibió SU PROPIO mail (mismo `to`), no uno compartido —
    // y son 3 mensajes distintos en el driver, no el mismo contado 3 veces.
    const uniqueLinks = new Set(mailsForInvitees.map((mail) => mail?.vars.link));
    expect(uniqueLinks.size).toBe(3);

    const totalInviteMailsSent = mailer.sent.filter((m) => m.template === "invite-user").length;
    expect(totalInviteMailsSent).toBeGreaterThanOrEqual(3);
  });

  it("el invitado canjea el token, queda ACTIVE con email verificado y puede loguear", async () => {
    const owner = await registerActiveOwner();
    const invitee = await inviteUser(owner.accessToken);

    // El invitado NO puede loguear antes de aceptar: no tiene password.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: invitee.email, password: INVITEE_PASSWORD })
      .expect(401);

    const token = tokenFromLink(invitationMail(invitee.email)?.vars.link);

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: INVITEE_PASSWORD })
      .expect(204);

    const detail = await request(app.getHttpServer())
      .get(`/users/${invitee.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    expect(detail.body).toMatchObject({ status: "active" });

    const row = await prisma.user.findUnique({ where: { id: invitee.id } });
    expect(row?.emailVerifiedAt).not.toBeNull();

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: invitee.email, password: INVITEE_PASSWORD })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it("el token de invitación es de UN SOLO USO: el segundo canje da 400 auth.token_invalid", async () => {
    const owner = await registerActiveOwner();
    const invitee = await inviteUser(owner.accessToken);
    const token = tokenFromLink(invitationMail(invitee.email)?.vars.link);

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: INVITEE_PASSWORD })
      .expect(204);

    const second = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: "otra-password-larga" })
      .expect(400);
    expect(second.body).toMatchObject({ code: "auth.token_invalid" });
  });

  it("POST /users/:id/resend-invitation MATA el link anterior y emite uno nuevo canjeable", async () => {
    const owner = await registerActiveOwner();
    const invitee = await inviteUser(owner.accessToken);
    const firstToken = tokenFromLink(invitationMail(invitee.email)?.vars.link);

    await request(app.getHttpServer())
      .post(`/users/${invitee.id}/resend-invitation`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    const secondToken = tokenFromLink(invitationMail(invitee.email)?.vars.link);
    expect(secondToken).not.toBe(firstToken);

    // El link viejo ya no sirve — indistinguible de inexistente/expirado.
    const stale = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: firstToken, password: INVITEE_PASSWORD })
      .expect(400);
    expect(stale.body).toMatchObject({ code: "auth.token_invalid" });

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: secondToken, password: INVITEE_PASSWORD })
      .expect(204);
  });

  it("resend-invitation sobre un usuario que ya aceptó -> 409 users.not_invited", async () => {
    const owner = await registerActiveOwner();
    const invitee = await inviteUser(owner.accessToken);
    const token = tokenFromLink(invitationMail(invitee.email)?.vars.link);
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token, password: INVITEE_PASSWORD })
      .expect(204);

    const response = await request(app.getHttpServer())
      .post(`/users/${invitee.id}/resend-invitation`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(409);
    expect(response.body).toMatchObject({ code: "users.not_invited" });
  });

  it("resend-invitation de un usuario inexistente (o de otro tenant) -> 404 users.not_found", async () => {
    const owner = await registerActiveOwner();
    const other = await registerActiveOwner();
    const foreign = await inviteUser(other.accessToken);

    const ghost = await request(app.getHttpServer())
      .post(`/users/${randomUUID()}/resend-invitation`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(404);
    expect(ghost.body).toMatchObject({ code: "users.not_found" });

    await request(app.getHttpServer())
      .post(`/users/${foreign.id}/resend-invitation`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(404);
  });

  it("un invitado ya activo SIN users:manage no puede reenviar invitaciones -> 403", async () => {
    const owner = await registerActiveOwner();
    const viewer = await inviteUser(owner.accessToken, { roleName: "Viewer" });
    const otro = await inviteUser(owner.accessToken);

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({
        token: tokenFromLink(invitationMail(viewer.email)?.vars.link),
        password: INVITEE_PASSWORD,
      })
      .expect(204);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: viewer.email, password: INVITEE_PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/users/${otro.id}/resend-invitation`)
      .set("Authorization", bearer(login.body.accessToken as string))
      .expect(403);
  });
});
