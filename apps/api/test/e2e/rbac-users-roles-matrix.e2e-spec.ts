import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  resolveRolePermissionCodes,
  TENANT_ROLE_NAMES,
  type TenantRoleName,
} from "../../src/modules/tenants/role-catalog";

const PASSWORD = "twelve-characters";

/**
 * F1-RBAC-06: matriz rol × endpoint sobre los 3 controllers nuevos del
 * batch (`/users`, `/roles`, `/permissions`). El "esperado" de cada celda
 * NO se hardcodea: se deriva de `resolveRolePermissionCodes()` — la MISMA
 * función que `TenantsService.provision()` usa para armar los 4 roles base
 * de cada tenant — aplicada sobre el catálogo REAL que devuelve
 * `GET /permissions` en este entorno. Así la matriz vale igual en dev
 * (10 codes, prisma/seed.ts) que en CI/prod (4 codes, migración de
 * F1-RBAC-01/02) sin tocar el test.
 *
 * Los tokens de Manager/POS_Seller/Viewer se firman directo con
 * `TokenService` (mismo patrón que `rbac-permissions.e2e-spec.ts`) — no
 * hace falta loguear de verdad: `PermissionsGuard` solo mira los claims
 * `permissions` del JWT ya verificado, y `JwtAuthGuard` no exige que el
 * `sub` exista en `users` (mismo `tenantId` real del tenant de prueba).
 */
