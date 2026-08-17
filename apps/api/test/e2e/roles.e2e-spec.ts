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

const PASSWORD = "twelve-characters";

/**
 * e2e de F1-RBAC-04 (`POST/GET/PATCH/DELETE /roles`). El criterio NO
 * negociable del batch vive acá: cambiar los permisos de un rol tiene que
 * cambiar los permisos EFECTIVOS de todos sus usuarios sin esperar los
 * 15 min del access token — se prueba de DOS formas complementarias:
 *
 * 1. Lectura directa de Redis (`perm-epoch:{tenantId}`, sin TTL) — mismo
 *    estilo de assertion que `auth-forgot-reset-password.e2e-spec.ts`, sin
 *    depender de timing de `iat` (evita el flake documentado en S1 del
 *    backlog de f1-auth).
 * 2. `POST /auth/refresh` con el refresh cookie de ANTES del PATCH: el
 *    access token nuevo trae los permisos FRESCOS, sin el code que se le
 *    sacó al rol — prueba end-to-end de que el mecanismo funciona de
 *    verdad, no solo que el valor en Redis cambió.
 *
 * SOLO se usan los 4 codes del catálogo mínimo de F1
 * (`users:read/manage`, `roles:read/manage`) — dev tiene 10 codes
 * (prisma/seed.ts), CI/prod tienen 4 (migración de datos, ver apply-progress
 * de F1-RBAC-01/02). Nunca assertar el TAMAÑO del catálogo.
 */
