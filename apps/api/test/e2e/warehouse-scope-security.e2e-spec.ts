import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import type { Env } from "../../src/config/env.schema";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { WarehouseScopeInterceptor } from "../../src/infrastructure/warehouse-scope/warehouse-scope.interceptor";
import { TokenService } from "../../src/modules/auth/services/token.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./support/extract-token-from-link";
import { startTestApp } from "./support/start-test-app";

/**
 * e2e de remediación de los 2 CRITICAL del verify-report `sdd/f1-scope`
 * (pasada 1, adversarial): un atacante SIN credenciales, con un JWT de firma
 * BASURA, podía forzar a la app a abrir contexto RLS de un tenant arbitrario
 * (lectura cross-tenant ejecutada) y a pagar una transacción Postgres
 * completa incluso contra un 404 — inmune al `ThrottlerGuard` (rompía AD-7,
 * f1-auth).
 *
 * Metodología equivalente a la del verify: 2 tenants reales (flujo de
 * dominio completo), tokens con firma sintácticamente válida pero BASURA en
 * la tercera parte, y espías sobre `PrismaService.withTenantContext` /
 * `WarehouseScopeInterceptor.intercept` para observar qué contexto RLS se
 * abre y qué `req.scope` queda calculado — sin depender de que algún
 * endpoint consuma `@CurrentUserScope()` (ninguno lo hace todavía, F2).
 */
