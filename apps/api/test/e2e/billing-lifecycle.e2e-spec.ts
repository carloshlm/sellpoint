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
        amountReceived: "499.00",
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
        amountReceived: "499.00",
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
        amountReceived: "4990.00",
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
        amountReceived: "499.00",
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
        amountReceived: "45.00",
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
        amountReceived: "59.00",
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
        amountReceived: "199.00",
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
   * ── LA CUENTA TIENE QUE CUADRAR (Carlos, 2026-08-29) ───────────────────
   *
   * «El campo Monto Recibido debe ser obligatorio, y Monto Recibido más
   * Descuento debe ser siempre igual al monto que se debe pagar por el plan;
   * de otra manera no se puede registrar el pago.»
   *
   * Es la regla de un libro de caja: lo que entró más lo que perdonaste
   * tiene que dar el precio. Un cobro incompleto ya no se "fuerza" con una
   * casilla y una nota de texto — se registra como DESCUENTO explícito, que
   * es un dato con el que después se puede sumar, auditar y explicar.
   *
   * Efecto secundario feliz: con la cuenta cuadrada, `amount` (lo que la
   * base guarda) ES el monto recibido. El dato queda consistente por
   * construcción, sin una columna más que mantener sincronizada.
   */
  describe("monto recibido + descuento = precio del plan", () => {
    it("el monto exacto entra: 499 recibidos sobre un plan de 499", async () => {
      const negocio = await registerTenant(app, "lifecycle-exacto");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "499.00",
      }).expect(201);

      expect(pago.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "0",
        amount: "499",
      });
      expect((pago.body as { notes: string | null }).notes).toBeNull();
    });

    it("300 recibidos + 199 de descuento cuadran, y el descuento queda como DATO", async () => {
      const negocio = await registerTenant(app, "lifecycle-cuadra");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "300.00",
        discountAmount: "199.00",
      }).expect(201);

      expect(pago.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "199",
        amount: "300",
      });
      // El CHECK de la base lo exige y la regla lo garantiza: lo guardado ES
      // lo recibido.
      expect((await suscripcionDe(negocio.tenantId)).status).toBe("active");
    });

    it("300 recibidos SIN descuento se rechaza, y dice qué falta", async () => {
      const negocio = await registerTenant(app, "lifecycle-no-cuadra");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const rechazo = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "300.00",
      }).expect(422);

      expect(rechazo.body).toMatchObject({ code: "billing.amount_mismatch" });
      expect((rechazo.body as { message: string }).message).toContain("499");

      const pagos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.subscriptionPayment.count(),
      );
      expect(pagos).toBe(0);
    });

    /** Pagar de MÁS tampoco cuadra: sobrar es tan raro como faltar. */
    it("600 recibidos sobre un plan de 499 se rechaza", async () => {
      const negocio = await registerTenant(app, "lifecycle-demas");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "600.00",
      }).expect(422);
    });

    it("sin `amountReceived` no se registra nada: capturar el monto es obligatorio", async () => {
      const negocio = await registerTenant(app, "lifecycle-sin-monto");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
      }).expect(400);
    });

    /**
     * El cupón vigente ya rebajó el precio ANTES de que nadie capture nada:
     * lo que se espera recibir es el precio con el cupón aplicado, y el
     * descuento del formulario se suma encima.
     */
    it("con un cupón de −200 vigente, lo que debe entrar son 299", async () => {
      const negocio = await registerTenant(app, "lifecycle-cupon");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/discounts`)
        .set("Authorization", bearer(admin.token))
        .send({
          kind: "fixed_amount",
          amount: "200",
          startsAt: new Date().toISOString(),
          reason: "promoción",
        })
        .expect(201);

      // 499 con el cupón aplicado: entran 299 y no hace falta descuento extra.
      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "299.00",
      }).expect(201);

      expect(pago.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "200",
        amount: "299",
      });
    });

    it("el descuento del formulario se SUMA al del cupón", async () => {
      const negocio = await registerTenant(app, "lifecycle-cupon-mas");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      await request(app.getHttpServer())
        .post(`/admin/billing/tenants/${negocio.tenantId}/discounts`)
        .set("Authorization", bearer(admin.token))
        .send({
          kind: "fixed_amount",
          amount: "200",
          startsAt: new Date().toISOString(),
          reason: "promoción",
        })
        .expect(201);

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "250.00",
        discountAmount: "49.00",
      }).expect(201);

      expect(pago.body).toMatchObject({
        grossAmount: "499",
        discountAmount: "249",
        amount: "250",
      });
    });

    /** Una cortesía cobra 0: recibir 0 con el cupón `free` cuadra perfecto. */
    it("un cupón que regala el período acepta 0 recibidos", async () => {
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

    /** Un descuento del 100% en el formulario: el mes va de regalo, dicho. */
    it("descuento por el total y 0 recibidos: la cortesía sin cupón", async () => {
      const negocio = await registerTenant(app, "lifecycle-regalo");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const pago = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "courtesy",
        paidAt: new Date().toISOString(),
        amountReceived: "0",
        discountAmount: "499.00",
      }).expect(201);

      expect(pago.body).toMatchObject({ amount: "0", discountAmount: "499" });
    });

    it("un descuento mayor que el precio se rechaza: no existe cobrar en negativo", async () => {
      const negocio = await registerTenant(app, "lifecycle-negativo");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date().toISOString(),
        amountReceived: "0",
        discountAmount: "600.00",
      }).expect(422);
    });
  });

  describe("la fecha del pago no puede ser futura", () => {
    it("registrar un pago con fecha de mañana se rechaza", async () => {
      const negocio = await registerTenant(app, "lifecycle-futuro");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      const rechazo = await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date(Date.now() + 86_400_000).toISOString(),
        amountReceived: "499.00",
      }).expect(422);

      expect(rechazo.body).toMatchObject({ code: "billing.paid_at_in_future" });
      const pagos = await prisma.withTenantContext(negocio.tenantId, (tx) =>
        tx.subscriptionPayment.count(),
      );
      expect(pagos).toBe(0);
    });

    /**
     * El día del NEGOCIO, no el instante: capturar "hoy" desde el formulario
     * manda las 12:00 locales, que en UTC pueden ser mañana. Rechazar eso
     * sería rechazar la operación más común del backoffice.
     */
    it("hoy en el calendario del negocio SIEMPRE pasa, aunque en UTC ya sea mañana", async () => {
      const negocio = await registerTenant(app, "lifecycle-hoy");
      await setTenantMarket(prisma, negocio.tenantId, "MX");
      const hoyLocal = localCalendarDate(TZ, new Date());

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        // 23:30 locales de CDMX ya son el día siguiente en UTC.
        paidAt: `${hoyLocal}T05:29:00.000Z`,
        amountReceived: "499.00",
      }).expect(201);
    });

    it("una fecha pasada sigue entrando: capturar tarde es normal", async () => {
      const negocio = await registerTenant(app, "lifecycle-pasado");
      await setTenantMarket(prisma, negocio.tenantId, "MX");

      await registrarPago(negocio.tenantId, {
        billingCycle: "monthly",
        method: "transfer",
        paidAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        amountReceived: "499.00",
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
        amountReceived: "499.00",
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
