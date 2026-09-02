import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../src/modules/mail/mailer.port";
import { NoopMailer } from "../../src/modules/mail/noop.mailer";
import {
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./support/billing-scenario";
import { startTestApp } from "./support/start-test-app";

/**
 * F9-MOD-10 — el ciclo de vida de un módulo avanzado, de punta a punta.
 *
 * Lo que se fija:
 *  - activar sin precio pactado sobre un plan público rebota (422) y no deja
 *    fila: la invariante de Premium manda;
 *  - activar con precio vuelve al negocio Premium y el cliente lo ve en su
 *    propia sesión (`GET /me` → `subscription.modules`);
 *  - desactivar apaga el módulo pero NO degrada el plan;
 *  - las dos palancas dejan rastro en el audit del negocio con su razón;
 *  - la puerta: un TenantAdmin normal recibe 403.
 *
 * El 402 de `@RequiresModule` sobre una ruta real se prueba en las e2e de
 * Recepción (F9-RECEP-14): hoy no existe ninguna ruta con el decorador.
 */
describe("Módulos por tenant (F9-MOD-10)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;

  const modulos = (tenantId: string) => `/admin/billing/tenants/${tenantId}/modules`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "modules-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "modules-negocio");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
  });

  afterAll(async () => {
    await app.close();
  });

  it("un TenantAdmin normal no llega: 403, no 402", async () => {
    await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(negocio.token))
      .send({ moduleKey: "reception", reason: "me lo activo yo" })
      .expect(403);
  });

  it("sin razón → 400; una clave fuera del catálogo → 400", async () => {
    await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception" })
      .expect(400);
    await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "foo", reason: "no existe" })
      .expect(400);
  });

  it("activar sin precio pactado sobre un Plus rebota con 422 y no deja fila", async () => {
    const res = await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", reason: "deal" })
      .expect(422);
    expect((res.body as { message: string }).message).toContain("precio pactado");

    const detalle = await request(app.getHttpServer())
      .get(`/admin/billing/tenants/${negocio.tenantId}`)
      .set("Authorization", bearer(admin.token))
      .expect(200);
    expect((detalle.body as { modules: string[] }).modules).toEqual([]);
    expect(
      (detalle.body as { subscription: { plan: { code: string } } }).subscription.plan.code,
    ).toBe("plus");
  });

  it("activar con precio pactado: el negocio pasa a Premium y lo ve en su propia sesión", async () => {
    const res = await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", customPrice: "1250.00", reason: "deal VIP" })
      .expect(201);
    expect(res.body).toEqual(["reception"]);

    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const suscripcion = (me.body as { subscription: { planCode: string; modules: string[] } })
      .subscription;
    expect(suscripcion.planCode).toBe("premium");
    expect(suscripcion.modules).toEqual(["reception"]);

    const detalle = await request(app.getHttpServer())
      .get(`/admin/billing/tenants/${negocio.tenantId}`)
      .set("Authorization", bearer(admin.token))
      .expect(200);
    const body = detalle.body as {
      modules: string[];
      subscription: { plan: { code: string }; customPrice: string };
    };
    expect(body.modules).toEqual(["reception"]);
    expect(body.subscription.plan.code).toBe("premium");
    expect(Number(body.subscription.customPrice)).toBe(1250);
  });

  it("activar otra vez es idempotente: sigue habiendo una sola fila", async () => {
    const res = await request(app.getHttpServer())
      .post(modulos(negocio.tenantId))
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "reception", reason: "otra vez" })
      .expect(201);
    expect(res.body).toEqual(["reception"]);
  });

  it("desactivar apaga el módulo, el plan sigue Premium y el audit guarda las dos acciones", async () => {
    const res = await request(app.getHttpServer())
      .delete(`${modulos(negocio.tenantId)}/reception`)
      .set("Authorization", bearer(admin.token))
      .send({ reason: "ya no lo usa" })
      .expect(200);
    expect(res.body).toEqual([]);

    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", bearer(negocio.token))
      .expect(200);
    const suscripcion = (me.body as { subscription: { planCode: string; modules: string[] } })
      .subscription;
    expect(suscripcion.planCode).toBe("premium");
    expect(suscripcion.modules).toEqual([]);

    const rastro = await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { action: { in: ["tenant_module.enabled", "tenant_module.disabled"] } },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(rastro.map((r) => r.action)).toEqual([
      "tenant_module.enabled",
      "tenant_module.disabled",
    ]);
    expect(rastro.map((r) => (r.after as { reason: string }).reason)).toEqual([
      "deal VIP",
      "ya no lo usa",
    ]);
    // El actor es el dueño de la plataforma, un usuario de OTRO tenant.
    expect(rastro[0]?.userId).toBe(admin.userId);
  });
});