describe("WarehouseScope — regresión de seguridad (remediación CRITICAL, verify-report f1-scope)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tenantA: { tenantId: string; userId: string; email: string };
  let tenantB: { tenantId: string; userId: string; email: string };
  // F2-DB-07: dejó de ser un UUID inventado. Desde que existe la tabla
  // `warehouses`, la FK de `user_warehouse_scopes` exige un almacén REAL —
  // se crea abajo, en el tenant B.
  let warehouseIdB: string;
  const OWNER_PASSWORD = "twelve-characters";

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

    tenantA = await registerActiveTenant();
    tenantB = await registerActiveTenant();

    // Fila de scope SOLO en el tenant B: si el vector cross-tenant sigue
    // vivo, un anónimo puede forzar una lectura contra esta fila usando el
    // tenantId de B sin tener credenciales de B.
    await prisma.withTenantContext(tenantB.tenantId, async (tx) => {
      const warehouse = await tx.warehouse.create({
        data: { tenantId: tenantB.tenantId, name: `Almacén B ${randomUUID()}` },
      });
      warehouseIdB = warehouse.id;
      await tx.userWarehouseScope.create({
        data: { userId: tenantB.userId, warehouseId: warehouseIdB, tenantId: tenantB.tenantId },
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function registerActiveTenant(): Promise<{
    tenantId: string;
    userId: string;
    email: string;
  }> {
    const email = `owner-${randomUUID()}@example.com`;
    const registerResponse = await request(app.getHttpServer())
      .post("/auth/register-tenant")
      .send({
        tenantName: `Tenant Scope ${randomUUID()}`,
        email,
        password: OWNER_PASSWORD,
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        locale: "es",
      })
      .expect(201);

    const mailer = app.get<NoopMailer>(MAILER);
    const sentMail = mailer.sent.find((m) => m.to === email);
    const token = extractTokenFromLink(sentMail?.vars.link);

    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

    return { ...(registerResponse.body as { tenantId: string; userId: string }), email };
  }

  function forgedBearer(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${header}.${payload}.firma-basura-del-atacante`;
  }

  it("V3 (cross-tenant): anónimo con firma inválida + tenantId de OTRO tenant contra POST /auth/login (@Public) NO abre contexto RLS ajeno", async () => {
    const withTenantContextSpy = jest.spyOn(prisma, "withTenantContext");
    const forged = forgedBearer({
      sub: tenantB.userId,
      tenantId: tenantB.tenantId,
      permissions: [],
    });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Authorization", `Bearer ${forged}`)
      .send({ email: `nadie-${randomUUID()}@example.com`, password: "password-incorrecta" });

    expect(res.status).toBe(401);
    // Antes del fix: withTenantContext se llamaba con tenantB.tenantId acá
    // mismo (el middleware corría sin importar que el guard rechazara
    // después). Con el interceptor, JwtAuthGuard nunca pobló req.user en
    // esta ruta @Public(), así que el interceptor jamás toca la DB.
    expect(withTenantContextSpy).not.toHaveBeenCalled();
  });

  it("V2 (@Public): forjado con permisos de admin contra GET /health NO deja req.scope en 'all' atacante-controlado", async () => {
    const interceptor = app.get(WarehouseScopeInterceptor);
    const original = interceptor.intercept.bind(interceptor);
    const captured: Array<{ url: string; scope: unknown }> = [];
    jest.spyOn(interceptor, "intercept").mockImplementation(async (context, next) => {
      const result = await original(context, next);
      const req = context.switchToHttp().getRequest();
      captured.push({ url: req.url, scope: req.scope });
      return result;
    });

    const forged = forgedBearer({
      sub: randomUUID(),
      tenantId: randomUUID(),
      permissions: ["roles:manage", "users:manage"],
    });

    const res = await request(app.getHttpServer())
      .get("/health")
      .set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(200);
    expect(captured).toEqual([{ url: "/health", scope: undefined }]);
  });

  it("JwtAuthGuard rechaza (401) ANTES de cualquier trabajo de DB: token forjado sin bypass contra ruta protegida no ejecuta withTenantContext", async () => {
    const withTenantContextSpy = jest.spyOn(prisma, "withTenantContext");
    // permissions: [] a propósito — fuerza el camino de DB (sin bypass de
    // TenantAdmin) en el diseño viejo, igual que T1 del verify-report.
    const forged = forgedBearer({
      sub: randomUUID(),
      tenantId: randomUUID(),
      permissions: [],
    });

    const res = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(withTenantContextSpy).not.toHaveBeenCalled();
  });

  // AD-7 DE VERDAD: el test de arriba prueba el corte del guard de AUTH
  // (401), no el del THROTTLER. Son cortes distintos y AD-7 es sobre el
  // segundo: "el throttle tiene que pegar ANTES de gastar ciclos". Sin este
  // caso, la suite prometía cubrir AD-7 y solo cubría el 401 (S5 del verify
  // #296 — un test cuyo nombre promete más de lo que prueba es una trampa
  // para el que confíe en él).
  it("AD-7: los requests rechazados por el THROTTLER (429) no ejecutan withTenantContext", async () => {
    // Tipado con `<Env, true>`: `app.get(ConfigService)` a secas devuelve el
    // genérico laxo, donde `get(clave, { infer: true })` no compila porque la
    // clave se infiere como `never`.
    const configService = app.get<ConfigService<Env, true>>(ConfigService);
    const withTenantContextSpy = jest.spyOn(prisma, "withTenantContext");
    configService.set("THROTTLE_ENABLED", true);

    try {
      const limit = configService.get("THROTTLE_GLOBAL_LIMIT", { infer: true }) as number;
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`; // TEST-NET-3, balde propio
      const forged = forgedBearer({ sub: randomUUID(), tenantId: randomUUID(), permissions: [] });

      const statuses: number[] = [];
      for (let i = 0; i < limit + 3; i++) {
        const res = await request(app.getHttpServer())
          .get("/roles")
          .set("X-Forwarded-For", ip)
          .set("Authorization", `Bearer ${forged}`);
        statuses.push(res.status);
      }

      // El throttler tiene que haber cortado al menos uno con 429...
      expect(statuses).toContain(429);
      // ...y NINGUNO de los requests (ni los 401 ni los 429) puede haber
      // tocado la DB: el interceptor corre después de ambos guards.
      expect(withTenantContextSpy).not.toHaveBeenCalled();
    } finally {
      configService.set("THROTTLE_ENABLED", false);
    }
  });

  it("404 en ruta inexistente con Bearer forjado NO dispara ninguna transacción de DB (amplificación cerrada)", async () => {
    const withTenantContextSpy = jest.spyOn(prisma, "withTenantContext");
    const forged = forgedBearer({ sub: randomUUID(), tenantId: randomUUID(), permissions: [] });

    await request(app.getHttpServer())
      .get("/no-existe-esta-ruta")
      .set("Authorization", `Bearer ${forged}`)
      .expect(404);

    expect(withTenantContextSpy).not.toHaveBeenCalled();
  });

  it("camino feliz: TenantAdmin real autenticado en ruta PROTEGIDA -> scope 'all' vía bypass, SIN query a user_warehouse_scopes", async () => {
    const interceptor = app.get(WarehouseScopeInterceptor);
    const original = interceptor.intercept.bind(interceptor);
    const captured: Array<{ url: string; scope: unknown }> = [];
    jest.spyOn(interceptor, "intercept").mockImplementation(async (context, next) => {
      const result = await original(context, next);
      const req = context.switchToHttp().getRequest();
      captured.push({ url: req.url, scope: req.scope });
      return result;
    });

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: tenantA.email, password: OWNER_PASSWORD })
      .expect(200);

    const accessToken = (login.body as { accessToken: string }).accessToken;
    captured.length = 0;

    // PATCH /me: única ruta protegida (sin @RequirePermissions extra) que no
    // necesita ningún dato de dominio adicional para ejercitarse — el owner
    // de un tenant nuevo es TenantAdmin por default (f1-rbac). PATCH /me
    // hace SU PROPIO `withTenantContext` (actualizar locale), por eso el
    // assert acá se hace sobre `req.scope` capturado (que la query de
    // `user_warehouse_scopes` del interceptor NUNCA corrió: si hubiera
    // corrido, `warehouseIds` sería un array, nunca el string literal
    // `'all'`), no sobre un spy global de `withTenantContext`.
    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locale: "es" })
      .expect(200);

    expect(captured).toEqual([{ url: "/me", scope: { warehouseIds: "all" } }]);
  });

  it("camino feliz: usuario NO-admin autenticado (token REAL, permisos reducidos) -> sus warehouseIds desde la DB, contra RLS real", async () => {
    const tokenService = app.get(TokenService);
    const interceptor = app.get(WarehouseScopeInterceptor);
    const original = interceptor.intercept.bind(interceptor);
    const captured: Array<{ url: string; scope: unknown }> = [];
    jest.spyOn(interceptor, "intercept").mockImplementation(async (context, next) => {
      const result = await original(context, next);
      const req = context.switchToHttp().getRequest();
      captured.push({ url: req.url, scope: req.scope });
      return result;
    });

    // Token REAL firmado con la misma instancia de TokenService que usa la
    // app (verifica firma+issuer+audience de verdad) pero con `permissions`
    // SIN los codes de TenantAdmin — fuerza el camino de DB, no el bypass.
    const accessToken = tokenService.signAccessToken({
      sub: tenantB.userId,
      tenantId: tenantB.tenantId,
      permissions: ["pos:sell"],
      locale: "es",
    });

    await request(app.getHttpServer())
      .patch("/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ locale: "es" })
      .expect(200);

    expect(captured).toEqual([{ url: "/me", scope: { warehouseIds: [warehouseIdB] } }]);
  });
});
