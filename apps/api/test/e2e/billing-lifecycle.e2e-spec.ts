import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { localCalendarDate } from "@sellpoint/shared";
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

const TZ = "America/Mexico_City";

/**
 * F7-E2E-01 — el ciclo de vida completo: registro → trial → pago → active →
 * renovación.
 *
 * ── Lo que este archivo protege ─────────────────────────────────────────
 *
 * **El ancla de cobro.** El día del PRIMER pago se fija en `anchor_day` y no
 * se recalcula nunca. Un cliente que paga el 31 de enero vence el 28 de
 * febrero (el mes corto no tiene 31) y **vuelve al 31** en marzo. Si el ancla
 * se recalculara desde el último vencimiento, ese cliente se quedaría en el
 * 28 para siempre y le regalaríamos tres días cada mes del resto de su vida.
 * Esa es la razón entera de que `anchor_day` sea una columna y no una
 * derivación de `due_at`.
 *
 * **El mercado.** El precio sale de la fila del PAÍS del negocio, no de un
 * tipo de cambio: México $499 MXN y Estados Unidos $45 USD son dos precios
 * decididos, no el mismo precio convertido. El pago guarda su SNAPSHOT
 * (monto y moneda), así que un cambio de tarifa mañana no reescribe la
 * historia de ayer.
 */
