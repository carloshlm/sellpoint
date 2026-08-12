import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

const PASSWORD = "twelve-characters";

/**
 * Hardening post-verify #274 (`sdd/f1-rbac/verify-report`, WARNING W1/W2).
 * Contra la app real (Postgres + Redis), no contra mocks.
 *
 * - W1 (escalada de privilegios intra-tenant): un actor con SOLO
 *   `roles:manage` no puede otorgarle a un rol un permiso que él mismo no
 *   posee, ni por `POST /roles` ni por `PATCH /roles/:id`. El token del
 *   actor limitado se firma directo con `TokenService` (mismo patrón que
 *   `rbac-permissions.e2e-spec.ts`/`rbac-users-roles-matrix.e2e-spec.ts`):
 *   `PermissionsGuard` solo lee los claims del JWT ya verificado, no hace
 *   falta que el actor exista como `User` real en la tabla.
 * - W2 (lockout del tenant): un tenant SIEMPRE tiene que conservar al
 *   menos un rol con `roles:manage`+`users:manage` asignado a un usuario
 *   ACTIVO. Se prueban los 3 vectores HTTP reales: `PATCH /roles/:id`,
 *   `PATCH /users/:id` (roleIds) y `POST /users/:id/suspend`.
 */
describe("Hardening W1/W2 de F1-RBAC (e2e, post-verify #274)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
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
    mailer = app.get<NoopMailer>(MAILER);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string) {
    return `Bearer ${token}`;
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

    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    const body = registerResponse.body as { tenantId: string; userId: string };
    return { ...body, email, accessToken: login.body.accessToken as string };
  }

  function tokenWith(tenantId: string, permissions: string[]): string {
    return tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId,
      permissions,
      locale: "es",
    });
  }

  async function tenantAdminRoleId(accessToken: string): Promise<string> {
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(accessToken))
      .expect(200);
    const tenantAdmin = (roles.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "TenantAdmin",
    );
    if (!tenantAdmin) {
      throw new Error("TenantAdmin no encontrado");
    }
    return tenantAdmin.id;
  }

  describe("W1 — escalada de privilegios intra-tenant", () => {
    it("POST /roles: actor con SOLO roles:manage no puede otorgar users:manage -> 403", async () => {
      const owner = await registerActiveOwner();
      const limitedToken = tokenWith(owner.tenantId, ["roles:manage"]);

      const response = await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(limitedToken))
        .send({ name: `Auto-escalado ${randomUUID()}`, permissionCodes: ["users:manage"] })
        .expect(403);
      expect(response.body).toMatchObject({ code: "roles.cannot_grant_unheld_permission" });
    });

    it("POST /roles: actor con SOLO roles:manage SÍ puede otorgar lo que ya posee -> 201", async () => {
      const owner = await registerActiveOwner();
      const limitedToken = tokenWith(owner.tenantId, ["roles:manage"]);

      await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(limitedToken))
        .send({ name: `Sub-admin ${randomUUID()}`, permissionCodes: ["roles:manage"] })
        .expect(201);
    });

    it("PATCH /roles/:id: actor con SOLO roles:manage no puede agregarle users:manage a un rol existente -> 403", async () => {
      const owner = await registerActiveOwner();
      const target = await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .send({ name: `Target ${randomUUID()}`, permissionCodes: ["roles:read"] })
        .expect(201);

      const limitedToken = tokenWith(owner.tenantId, ["roles:manage"]);
      const response = await request(app.getHttpServer())
        .patch(`/roles/${target.body.id}`)
        .set("Authorization", bearer(limitedToken))
        .send({ permissionCodes: ["roles:read", "users:manage"] })
        .expect(403);
      expect(response.body).toMatchObject({ code: "roles.cannot_grant_unheld_permission" });

      // No mutó nada: el rol sigue con su set original.
      const list = await request(app.getHttpServer())
        .get("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      const stillIntact = (list.body as Array<{ id: string; permissionCodes: string[] }>).find(
        (r) => r.id === target.body.id,
      );
      expect(stillIntact?.permissionCodes).toEqual(["roles:read"]);
    });

    it("PATCH /roles/:id: bajar privilegios ajenos (quitar codes que el actor tampoco posee) SÍ se permite", async () => {
      const owner = await registerActiveOwner();
      const target = await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .send({
          name: `Target ${randomUUID()}`,
          permissionCodes: ["roles:read", "users:read", "users:manage"],
        })
        .expect(201);

      const limitedToken = tokenWith(owner.tenantId, ["roles:manage"]);
      await request(app.getHttpServer())
        .patch(`/roles/${target.body.id}`)
        .set("Authorization", bearer(limitedToken))
        .send({ permissionCodes: ["roles:read"] })
        .expect(200);
    });
  });

  describe("W2 — lockout del tenant (protección del último admin)", () => {
    it("PATCH /roles/:id: quitarle users:manage al ÚNICO rol admin (TenantAdmin) -> 409 roles.last_admin_protected", async () => {
      const owner = await registerActiveOwner();
      const roleId = await tenantAdminRoleId(owner.accessToken);

      const roles = await request(app.getHttpServer())
        .get("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      const tenantAdmin = (roles.body as Array<{ id: string; permissionCodes: string[] }>).find(
        (r) => r.id === roleId,
      );
      const withoutUsersManage = (tenantAdmin?.permissionCodes ?? []).filter(
        (code) => code !== "users:manage",
      );

      const response = await request(app.getHttpServer())
        .patch(`/roles/${roleId}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ permissionCodes: withoutUsersManage })
        .expect(409);
      expect(response.body).toMatchObject({ code: "roles.last_admin_protected" });

      // No mutó nada: el TenantAdmin conserva users:manage.
      const after = await request(app.getHttpServer())
        .get("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      const stillAdmin = (after.body as Array<{ id: string; permissionCodes: string[] }>).find(
        (r) => r.id === roleId,
      );
      expect(stillAdmin?.permissionCodes).toContain("users:manage");
    });

    it("camino feliz: CON DOS roles admin (mismo usuario, un segundo rol propio), sacarle permisos a UNO SÍ se permite", async () => {
      const owner = await registerActiveOwner();
      const tenantAdminId = await tenantAdminRoleId(owner.accessToken);

      const secondAdmin = await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .send({
          name: `Second Admin ${randomUUID()}`,
          permissionCodes: ["roles:manage", "users:manage"],
        })
        .expect(201);

      // El owner queda con AMBOS roles admin (TenantAdmin intacto +
      // SecondAdmin) — la invariante la cubre TenantAdmin, así que
      // SecondAdmin puede perder permisos sin romper nada.
      await request(app.getHttpServer())
        .patch(`/users/${owner.userId}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ roleIds: [tenantAdminId, secondAdmin.body.id] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/roles/${secondAdmin.body.id}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ permissionCodes: ["roles:manage"] })
        .expect(200);
    });

    it("PATCH /users/:id roleIds: sacarle el rol TenantAdmin al ÚNICO admin activo -> 409 roles.last_admin_protected", async () => {
      const owner = await registerActiveOwner();
      const roles = await request(app.getHttpServer())
        .get("/roles")
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      const viewerRoleId = (roles.body as Array<{ id: string; name: string }>).find(
        (r) => r.name === "Viewer",
      )?.id as string;

      const response = await request(app.getHttpServer())
        .patch(`/users/${owner.userId}`)
        .set("Authorization", bearer(owner.accessToken))
        .send({ roleIds: [viewerRoleId] })
        .expect(409);
      expect(response.body).toMatchObject({ code: "roles.last_admin_protected" });

      // No mutó nada: el owner sigue siendo TenantAdmin.
      const detail = await request(app.getHttpServer())
        .get(`/users/${owner.userId}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      expect((detail.body.roles as Array<{ name: string }>).map((r) => r.name)).toContain(
        "TenantAdmin",
      );
    });

    it("POST /users/:id/suspend: suspender al ÚNICO admin activo (actor distinto, con users:manage) -> 409 roles.last_admin_protected", async () => {
      const owner = await registerActiveOwner();
      // Actor con `users:manage` pero SIN existir como User real — el
      // ataque real sería un usuario con un rol custom que solo tiene
      // users:manage (posible gracias al guard W1: un actor solo puede
      // otorgar lo que YA posee, y el owner posee todo).
      const actorToken = tokenWith(owner.tenantId, ["users:manage", "users:read"]);

      const response = await request(app.getHttpServer())
        .post(`/users/${owner.userId}/suspend`)
        .set("Authorization", bearer(actorToken))
        .expect(409);
      expect(response.body).toMatchObject({ code: "roles.last_admin_protected" });

      // No mutó nada: el owner sigue activo.
      const detail = await request(app.getHttpServer())
        .get(`/users/${owner.userId}`)
        .set("Authorization", bearer(owner.accessToken))
        .expect(200);
      expect(detail.body).toMatchObject({ status: "active" });
    });
  });
});