describe("Roles CRUD (e2e, F1-RBAC-04)", () => {
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
    await app.init();
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
    refreshCookieHeader: string;
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

    const setCookie = login.headers["set-cookie"] as unknown as string[];
    const cookieLine = setCookie.find((c) => c.startsWith("sp_refresh="));
    if (!cookieLine) {
      throw new Error("sp_refresh cookie no encontrada");
    }
    const refreshCookieHeader = `sp_refresh=${cookieLine.split(";")[0]?.split("=")[1] ?? ""}`;

    const body = registerResponse.body as { tenantId: string; userId: string };
    return {
      ...body,
      email,
      accessToken: login.body.accessToken as string,
      refreshCookieHeader,
    };
  }

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  it("POST /roles crea un rol custom con permissionCodes; GET /roles lo lista", async () => {
    const owner = await registerActiveOwner();

    const created = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Cajero Senior", permissionCodes: ["users:read"] })
      .expect(201);

    expect(created.body).toMatchObject({
      name: "Cajero Senior",
      permissionCodes: ["users:read"],
      userCount: 0,
    });

    const list = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    const names = (list.body as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["TenantAdmin", "Manager", "POS_Seller", "Viewer", "Cajero Senior"]),
    );
  });

  it("POST /roles con nombre duplicado en el tenant -> 409 roles.name_taken", async () => {
    const owner = await registerActiveOwner();

    const response = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "TenantAdmin", permissionCodes: [] })
      .expect(409);
    expect(response.body).toMatchObject({ code: "roles.name_taken" });
  });

  it("POST /roles con un code inexistente -> 400 roles.unknown_permission_code", async () => {
    const owner = await registerActiveOwner();

    const response = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Fantasma", permissionCodes: ["ghost:code"] })
      .expect(400);
    expect(response.body).toMatchObject({ code: "roles.unknown_permission_code" });
  });

  it("PATCH /roles/:id cambia SOLO el nombre -> no bumpea perm-epoch", async () => {
    const owner = await registerActiveOwner();
    const role = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Original", permissionCodes: [] })
      .expect(201);

    const patched = await request(app.getHttpServer())
      .patch(`/roles/${role.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Renombrado" })
      .expect(200);
    expect(patched.body).toMatchObject({ name: "Renombrado" });

    const epoch = await redis.get(`perm-epoch:${owner.tenantId}`);
    expect(epoch).toBeNull();
  });

  it("PATCH /roles/:id cambia permissionCodes -> BUMPEA perm-epoch:{tenantId} SIN TTL (AD-8)", async () => {
    const owner = await registerActiveOwner();
    const role = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Editable", permissionCodes: ["users:read"] })
      .expect(201);

    const beforePatch = Math.floor(Date.now() / 1000);

    await request(app.getHttpServer())
      .patch(`/roles/${role.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ permissionCodes: ["users:manage"] })
      .expect(200);

    const epoch = await redis.get(`perm-epoch:${owner.tenantId}`);
    expect(epoch).toBeTruthy();
    expect(Number(epoch)).toBeGreaterThanOrEqual(beforePatch);
    const ttl = await redis.ttl(`perm-epoch:${owner.tenantId}`);
    expect(ttl).toBe(-1);
  });

  it("criterio clave del batch: swap de permisos del rol TenantAdmin -> el REFRESH del owner trae los permisos frescos", async () => {
    const owner = await registerActiveOwner();

    const rolesBefore = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    const tenantAdmin = (
      rolesBefore.body as Array<{ id: string; name: string; permissionCodes: string[] }>
    ).find((r) => r.name === "TenantAdmin");
    if (!tenantAdmin) {
      throw new Error("TenantAdmin no encontrado");
    }
    expect(tenantAdmin.permissionCodes).toContain("users:read");

    // Le saca `users:read` al rol del propio owner, conservando el resto.
    const newCodes = tenantAdmin.permissionCodes.filter((code) => code !== "users:read");
    await request(app.getHttpServer())
      .patch(`/roles/${tenantAdmin.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ permissionCodes: newCodes })
      .expect(200);

    // El refresh usa el cookie emitido ANTES del PATCH — re-resuelve
    // permisos frescos desde DB en cada rotación (f1-auth design §4).
    const refreshed = await request(app.getHttpServer())
      .post("/auth/refresh")
      .set("Cookie", owner.refreshCookieHeader)
      .expect(200);

    const payloadB64 = (refreshed.body.accessToken as string).split(".")[1] ?? "";
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(claims.permissions).not.toContain("users:read");
    expect(claims.permissions).toContain("users:manage");
  });

  it("PATCH /roles/:id con code inexistente -> 400, no muta permisos existentes", async () => {
    const owner = await registerActiveOwner();
    const role = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Intacto", permissionCodes: ["users:read"] })
      .expect(201);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/roles/${role.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .send({ permissionCodes: ["ghost:code"] })
      .expect(400);
    expect(patchResponse.body).toMatchObject({ code: "roles.unknown_permission_code" });

    const list = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    const stillIntact = (list.body as Array<{ id: string; permissionCodes: string[] }>).find(
      (r) => r.id === role.body.id,
    );
    expect(stillIntact?.permissionCodes).toEqual(["users:read"]);
  });

  it("DELETE /roles/:id con usuarios asignados -> 409 roles.role_in_use", async () => {
    const owner = await registerActiveOwner();
    const roles = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    const tenantAdmin = (roles.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "TenantAdmin",
    );

    const response = await request(app.getHttpServer())
      .delete(`/roles/${tenantAdmin?.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(409);
    expect(response.body).toMatchObject({ code: "roles.role_in_use" });
  });

  it("DELETE /roles/:id sin usuarios -> 204, ya no aparece en GET /roles", async () => {
    const owner = await registerActiveOwner();
    const role = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .send({ name: "Descartable", permissionCodes: [] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/roles/${role.body.id}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(204);

    const list = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);
    expect((list.body as Array<{ id: string }>).map((r) => r.id)).not.toContain(role.body.id);
  });

  it("DELETE /roles/:id inexistente -> 404 roles.not_found", async () => {
    const owner = await registerActiveOwner();

    const response = await request(app.getHttpServer())
      .delete(`/roles/${randomUUID()}`)
      .set("Authorization", bearer(owner.accessToken))
      .expect(404);
    expect(response.body).toMatchObject({ code: "roles.not_found" });
  });
});