describe("Matriz RBAC: rol × endpoint (e2e, F1-RBAC-06)", () => {
  let app: INestApplication<App>;
  let mailer: NoopMailer;
  let tokenService: TokenService;

  let tenantId: string;
  let ownerAccessToken: string;
  let roleTokens: Record<TenantRoleName, string>;
  let permissionsByRole: Record<TenantRoleName, string[]>;
  let targetRoleId: string;
  let targetUserId: string;

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
    tenantId = (registerResponse.body as { tenantId: string }).tenantId;

    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = new URL(sentMail?.vars.link ?? "", "http://localhost").searchParams.get("token");
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    ownerAccessToken = login.body.accessToken as string;

    const permissionsResponse = await request(app.getHttpServer())
      .get("/permissions")
      .set("Authorization", bearer(ownerAccessToken))
      .expect(200);
    const catalogCodes = (
      permissionsResponse.body as Array<{ permissions: Array<{ code: string }> }>
    ).flatMap((group) => group.permissions.map((p) => p.code));

    permissionsByRole = resolveRolePermissionCodes(catalogCodes);
    roleTokens = Object.fromEntries(
      TENANT_ROLE_NAMES.map((roleName) => [
        roleName,
        tokenService.signAccessToken({
          sub: randomUUID(),
          tenantId,
          permissions: permissionsByRole[roleName],
          locale: "es",
        }),
      ]),
    ) as Record<TenantRoleName, string>;

    const roleResponse = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(ownerAccessToken))
      .send({ name: `Matrix Target ${randomUUID()}`, permissionCodes: [] })
      .expect(201);
    targetRoleId = roleResponse.body.id as string;

    const rolesResponse = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(ownerAccessToken))
      .expect(200);
    const viewerRoleId = (rolesResponse.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "Viewer",
    )?.id as string;

    const userResponse = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(ownerAccessToken))
      .send({
        email: `matrix-target-${randomUUID()}@example.com`,
        firstName: "Target",
        lastNamePaternal: "User",
        roleIds: [viewerRoleId],
      })
      .expect(201);
    targetUserId = userResponse.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string) {
    return `Bearer ${token}`;
  }

  it.each(TENANT_ROLE_NAMES)("%s: GET /permissions requiere roles:read", async (roleName) => {
    const response = await request(app.getHttpServer())
      .get("/permissions")
      .set("Authorization", bearer(roleTokens[roleName]));

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("roles:read"));
  });

  it.each(TENANT_ROLE_NAMES)("%s: GET /roles requiere roles:read", async (roleName) => {
    const response = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(roleTokens[roleName]));

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("roles:read"));
  });

  it.each(TENANT_ROLE_NAMES)("%s: GET /users requiere users:read", async (roleName) => {
    const response = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", bearer(roleTokens[roleName]));

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("users:read"));
  });

  it.each(TENANT_ROLE_NAMES)("%s: GET /users/:id requiere users:read", async (roleName) => {
    const response = await request(app.getHttpServer())
      .get(`/users/${targetUserId}`)
      .set("Authorization", bearer(roleTokens[roleName]));

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("users:read"));
  });

  it.each(TENANT_ROLE_NAMES)("%s: PATCH /roles/:id requiere roles:manage", async (roleName) => {
    const response = await request(app.getHttpServer())
      .patch(`/roles/${targetRoleId}`)
      .set("Authorization", bearer(roleTokens[roleName]))
      .send({ name: `Matrix Target ${randomUUID()}` });

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("roles:manage"));
  });

  it.each(TENANT_ROLE_NAMES)("%s: POST /roles requiere roles:manage", async (roleName) => {
    const response = await request(app.getHttpServer())
      .post("/roles")
      .set("Authorization", bearer(roleTokens[roleName]))
      .send({ name: `Matrix ${roleName} ${randomUUID()}`, permissionCodes: [] });

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("roles:manage"), 201);
  });

  it.each(TENANT_ROLE_NAMES)("%s: POST /users requiere users:manage", async (roleName) => {
    const rolesResponse = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", bearer(ownerAccessToken))
      .expect(200);
    const viewerRoleId = (rolesResponse.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === "Viewer",
    )?.id as string;

    const response = await request(app.getHttpServer())
      .post("/users")
      .set("Authorization", bearer(roleTokens[roleName]))
      .send({
        email: `matrix-${roleName}-${randomUUID()}@example.com`,
        firstName: "Matrix",
        lastNamePaternal: roleName,
        roleIds: [viewerRoleId],
      });

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("users:manage"), 201);
  });

  it.each(TENANT_ROLE_NAMES)("%s: PATCH /users/:id requiere users:manage", async (roleName) => {
    const response = await request(app.getHttpServer())
      .patch(`/users/${targetUserId}`)
      .set("Authorization", bearer(roleTokens[roleName]))
      .send({ locale: "en" });

    assertAllowedIff(response.status, permissionsByRole[roleName].includes("users:manage"));
  });

  it.each(TENANT_ROLE_NAMES)(
    "%s: DELETE /roles/:id requiere roles:manage (rol descartable por intento, sin usuarios)",
    async (roleName) => {
      const disposable = await request(app.getHttpServer())
        .post("/roles")
        .set("Authorization", bearer(ownerAccessToken))
        .send({ name: `Descartable ${roleName} ${randomUUID()}`, permissionCodes: [] })
        .expect(201);

      const response = await request(app.getHttpServer())
        .delete(`/roles/${disposable.body.id}`)
        .set("Authorization", bearer(roleTokens[roleName]));

      assertAllowedIff(response.status, permissionsByRole[roleName].includes("roles:manage"), 204);
    },
  );

  it("solo TenantAdmin (el único con users:manage en el catálogo mínimo) puede suspender/reactivar", async () => {
    const canManageUsers = permissionsByRole.TenantAdmin.includes("users:manage");
    expect(canManageUsers).toBe(true);

    const suspend = await request(app.getHttpServer())
      .post(`/users/${targetUserId}/suspend`)
      .set("Authorization", bearer(roleTokens.TenantAdmin));
    expect(suspend.status).toBe(200);

    const forbiddenRole = permissionsByRole.Viewer.includes("users:manage") ? "Manager" : "Viewer";
    const reactivateForbidden = await request(app.getHttpServer())
      .post(`/users/${targetUserId}/reactivate`)
      .set("Authorization", bearer(roleTokens[forbiddenRole]));
    expect(reactivateForbidden.status).toBe(403);

    const reactivate = await request(app.getHttpServer())
      .post(`/users/${targetUserId}/reactivate`)
      .set("Authorization", bearer(roleTokens.TenantAdmin));
    expect(reactivate.status).toBe(200);
  });

  function assertAllowedIff(status: number, allowed: boolean, successStatus = 200): void {
    if (allowed) {
      expect(status).toBe(successStatus);
    } else {
      expect(status).toBe(403);
    }
  }
});