describe("Ciclo de vida de la suscripción (F7-E2E-01)", () => {
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

    admin = await registerTenant(app, "lifecycle-admin");
    await makePlatformAdmin(app, prisma, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * La fecha LEGIBLE de un vencimiento. El instante guardado es límite
   * ABIERTO —el arranque del día siguiente al último día hábil—, así que el
   * día que el cliente lee en su recibo es el del milisegundo anterior.
   */
  const fechaDe = (instante: Date): string =>
    localCalendarDate(TZ, new Date(instante.getTime() - 1));

  const registrarPago = (tenantId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/admin/billing/tenants/${tenantId}/payments`)
      .set("Authorization", bearer(admin.token))
      .send(body);

  const suscripcionDe = (tenantId: string) =>
    prisma.withTenantContext(tenantId, (tx) =>
      tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
    );

  describe("el trial nace con el negocio", () => {
    it("un registro nuevo entra en trial Plus de 14 días, sin tarjeta", async () => {
      const negocio = await registerTenant(app, "lifecycle-trial");

      const me = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);

      expect((me.body as { subscription: Record<string, unknown> }).subscription).toMatchObject({
        planCode: "plus",
        status: "trialing",
        writeAccess: true,
        stockControl: true,
        // El día 14 completo sigue siendo hábil: 13 días "restantes" el mismo
        // día del alta sería redondear en contra del cliente.
        daysLeft: 14,
      });

      const sub = await suscripcionDe(negocio.tenantId);
      // Todavía no hay nada que cobrar: ni ancla, ni ciclo, ni vencimiento.
      expect(sub.anchorDay).toBeNull();
      expect(sub.dueAt).toBeNull();
      expect(sub.billingCycle).toBeNull();
    });
  });

  describe("el ancla del 31 (el caso que justifica la columna)", () => {
    it("paga el 31-ene: vence el 28-feb, y la renovación vuelve al 31-mar", async () => {
      const negocio = await registerTenant(app, "lifecycle-anchor");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      // Mediodía local para que el día no dependa del huso al convertir.
      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-01-31T18:00:00.000Z",
      }).expect(201);

      const primera = await suscripcionDe(negocio.tenantId);
      expect(primera.status).toBe("active");
      expect(primera.anchorDay).toBe(31);
      expect(fechaDe(primera.dueAt as Date)).toBe("2026-02-28");

      // La renovación: el período encadena con el vencimiento anterior (no se
      // regalan días) y el ancla RECUPERA el 31 que febrero no podía dar.
      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-02-27T18:00:00.000Z",
      }).expect(201);

      const segunda = await suscripcionDe(negocio.tenantId);
      expect(segunda.anchorDay).toBe(31);
      expect(fechaDe(segunda.dueAt as Date)).toBe("2026-03-31");
      // El servicio arranca donde terminó el anterior: sin huecos ni solapes.
      expect(segunda.servicePeriodStart?.toISOString()).toBe(primera.dueAt?.toISOString());
    });

    it("el anual cobra 10 mensualidades y vence el mismo día del año siguiente", async () => {
      const negocio = await registerTenant(app, "lifecycle-yearly");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "yearly",
        method: "transfer",
        paidAt: "2026-03-15T18:00:00.000Z",
      }).expect(201);

      // Dos meses gratis: $499 × 10, no × 12.
      expect((pago.body as { amount: string }).amount).toBe("4990");
      const sub = await suscripcionDe(negocio.tenantId);
      expect(fechaDe(sub.dueAt as Date)).toBe("2027-03-15");
      expect(sub.billingCycle).toBe("yearly");
    });
  });

  describe("el precio es del MERCADO, no del tipo de cambio", () => {
    it("un negocio en México paga 499 MXN por Plus", async () => {
      const negocio = await registerTenant(app, "lifecycle-mx");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-05-10T18:00:00.000Z",
      }).expect(201);

      expect(pago.body).toMatchObject({ amount: "499", currency: "MXN", planCode: "plus" });
    });

    it("el MISMO flujo con un negocio en Estados Unidos cobra y registra USD", async () => {
      const negocio = await registerTenant(app, "lifecycle-us");
      await setTenantMarket(prisma, negocio.tenantId, "US");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-05-10T18:00:00.000Z",
      }).expect(201);

      expect(pago.body).toMatchObject({ amount: "45", currency: "USD", planCode: "plus" });

      // El snapshot vive en el PAGO: la suscripción no guarda precio.
      const detalle = await request(app.getHttpServer())
        .get(`/admin/billing/tenants/${negocio.tenantId}`)
        .set("Authorization", bearer(admin.token))
        .expect(200);
      expect((detalle.body as { payments: { currency: string }[] }).payments[0]?.currency).toBe(
        "USD",
      );
    });

    it("Canadá tiene su propia tarifa: 59 CAD", async () => {
      const negocio = await registerTenant(app, "lifecycle-ca");
      await setTenantMarket(prisma, negocio.tenantId, "CA");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-05-10T18:00:00.000Z",
      }).expect(201);

      expect(pago.body).toMatchObject({ amount: "59", currency: "CAD" });
    });
  });

  describe("el pago cambia de plan en el mismo acto", () => {
    /**
     * El caso típico del negocio: el trial es Plus para que prueben todo, y
     * al final el cliente contrata Basic. Registrar el pago con `planCode`
     * hace las dos cosas a la vez — cobrar y mover el plan— porque son UN
     * solo hecho comercial.
     */
    it("el trial Plus que contrata Basic paga 199 y queda en Basic", async () => {
      const negocio = await registerTenant(app, "lifecycle-downgrade");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: "2026-06-05T18:00:00.000Z",
        planCode: "basic",
      }).expect(201);

      expect(pago.body).toMatchObject({ amount: "199", planCode: "basic" });
      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.plan.code).toBe("basic");
      expect(sub.status).toBe("active");

      // Y el plan efectivo que ve el front cambió con él.
      const me = await request(app.getHttpServer())
        .get("/me")
        .set("Authorization", bearer(negocio.token))
        .expect(200);
      expect((me.body as { subscription: { planCode: string } }).subscription.planCode).toBe(
        "basic",
      );
    });
  });

  /**
   * ── EL PAGO QUE NO CUBRE (Carlos, 2026-08-29) ──────────────────────────
   *
   * «Al registrar un pago por cualquier cantidad, por ejemplo 100 pesos, se
   * activa el plan aunque el costo sea 499.» Tenía razón en que era un
   * riesgo: el monto recibido solo iba a las notas y el período se otorgaba
   * completo igual, así que un error de dedo regalaba un mes.
   *
   * La decisión (Carlos, opción A): **rechazar por defecto y permitir
   * forzar**. El sistema no puede decidir solo que un cobro incompleto está
   * bien —a veces lo está, y por eso existe `allowPartial`—, pero tampoco
   * puede dejar que un tecleo se convierta en un mes regalado en silencio.
   * Forzarlo es un acto explícito y queda escrito en el pago.
   */
  describe("un pago que no cubre el período", () => {
    it("registrar 100 sobre un plan de 499 se RECHAZA, y dice cuánto falta", async () => {
      const negocio = await registerTenant(app, "lifecycle-parcial");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const rechazo = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "100",
      }).expect(422);

      expect(rechazo.body).toMatchObject({ code: "billing.amount_below_charge" });
      expect((rechazo.body as { message: string }).message).toContain("499");

      // Y NADA se movió: sigue en su trial, sin pago fantasma.
      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("trialing");
      const pagos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.subscriptionPayment.count(),
      );
      expect(pagos).toBe(0);
    });

    it("con `allowPartial` sí entra, y el faltante queda escrito en el pago", async () => {
      const negocio = await registerTenant(app, "lifecycle-parcial-ok");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "100",
        allowPartial: true,
      }).expect(201);

      expect((pago.body as { notes: string }).notes).toContain("100");
      expect((await suscripcionDe(negocio.tenantId)).status).toBe("active");
    });

    it("pagar de MÁS no se rechaza: quien transfirió de sobra no queda bloqueado", async () => {
      const negocio = await registerTenant(app, "lifecycle-demas");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "600",
      }).expect(201);

      expect((pago.body as { notes: string }).notes).toContain("600");
    });

    it("el monto exacto pasa sin ruido y sin nota", async () => {
      const negocio = await registerTenant(app, "lifecycle-exacto");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "499.00",
      }).expect(201);

      expect((pago.body as { notes: string | null }).notes).toBeNull();
    });

    /** Una cortesía cobra 0: exigirle que "cubra" sería un absurdo. */
    it("un cupón que deja el cargo en 0 acepta un `amountReceived` de 0", async () => {
      const negocio = await registerTenant(app, "lifecycle-cortesia");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/discounts`)
        .set("Authorization", bearer(admin.token))
        .send({ kind: "free", startsAt: new Date().toISOString(), reason: "cortesía" })
        .expect(201);

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "courtesy",
        paidAt: new Date().toISOString(),
        amountReceived: "0",
      }).expect(201);
    });
  });

  describe("anular un pago corrige la historia", () => {
    /**
     * Un pago no se borra. Se anula con razón, y el estado presente se
     * RECALCULA desde los pagos vivos: un pago capturado por error deja al
     * cliente donde estaba, no en un limbo.
     */
    it("anular el único pago devuelve la suscripción a su trial vigente", async () => {
      const negocio = await registerTenant(app, "lifecycle-void");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
      }).expect(201);
      const pagoId = (pago.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/payments/${pagoId}/void`)
        .set("Authorization", bearer(admin.token))
        .send({ reason: "transferencia rebotada" })
        .expect(201);

      const sub = await suscripcionDe(negocio.tenantId);
      expect(sub.status).toBe("trialing");
      expect(sub.dueAt).toBeNull();

      // El pago SIGUE ahí, anulado y con su porqué.
      const detalle = await request(app.getHttpServer())
        .get(`/admin/billing/tenants/${negocio.tenantId}`)
        .set("Authorization", bearer(admin.token))
        .expect(200);
      expect((detalle.body as { payments: { status: string }[] }).payments).toHaveLength(1);
      expect((detalle.body as { payments: { status: string }[] }).payments[0]?.status).toBe(
        "voided",
      );
    });
  });
});
