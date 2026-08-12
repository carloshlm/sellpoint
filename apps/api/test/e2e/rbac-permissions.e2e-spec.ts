import { randomUUID } from "node:crypto";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { RequirePermissions } from "../../src/modules/auth/decorators/require-permissions.decorator";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";

/**
 * e2e de F1-RBAC-01/02 + gate W3 del verify de f1-auth.
 *
 * El controller de prueba existe solo acá: los CRUD reales protegidos por
 * permisos llegan en F1-RBAC-03/04/05. Lo que se ejercita es la cadena
 * completa contra la app real — JwtAuthGuard (firma + epoch) →
 * PermissionsGuard (autorización) — no el guard aislado, que ya tiene su
 * unit test.
 */
@Controller("rbac-test")
class RbacTestController {
  @Get("protegido")
  @RequirePermissions("users:manage")
  protegido() {
    return { ok: true };
  }

  @Get("solo-autenticado")
  soloAutenticado() {
    return { ok: true };
  }
}

describe("RBAC: PermissionsGuard (e2e)", () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacTestController],
    })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  function tokenWith(permissions: string[]): string {
    return tokenService.signAccessToken({
      sub: randomUUID(),
      tenantId: randomUUID(),
      permissions,
      locale: "es",
    });
  }

  it("sin permiso requerido → 403 con mensaje traducido y code estable", async () => {
    const response = await request(app.getHttpServer())
      .get("/rbac-test/protegido")
      .set("Authorization", `Bearer ${tokenWith(["users:read"])}`)
      .expect(403);

    expect(response.body.code).toBe("auth.forbidden");
    // C2 del verify de f1-auth: el backend traduce, no devuelve la clave cruda.
    expect(response.body.message).not.toBe("auth.forbidden");
  });

  it("con el permiso requerido → pasa", async () => {
    await request(app.getHttpServer())
      .get("/rbac-test/protegido")
      .set("Authorization", `Bearer ${tokenWith(["users:manage"])}`)
      .expect(200, { ok: true });
  });

  it("permissions:[] (catálogo sin sembrar) NO pasa un endpoint protegido", async () => {
    await request(app.getHttpServer())
      .get("/rbac-test/protegido")
      .set("Authorization", `Bearer ${tokenWith([])}`)
      .expect(403);
  });

  it("un endpoint sin @RequirePermissions solo exige estar autenticado", async () => {
    await request(app.getHttpServer())
      .get("/rbac-test/solo-autenticado")
      .set("Authorization", `Bearer ${tokenWith([])}`)
      .expect(200, { ok: true });
  });

  it("sin token, el JwtAuthGuard corta ANTES que el de permisos (401, no 403)", async () => {
    await request(app.getHttpServer()).get("/rbac-test/protegido").expect(401);
  });

  it("W3: el owner de un tenant recién registrado nace con permisos reales, no vacíos", async () => {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Acme ${randomUUID()}`,
        email,
        password: "twelve-characters",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const link = mailer.sent.find((m) => m.to === email)?.vars.link ?? "";
    const token = new URL(link, "http://localhost").searchParams.get("token");
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "twelve-characters" })
      .expect(200);

    const claims = JSON.parse(
      Buffer.from(login.body.accessToken.split(".")[1], "base64url").toString(),
    );

    // Sin aserción sobre el TAMAÑO del catálogo: dev puede tener codes de
    // módulos futuros sembrados por prisma/seed.ts que CI/prod no tienen.
    // Lo que importa es que el TenantAdmin nazca con permisos de gestión.
    expect(claims.permissions).toContain("users:manage");
    expect(claims.permissions).toContain("roles:manage");
  });
});
