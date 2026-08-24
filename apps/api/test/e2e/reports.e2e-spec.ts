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
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

const PASSWORD = "twelve-characters";

/**
 * F5-CORE-03 — `reports:read` estrena puerta.
 *
 * El permiso existe en producción desde la migración `20260821180000` y hasta
 * hoy NINGÚN endpoint lo exigía: lo detectó `permissions-catalog.spec.ts`
 * buscando permisos huérfanos. Un permiso sin puerta es un permiso que nadie
 * puede ejercer y que nadie puede probar.
 *
 * El esperado de cada rol NO se hardcodea: sale de `resolveRolePermissionCodes`
 * —la misma función que usa `TenantsService.provision()`— aplicada al catálogo
 * real de este entorno. Así el test vale igual en dev (seed) que en CI
 * (migraciones) sin tocarlo, mismo criterio que la matriz RBAC de F1-RBAC-06.
 */
describe("Reportes: la puerta de reports:read (F5-CORE-03)", () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;
  let tenantId: string;
  let roleTokens: Record<TenantRoleName, string>;
  let permissionsByRole: Record<TenantRoleName, string[]>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    tokenService = app.get(TokenService);

    const email = `owner-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant reports ${randomUUID()}`,
        email,
        password: PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);
    tenantId = (registered.body as { tenantId: string }).tenantId;

    const mailer = app.get<NoopMailer>(MAILER);
    const link = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token: link }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    const ownerToken = (login.body as { accessToken: string }).accessToken;

    const catalog = await request(app.getHttpServer())
      .get("/permissions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    // El catálogo viene AGRUPADO por módulo, igual que lo lee la matriz RBAC.
    const catalogCodes = (catalog.body as Array<{ permissions: Array<{ code: string }> }>).flatMap(
      (group) => group.permissions.map((p) => p.code),
    );

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
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(TENANT_ROLE_NAMES)("%s: GET /reports responde según reports:read", async (roleName) => {
    const response = await request(app.getHttpServer())
      .get("/reports")
      .set("Authorization", `Bearer ${roleTokens[roleName]}`);

    const deberiaPasar = permissionsByRole[roleName].includes("reports:read");
    expect({ rol: roleName, status: response.status }).toEqual({
      rol: roleName,
      status: deberiaPasar ? 200 : 403,
    });
  });

  /**
   * El complemento del `it.each`: si un día `resolveRolePermissionCodes`
   * repartiera `reports:read` a los cuatro roles, el test de arriba pasaría
   * en verde sin haber probado NINGÚN 403. Esto fija la matriz que la
   * atomización de F5 decidió.
   */
  it("POS_Seller NO tiene reports:read y los otros tres SÍ", () => {
    expect(permissionsByRole.POS_Seller).not.toContain("reports:read");
    expect(permissionsByRole.TenantAdmin).toContain("reports:read");
    expect(permissionsByRole.Manager).toContain("reports:read");
    expect(permissionsByRole.Viewer).toContain("reports:read");
  });

  it("sin token no se entra", async () => {
    await request(app.getHttpServer()).get("/reports").expect(401);
  });

  it("el catálogo nombra los reportes con el permiso que exige cada uno", async () => {
    const response = await request(app.getHttpServer())
      .get("/reports")
      .set("Authorization", `Bearer ${roleTokens.Viewer}`)
      .expect(200);

    const body = response.body as {
      reports: { key: string; permission: string }[];
      maxExportRows: number;
    };

    // Las 8 tarjetas del hub (VISTAS §10).
    expect(body.reports.map((r) => r.key).sort()).toEqual([
      "expiring",
      "inTransit",
      "kardex",
      "products",
      "sales",
      "stock",
      "users",
      "warehouses",
    ]);

    // Vencimientos y tránsito son la misma lectura de su pantalla en otro
    // formato, así que van con `inventory:read` — no con `reports:read`.
    const porClave = new Map(body.reports.map((r) => [r.key, r.permission]));
    expect(porClave.get("expiring")).toBe("inventory:read");
    expect(porClave.get("inTransit")).toBe("inventory:read");
    expect(porClave.get("stock")).toBe("reports:read");

    expect(body.maxExportRows).toBe(10_000);
  });
});
