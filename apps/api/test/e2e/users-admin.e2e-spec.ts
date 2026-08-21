import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { REDIS_CLIENT } from "../../src/infrastructure/redis/redis.module";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";

/**
 * e2e de F1-RBAC-03 (`POST/GET/GET:id/PATCH /users`, `POST /users/:id/
 * suspend|reactivate`). `POST /users/:id/suspend` bumpea
 * `perm-epoch:{userId}` (target, no el actor) — misma verificación directa
 * de Redis que `roles.e2e-spec.ts`.
 */
describe("Users CRUD administrativo (e2e, F1-RBAC-03)", () => {
  let app: INestApplication<App>;
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
    redis = app.get<Redis>(REDIS_CLIENT);
    mailer = app.get<NoopMailer>(MAILER);
  });

  afterAll(async () => {
    await app.close();
  });

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
    const token = extractTokenFromLink(sentMail?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    const body = registerResponse.body as { tenantId: string; userId: string };
    return { ...body, email, accessToken: login.body.accessToken as string };
  }

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  async function viewerRoleId(accessToken: string): Promise<string> {
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(accessToken))
      .expect(200);
    const viewer = (roles.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "Viewer",
    );
    if (!viewer) {
      throw new Error("Viewer no encontrado");
    }
    return viewer.id;
  }

  it("POST /users crea un user invited con roles asignados; GET /users lo lista", async () => {
    const owner = await registerActiveOwner();
    const roleId = await viewerRoleId(owner.accessToken);
    const email = `nuevo-${randomUUID()}@example.com`;

    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({ email, firstName: "Bruno", lastNamePaternal: "Díaz", roleIds: [roleId] })
      .expect(201);

    expect(created.body).toMatchObject({
      email,
      status: "invited",
      roles: [{ id: roleId, name: "Viewer" }],
    });

    const list = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    expect((list.body as Array<{ email: string }>).map((u) => u.email)).toEqual(
      expect.arrayContaining([owner.email, email]),
    );
  });

  it("GET /users/:id devuelve el detalle; inexistente -> 404 users.not_found", async () => {
    const owner = await registerActiveOwner();
    const roleId = await viewerRoleId(owner.accessToken);
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `x-${randomUUID()}@example.com`,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: [roleId],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/users/${created.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    const notFound = await request(app.getHttpServer())
      .get(`/users/${randomUUID()}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(404);
    expect(notFound.body).toMatchObject({ code: "users.not_found" });
  });

  it("POST /users con email duplicado (unique GLOBAL) -> 409 users.email_taken", async () => {
    const owner = await registerActiveOwner();
    const roleId = await viewerRoleId(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: owner.email,
        firstName: "Otro",
        lastNamePaternal: "Nombre",
        roleIds: [roleId],
      })
      .expect(409);
    expect(response.body).toMatchObject({ code: "users.email_taken" });
  });

  it("POST /users con roleId de otro tenant -> 400 users.invalid_role_ids", async () => {
    const owner = await registerActiveOwner();
    const other = await registerActiveOwner();
    const otherRoleId = await viewerRoleId(other.accessToken);

    const response = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `cross-${randomUUID()}@example.com`,
        firstName: "X",
        lastNamePaternal: "Y",
        roleIds: [otherRoleId],
      })
      .expect(400);
    expect(response.body).toMatchObject({ code: "users.invalid_role_ids" });
  });

  it("PATCH /users/:id actualiza perfil y reemplaza roles", async () => {
    const owner = await registerActiveOwner();
    const viewerId = await viewerRoleId(owner.accessToken);
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `patch-${randomUUID()}@example.com`,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: [viewerId],
      })
      .expect(201);

    const patched = await request(app.getHttpServer())
      .patch(`/users/${created.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ locale: "en" })
      .expect(200);
    expect(patched.body).toMatchObject({ locale: "en" });
  });

  it("PATCH /users/:id reemplaza roleIds -> BUMPEA perm-epoch:{userId} (permisos del user cambian)", async () => {
    const owner = await registerActiveOwner();
    const viewerId = await viewerRoleId(owner.accessToken);
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    const managerId = (roles.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "Manager",
    )?.id;

    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `reroles-${randomUUID()}@example.com`,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: [viewerId],
      })
      .expect(201);

    const beforePatch = Math.floor(Date.now() / 1000);

    await request(app.getHttpServer())
      .patch(`/users/${created.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ roleIds: [managerId] })
      .expect(200);

    const epoch = await redis.get(`perm-epoch:${created.body.id}`);
    expect(epoch).toBeTruthy();
    expect(Number(epoch)).toBeGreaterThanOrEqual(beforePatch);
    const ttl = await redis.ttl(`perm-epoch:${created.body.id}`);
    expect(ttl).toBe(-1);
  });

  it("POST /users/:id/suspend BUMPEA perm-epoch:{userId}; POST /users/:id/reactivate lo revierte", async () => {
    const owner = await registerActiveOwner();
    const viewerId = await viewerRoleId(owner.accessToken);
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `suspend-${randomUUID()}@example.com`,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: [viewerId],
      })
      .expect(201);

    const beforeSuspend = Math.floor(Date.now() / 1000);

    const suspended = await request(app.getHttpServer())
      .post(`/users/${created.body.id}/suspend`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    expect(suspended.body).toMatchObject({ status: "suspended" });

    const epoch = await redis.get(`perm-epoch:${created.body.id}`);
    expect(epoch).toBeTruthy();
    expect(Number(epoch)).toBeGreaterThanOrEqual(beforeSuspend);
    const ttl = await redis.ttl(`perm-epoch:${created.body.id}`);
    expect(ttl).toBe(-1);

    const reactivated = await request(app.getHttpServer())
      .post(`/users/${created.body.id}/reactivate`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    expect(reactivated.body).toMatchObject({ status: "active" });
  });

  it("POST /users/:id/reactivate sobre un user NO suspendido -> 409 users.not_suspended", async () => {
    const owner = await registerActiveOwner();
    const viewerId = await viewerRoleId(owner.accessToken);
    const created = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(owner.accessToken))
      .send({
        email: `notsuspended-${randomUUID()}@example.com`,
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: [viewerId],
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/users/${created.body.id}/reactivate`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(409);
    expect(response.body).toMatchObject({ code: "users.not_suspended" });
  });

  it("un usuario no puede suspenderse a sí mismo -> 409 users.cannot_suspend_self", async () => {
    const owner = await registerActiveOwner();

    const response = await request(app.getHttpServer())
      .post(`/users/${owner.userId}/suspend`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(409);
    expect(response.body).toMatchObject({ code: "users.cannot_suspend_self" });
  });
});
