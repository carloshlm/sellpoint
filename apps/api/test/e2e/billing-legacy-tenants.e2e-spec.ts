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
 * Los negocios ANTERIORES a la Fase 7 — los que no tienen fila en
 * `tenant_subscriptions` porque nacieron antes de que existiera la tabla.
 *
 * ── El reporte de Carlos (2026-08-29) ───────────────────────────────────
 *
 * «En el backoffice de cobros sólo me aparecen los nuevos registros y no los
 * anteriores.» En producción eran 8 de 10 negocios invisibles: la lista se
 * construía desde `tenant_subscriptions`, así que quien no tenía fila no
 * existía para el cobro.
 *
 * **Es el error más caro posible en un backoffice de cobros**: el negocio al
 * que hay que cobrarle es, justamente, el que todavía no tiene suscripción.
 * La lista tiene que partir de los NEGOCIOS y colgarles su suscripción si la
 * tienen — no al revés.
 *
 * Y como la acción que sigue a verlos es cobrarles, registrar un pago sobre
 * un negocio sin suscripción la CREA: es el alta que necesitan.
 */
describe("Negocios anteriores a la Fase 7 (sin suscripción)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: TenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useClass(NoopMailer)
      .compile();
    app = moduleFixture.createNestApplication();
    await startTestApp(app);
    prisma = app.get(PrismaService);

    admin = await registerTenant(app, "legacy-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Un negocio como los que ya viven en producción: sin fila de suscripción. */
  async function negocioSinSuscripcion(country: "MX" | "US" | "CA" = "MX") {
    const negocio = await registerTenant(app, "legacy");
    await setTenantMarket(prisma, negocio.tenantId, country);
    await prisma.withTenantContext(negocio.tenantId, (tx) =>
      tx.tenantSubscription.deleteMany({ where: { tenantId: negocio.tenantId } }),
    );
    // El registro ya dejó su trial cacheado en Redis (TTL 300 s). Los
    // negocios viejos de producción NUNCA tuvieron fila, así que hay que
    // tirar ese caché para que el escenario sea el de verdad y no el de un
    // borrado a mano por debajo del sistema.
    await app.get(EntitlementsService).invalidate(negocio.tenantId);
    return negocio;
  }

  const res_tenants = (res: { body: unknown }) => (res.body as { tenants: unknown[] }).tenants;

  const listar = () =>
    request(app.getHttpServer())
      .get("/admin/billing/tenants")
      .set("Authorization", bearer(admin.token));

  const pagar = (tenantId: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send({
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "499.00",
        ...body,
      });

  describe("aparecen en el backoffice", () => {
    it("un negocio SIN suscripción sale en la lista, marcado como tal", async () => {
      const negocio = await negocioSinSuscripcion();

      const res = await listar().expect(200);
      const fila = (
        res.body as { tenants: { tenantId: string; status: string; planCode: string }[] }
      ).tenants.find((f) => f.tenantId === negocio.tenantId);

      expect(fila).toBeDefined();
      // `none` y no `free`: son cosas distintas y el dueño necesita
      // distinguirlas — uno cayó al modo gratuito, el otro nunca tuvo nada.
      expect(fila?.status).toBe("none");
      // Su plan EFECTIVO es free: es lo que el sistema le está aplicando hoy.
      expect(fila?.planCode).toBe("free");
    });

    it("los que sí tienen suscripción siguen saliendo con su plan y su vencimiento", async () => {
      const negocio = await registerTenant(app, "legacy-activo");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      await pagar(negocio.tenantId).expect(201);

      const res = await listar().expect(200);
      const fila = (
        res.body as {
          tenants: { tenantId: string; status: string; planCode: string; dueAt: string | null }[];
        }
      ).tenants.find((f) => f.tenantId === negocio.tenantId);

      expect(fila).toMatchObject({ status: "active", planCode: "plus" });
      expect(fila?.dueAt).not.toBeNull();
    });

    it("el MRR no cambia: un negocio sin suscripción no aporta ingreso", async () => {
      const antes = (await listar().expect(200)).body as { mrrByCurrency: Record<string, string> };
      await negocioSinSuscripcion();
      const despues = (await listar().expect(200)).body as {
        mrrByCurrency: Record<string, string>;
      };

      expect(despues.mrrByCurrency.MXN ?? "0").toBe(antes.mrrByCurrency.MXN ?? "0");
    });
  });

  describe("su expediente se puede abrir", () => {
    /**
     * La consecuencia de mostrarlos en la tabla: el dueño va a hacerles
     * clic. Un 404 ahí sería mandarlo contra una pared en el lugar donde
     * justo tiene que decidir qué cobrar.
     */
    it("el detalle de un negocio sin suscripción responde 200, no 404", async () => {
      const negocio = await negocioSinSuscripcion();

      const res = await request(app.getHttpServer())
        .get(`/admin/billing/tenants/${negocio.tenantId}`)
        .set("Authorization", bearer(admin.token))
        .expect(200);

      expect(res.body).toMatchObject({
        subscription: { status: "none", plan: { code: "free" } },
        payments: [],
        activeDiscount: null,
      });
    });

    /** Y su propio dueño puede ver "Mi plan" sin que la pantalla reviente. */
    it("el negocio ve su propio billing en modo gratuito", async () => {
      const negocio = await negocioSinSuscripcion();

      const res = await request(app.getHttpServer())
        .get("/billing/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect(res.body).toMatchObject({ subscription: { status: "none" } });
    });

    /**
     * La zona del negocio viaja con su fila: el backoffice pinta la fecha de
     * cobro de CADA negocio en la zona de ESE negocio, no en la de quien
     * mira la tabla. Un vencimiento es un hecho del negocio.
     */
    it("la lista y el detalle traen la zona horaria del negocio", async () => {
      const negocio = await negocioSinSuscripcion();

      const lista = await listar().expect(200);
      const fila = (res_tenants(lista) as { tenantId: string; timezone: string }[]).find(
        (f) => f.tenantId === negocio.tenantId,
      );
      expect(fila?.timezone).toBe("America/Mexico_City");

      const detalle = await request(app.getHttpServer())
        .get(`/admin/billing/tenants/${negocio.tenantId}`)
        .set("Authorization", bearer(admin.token))
        .expect(200);
      expect((detalle.body as { timezone: string }).timezone).toBe("America/Mexico_City");
    });

    it("el historial trae el período que cubrió cada pago", async () => {
      const negocio = await negocioSinSuscripcion();
      await pagar(negocio.tenantId, { planCode: "plus", amountReceived: "499.00" }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/admin/billing/tenants/${negocio.tenantId}`)
        .set("Authorization", bearer(admin.token))
        .expect(200);

      const [pago] = (res.body as { payments: Record<string, unknown>[] }).payments;
      expect(pago).toMatchObject({ planCode: "plus", status: "recorded" });
      expect(pago?.periodStart).toEqual(expect.any(String));
      expect(pago?.periodEnd).toEqual(expect.any(String));
    });
  });

  describe("registrarles un pago los da de alta", () => {
    it("el pago crea la suscripción que no existía y la deja activa", async () => {
      const negocio = await negocioSinSuscripcion();

      const pago = await pagar(negocio.tenantId, {
        planCode: "pro",
        amountReceived: "349.00",
      }).expect(201);

      expect(pago.body).toMatchObject({ planCode: "pro", amount: "349", currency: "MXN" });
      const sub = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.tenantSubscription.findUniqueOrThrow({
          where: { tenantId: negocio.tenantId },
          include: { plan: true },
        }),
      );
      expect(sub.status).toBe("active");
      expect(sub.plan.code).toBe("pro");
      expect(sub.dueAt).not.toBeNull();
      // Nace sin trial: ya pagó, no está probando nada.
      expect(sub.trialEndsAt).toBeNull();
    });

    /**
     * Sin suscripción previa no hay plan del que heredar: exigir el plan es
     * la única forma de no adivinar qué contrató el cliente.
     */
    it("sin `planCode` y sin suscripción previa, 422 con el motivo dicho", async () => {
      const negocio = await negocioSinSuscripcion();

      const rechazo = await pagar(negocio.tenantId).expect(422);

      expect(rechazo.body).toMatchObject({ code: "billing.plan_required" });
    });

    it("el alta respeta el mercado: un negocio canadiense paga en CAD", async () => {
      const negocio = await negocioSinSuscripcion("CA");

      const pago = await pagar(negocio.tenantId, {
        planCode: "basic",
        amountReceived: "19.00",
      }).expect(201);

      expect(pago.body).toMatchObject({ currency: "CAD", amount: "19" });
    });

    it("y a partir de ahí el negocio escribe de nuevo", async () => {
      const negocio = await negocioSinSuscripcion();
      // Antes del pago está en modo gratuito (fail-closed del resolver).
      await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(negocio.token))
        .send({ sku: "LEG-1", name: "Antes", baseUnit: "unit", price: 10 })
        .expect(402);

      await pagar(negocio.tenantId, { planCode: "plus", amountReceived: "499.00" }).expect(201);

      await request(app.getHttpServer())
        .post("/products")
        .set("Authorization", bearer(negocio.token))
        .send({ sku: "LEG-2", name: "Después", baseUnit: "unit", price: 10 })
        .expect(201);
    });
  });
});
