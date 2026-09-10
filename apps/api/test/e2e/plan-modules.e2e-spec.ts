import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { EntitlementsService } from "../../src/modules/billing/entitlements.service";
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
 * F9-PLANMOD-07 — el mecanismo de los módulos INCLUIDOS por plan, de punta a
 * punta: Gastos desde Basic, Compras desde Pro (`plan-modules.ts`).
 *
 * Lo que se fija:
 *  - un negocio recién registrado (trial Plus) ya trae Compras y Gastos;
 *  - bajarlo a Basic le quita Compras y le deja Gastos;
 *  - cancelado sobre Basic: el plan efectivo es free y no escribe, pero
 *    Gastos SIGUE en `modules` — los incluidos se resuelven con el plan
 *    CONTRATADO, para que el que se atrasa siga leyendo su historial;
 *  - Compras pactada como add-on sobre un Basic: aparece en `GET /me` y el
 *    plan sigue siendo Basic (no fuerza Premium: eso es solo para los
 *    módulos pactados, `minPlan: null`).
 */
describe("Módulos incluidos por plan (F9-PLANMOD-07)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;
  let negocio: TenantFixture;

  const suscripcionDe = async (token: string) => {
    const me = await request(app.getHttpServer())
      .get("/me")
      .set("Authorization", bearer(token))
      .expect(200);
    return (
      me.body as {
        subscription: { planCode: string; status: string; writeAccess: boolean; modules: string[] };
      }
    ).subscription;
  };

  const cambiarPlan = (planCode: string) =>
    request(app.getHttpServer())
      .patch(`/admin/billing/tenants/${negocio.tenantId}/subscription`)
      .set("Authorization", bearer(admin.token))
      .send({ planCode, reason: "e2e plan-modules" })
      .expect(200);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "planmod-admin");
    await makePlatformAdmin(app, prisma, admin);
    negocio = await registerTenant(app, "planmod-negocio");
    await setTenantMarket(prisma, negocio.tenantId, "MX");
  });

  afterAll(async () => {
    await app.close();
  });

  it("el trial Plus nace con Compras y Gastos, sin pactar nada", async () => {
    const suscripcion = await suscripcionDe(negocio.token);
    expect(suscripcion.planCode).toBe("plus");
    expect(suscripcion.modules).toEqual(["purchases", "expenses"]);
  });

  it("bajar a Basic quita Compras y deja Gastos", async () => {
    await cambiarPlan("basic");
    const suscripcion = await suscripcionDe(negocio.token);
    expect(suscripcion.planCode).toBe("basic");
    expect(suscripcion.modules).toEqual(["expenses"]);
  });

  /**
   * `POST /cancel` no degrada a nadie (deja `cancel_at_period_end` y el
   * barrido hace la transición al vencer), así que el estado se fuerza en la
   * fila —lo que el cron dejaría— y se limpia la caché de entitlements.
   */
  it("cancelado: el plan efectivo es free y no escribe, pero Gastos sigue en la lista", async () => {
    const fijarStatus = async (status: "canceled" | "trialing") => {
      // El CHECK `status_coherent` exige `canceled_at` con `canceled`; el
      // trial (que es donde nació el negocio) solo pide `trial_ends_at`.
      await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.update({
          where: { tenantId: negocio.tenantId },
          data: { status, canceledAt: status === "canceled" ? new Date() : null },
        }),
      );
      await app.get(EntitlementsService).invalidate(negocio.tenantId);
    };

    await fijarStatus("canceled");
    const suscripcion = await suscripcionDe(negocio.token);
    expect(suscripcion.status).toBe("canceled");
    expect(suscripcion.writeAccess).toBe(false);
    // El plan CONTRATADO sigue siendo Basic: el historial de gastos se lee.
    expect(suscripcion.modules).toEqual(["expenses"]);

    await fijarStatus("trialing");
  });

  it("Compras como add-on sobre un Basic: aparece en /me y el plan sigue Basic", async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/billing/tenants/${negocio.tenantId}/modules`)
      .set("Authorization", bearer(admin.token))
      .send({ moduleKey: "purchases", customPrice: "299.00", reason: "add-on Compras" })
      .expect(201);
    expect(res.body).toEqual(["purchases"]);

    const suscripcion = await suscripcionDe(negocio.token);
    expect(suscripcion.planCode).toBe("basic");
    expect(suscripcion.modules).toEqual(["purchases", "expenses"]);
  });
});
