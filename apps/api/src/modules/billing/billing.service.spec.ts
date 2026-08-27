import { BillingService } from "./billing.service";

/**
 * F7-CORE-04/05/06 — el motor de cobro manual.
 *
 * Los tests fijan las reglas de negocio que costaron discusión:
 *  - el ancla se fija con el PRIMER pago y el vencimiento avanza desde la
 *    FECHA del vencimiento anterior (31-ene → 28-feb → 31-mar);
 *  - un pago tardío NO regala días (periodStart = fin del período anterior);
 *  - free → active RE-ANCLA al día del pago (los meses muertos no se cobran);
 *  - el monto registrado es el CALCULADO — si el cliente pagó otra cosa, la
 *    diferencia queda en notas, jamás en el período;
 *  - cancelar con período vivo NO degrada: cancel_at_period_end y el status
 *    queda intacto (la regla de oro: solo el cron degrada, y promover es
 *    siempre un pago);
 *  - un pago no se borra: se anula con razón y el período se recalcula desde
 *    los pagos vivos.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";

const PLAN_PLUS = { id: "plan-plus", code: "plus", name: "Plus" };
const PLAN_BASIC = { id: "plan-basic", code: "basic", name: "Basic" };
const PLAN_PREMIUM = { id: "plan-premium", code: "premium", name: "Premium" };

const PRICE_PLUS_MX = {
  planId: "plan-plus",
  country: "MX",
  currency: "MXN",
  priceMonthly: "499.00",
  priceYearly: "4990.00",
};
const PRICE_PLUS_US = {
  planId: "plan-plus",
  country: "US",
  currency: "USD",
  priceMonthly: "45.00",
  priceYearly: "450.00",
};

type Mock = jest.Mock;

describe("BillingService (F7-CORE-04/05/06)", () => {
  let tx: {
    tenant: { findUniqueOrThrow: Mock };
    tenantSubscription: { findUnique: Mock; update: Mock };
    plan: { findUniqueOrThrow: Mock };
    planPrice: { findUnique: Mock };
    subscriptionPayment: { create: Mock; findUniqueOrThrow: Mock; findMany: Mock; update: Mock };
    tenantDiscount: { findFirst: Mock; create: Mock; update: Mock };
    user: { findFirst: Mock };
  };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let entitlements: { invalidate: Mock };
  let mailer: { send: Mock };
  let service: BillingService;

  const tenantRow = (extra: Record<string, unknown> = {}) => ({
    id: TENANT,
    name: "Acme",
    country: "MX",
    timezone: "America/Mexico_City",
    currency: "MXN",
    ...extra,
  });

  const subRow = (extra: Record<string, unknown> = {}) => ({
    id: "sub-1",
    tenantId: TENANT,
    planId: "plan-plus",
    status: "trialing",
    billingCycle: null,
    anchorDay: null,
    trialEndsAt: new Date("2026-09-11T06:00:00.000Z"),
    servicePeriodStart: null,
    servicePeriodEnd: null,
    dueAt: null,
    graceEndsAt: null,
    customPrice: null,
    canceledAt: null,
    cancelAtPeriodEnd: false,
    plan: PLAN_PLUS,
    ...extra,
  });

  beforeEach(() => {
    tx = {
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue(tenantRow()) },
      tenantSubscription: {
        findUnique: jest.fn().mockResolvedValue(subRow()),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...subRow(), ...data })),
      },
      plan: {
        findUniqueOrThrow: jest.fn().mockImplementation(({ where }) => {
          const planes = { plus: PLAN_PLUS, basic: PLAN_BASIC, premium: PLAN_PREMIUM };
          return Promise.resolve(planes[where.code as keyof typeof planes] ?? PLAN_PLUS);
        }),
      },
      planPrice: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const { planId, country } = where.planId_country;
          if (planId === "plan-plus" && country === "MX") return Promise.resolve(PRICE_PLUS_MX);
          if (planId === "plan-plus" && country === "US") return Promise.resolve(PRICE_PLUS_US);
          if (planId === "plan-basic" && country === "MX")
            return Promise.resolve({
              planId,
              country,
              currency: "MXN",
              priceMonthly: "199.00",
              priceYearly: "1990.00",
            });
          return Promise.resolve(null);
        }),
      },
      subscriptionPayment: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "pay-1", ...data })),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "pay-1", ...data })),
      },
      tenantDiscount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "disc-1", ...data })),
        update: jest.fn().mockResolvedValue({ id: "disc-1", isActive: false }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          email: "owner@acme.test",
          firstName: "Ana",
          locale: "es",
        }),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    entitlements = { invalidate: jest.fn().mockResolvedValue(undefined) };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new BillingService(prisma as any, audit as any, entitlements as any, mailer as any);
  });

  describe("recordPayment (F7-CORE-04)", () => {
    const pagoBase = {
      tenantId: TENANT,
      billingCycle: "monthly" as const,
      method: "transfer" as const,
      paidAt: new Date("2026-08-05T18:00:00.000Z"), // 5-ago local CDMX
    };

    it("trial→active: fija el ancla al día LOCAL del pago y el vencimiento un mes después", async () => {
      await service.recordPayment(pagoBase);

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.status).toBe("active");
      expect(update.billingCycle).toBe("monthly");
      expect(update.anchorDay).toBe(5);
      // Vence el 5-sep: el instante es el arranque del 6-sep local (límite abierto).
      expect(update.dueAt.toISOString()).toBe("2026-09-06T06:00:00.000Z");
      expect(update.servicePeriodStart).toEqual(pagoBase.paidAt);
      expect(update.servicePeriodEnd).toEqual(update.dueAt);
      expect(update.graceEndsAt).toBeNull();
    });

    it("el snapshot del pago guarda plan, ciclo, moneda y montos CALCULADOS", async () => {
      await service.recordPayment(pagoBase);

      expect(tx.subscriptionPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          planId: "plan-plus",
          planCode: "plus",
          billingCycle: "monthly",
          grossAmount: "499.00",
          discountAmount: "0.00",
          amount: "499.00",
          currency: "MXN",
          method: "transfer",
        }),
      });
    });

    it("audita, invalida el caché y encola el correo payment-received tras el commit", async () => {
      await service.recordPayment(pagoBase);

      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "billing.payment_recorded" }),
      );
      expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "owner@acme.test", template: "payment-received" }),
      );
    });

    it("planCode en el pago cambia el plan en el mismo acto (fin de trial Plus → paga Basic)", async () => {
      await service.recordPayment({ ...pagoBase, planCode: "basic" });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.planId).toBe("plan-basic");
      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.planCode).toBe("basic");
      expect(pago.grossAmount).toBe("199.00");
    });

    it("pago tardío en gracia NO regala días: el período arranca donde terminó el anterior", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "past_due",
          billingCycle: "monthly",
          anchorDay: 31,
          // Venció el 28-feb (instante = arranque del 1-mar local).
          servicePeriodStart: new Date("2026-02-01T06:00:00.000Z"),
          servicePeriodEnd: new Date("2026-03-01T06:00:00.000Z"),
          dueAt: new Date("2026-03-01T06:00:00.000Z"),
          graceEndsAt: new Date("2026-03-11T06:00:00.000Z"),
        }),
      );

      await service.recordPayment({ ...pagoBase, paidAt: new Date("2026-03-05T18:00:00.000Z") });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      // Arranca donde terminó el anterior, no el día del pago.
      expect(update.servicePeriodStart).toEqual(new Date("2026-03-01T06:00:00.000Z"));
      // Y el ancla 31 VUELVE: vence el 31-mar (instante = arranque del 1-abr).
      expect(update.dueAt.toISOString()).toBe("2026-04-01T06:00:00.000Z");
      expect(update.anchorDay).toBe(31);
      expect(update.graceEndsAt).toBeNull();
    });

    it("free→active RE-ANCLA: el período arranca el día del pago, no en el pasado muerto", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "free",
          billingCycle: "monthly",
          anchorDay: 31,
          servicePeriodEnd: new Date("2026-03-01T06:00:00.000Z"), // venció hace meses
        }),
      );

      await service.recordPayment({ ...pagoBase, paidAt: new Date("2026-08-05T18:00:00.000Z") });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.servicePeriodStart).toEqual(new Date("2026-08-05T18:00:00.000Z"));
      expect(update.anchorDay).toBe(5); // re-anclado al día del pago
      expect(update.dueAt.toISOString()).toBe("2026-09-06T06:00:00.000Z");
    });

    it("el cupón vigente descuenta y consume un período", async () => {
      tx.tenantDiscount.findFirst.mockResolvedValue({
        id: "disc-1",
        kind: "fixed_amount",
        amount: "200.00",
        maxPeriods: 12,
        appliedPeriods: 3,
      });

      await service.recordPayment(pagoBase);

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.discountAmount).toBe("200.00");
      expect(pago.amount).toBe("299.00");
      expect(pago.discountId).toBe("disc-1");
      expect(tx.tenantDiscount.update).toHaveBeenCalledWith({
        where: { id: "disc-1" },
        data: { appliedPeriods: { increment: 1 } },
      });
    });

    it("un cupón agotado (appliedPeriods == maxPeriods) ya no aplica: el pago 13 cobra completo", async () => {
      tx.tenantDiscount.findFirst.mockResolvedValue({
        id: "disc-1",
        kind: "fixed_amount",
        amount: "200.00",
        maxPeriods: 12,
        appliedPeriods: 12,
      });

      await service.recordPayment(pagoBase);

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.discountAmount).toBe("0.00");
      expect(pago.amount).toBe("499.00");
      expect(tx.tenantDiscount.update).not.toHaveBeenCalled();
    });

    it("el precio sale del MERCADO del tenant: country US cobra USD", async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue(tenantRow({ country: "US" }));

      await service.recordPayment(pagoBase);

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("45.00");
      expect(pago.currency).toBe("USD");
    });

    it("un país sin precio propio cae a la tarifa US (default internacional)", async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue(tenantRow({ country: "CO" }));

      await service.recordPayment(pagoBase);

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("45.00");
      expect(pago.currency).toBe("USD");
    });

    it("Premium sin custom_price es un estado inválido: 422", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ planId: "plan-premium", plan: PLAN_PREMIUM, customPrice: null }),
      );
      tx.planPrice.findUnique.mockResolvedValue(null);

      await expect(service.recordPayment(pagoBase)).rejects.toMatchObject({ status: 422 });
    });

    it("Premium con custom_price cobra el precio pactado", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ planId: "plan-premium", plan: PLAN_PREMIUM, customPrice: "1250.00" }),
      );
      tx.planPrice.findUnique.mockResolvedValue(null);

      await service.recordPayment(pagoBase);

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("1250.00");
      expect(pago.amount).toBe("1250.00");
    });

    it("si el monto recibido difiere del calculado, la diferencia va a NOTAS y el período no se toca", async () => {
      await service.recordPayment({ ...pagoBase, amountReceived: "2000.00" });

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.amount).toBe("499.00"); // el calculado manda
      expect(pago.notes).toContain("2000.00");
    });

    it("un pago sobre una suscripción cancelada rebota: primero se reactiva", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "canceled", canceledAt: new Date() }),
      );

      await expect(service.recordPayment(pagoBase)).rejects.toMatchObject({ status: 422 });
      expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
    });
  });

  describe("voidPayment (F7-CORE-05)", () => {
    it("anula con razón y recalcula el período desde los pagos VIVOS", async () => {
      tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
        id: "pay-2",
        tenantId: TENANT,
        subscriptionId: "sub-1",
        status: "recorded",
        periodEnd: new Date("2026-10-06T06:00:00.000Z"),
      });
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "active", billingCycle: "monthly", anchorDay: 5, trialEndsAt: null }),
      );
      // Queda UN pago vivo cuyo período sigue vigente.
      tx.subscriptionPayment.findMany.mockResolvedValue([
        {
          id: "pay-1",
          periodStart: new Date("2026-08-05T18:00:00.000Z"),
          periodEnd: new Date("2099-09-06T06:00:00.000Z"),
        },
      ]);

      await service.voidPayment(TENANT, "pay-2", {
        reason: "capturado dos veces",
        voidedBy: "user-1",
      });

      expect(tx.subscriptionPayment.update).toHaveBeenCalledWith({
        where: { id: "pay-2" },
        data: expect.objectContaining({
          status: "voided",
          voidReason: "capturado dos veces",
          voidedBy: "user-1",
        }),
      });
      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.servicePeriodEnd).toEqual(new Date("2099-09-06T06:00:00.000Z"));
      expect(update.status).toBe("active");
      expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
    });

    it("anular el ÚNICO pago con el trial ya vencido deja la suscripción en free", async () => {
      tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
        id: "pay-1",
        tenantId: TENANT,
        subscriptionId: "sub-1",
        status: "recorded",
        periodEnd: new Date("2026-09-06T06:00:00.000Z"),
      });
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "active",
          billingCycle: "monthly",
          anchorDay: 5,
          trialEndsAt: new Date("2020-01-01T00:00:00.000Z"),
        }),
      );
      tx.subscriptionPayment.findMany.mockResolvedValue([]);

      await service.voidPayment(TENANT, "pay-1", { reason: "error", voidedBy: "user-1" });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.status).toBe("free");
    });

    it("anular un pago ya anulado rebota", async () => {
      tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
        id: "pay-1",
        status: "voided",
      });

      await expect(
        service.voidPayment(TENANT, "pay-1", { reason: "x", voidedBy: "user-1" }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("changePlan / cancel / reactivate / cupones (F7-CORE-06)", () => {
    it("changePlan a premium sin custom_price rebota con 422", async () => {
      await expect(
        service.changePlan(TENANT, { planCode: "premium", reason: "deal" }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("changePlan con custom_price actualiza, audita e invalida", async () => {
      await service.changePlan(TENANT, {
        planCode: "premium",
        customPrice: "1250.00",
        reason: "deal VIP",
      });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.planId).toBe("plan-premium");
      expect(update.customPrice).toBe("1250.00");
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "billing.plan_changed" }),
      );
      expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
    });

    it("cancelar con período vivo NO degrada: cancel_at_period_end y el status queda intacto", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "active",
          billingCycle: "monthly",
          anchorDay: 5,
          dueAt: new Date("2099-01-01"),
        }),
      );

      await service.cancel(TENANT, { reason: "cliente lo pidió" });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.cancelAtPeriodEnd).toBe(true);
      expect(update.canceledAt).toBeInstanceOf(Date);
      expect(update.status).toBeUndefined(); // el cron decide al vencer, no este método
    });

    it("reactivar dentro del período vivo limpia la cancelación", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "active",
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
          servicePeriodEnd: new Date("2099-01-01"),
        }),
      );

      await service.reactivate(TENANT, { reason: "se arrepintió" });

      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.cancelAtPeriodEnd).toBe(false);
      expect(update.canceledAt).toBeNull();
    });

    it("reactivar con el período ya vencido rebota (para eso está el pago)", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "canceled",
          canceledAt: new Date(),
          servicePeriodEnd: new Date("2020-01-01"),
        }),
      );

      await expect(service.reactivate(TENANT, { reason: "tarde" })).rejects.toMatchObject({
        status: 422,
      });
    });

    it("otorgar un cupón con otro activo rebota con 409 (el UNIQUE parcial manda)", async () => {
      tx.tenantDiscount.create.mockRejectedValue(
        Object.assign(new Error("unique"), { code: "P2002" }),
      );

      await expect(
        service.grantDiscount(TENANT, {
          kind: "fixed_amount",
          amount: "200.00",
          startsAt: new Date(),
          reason: "promo",
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("revocar un cupón lo apaga y audita", async () => {
      await service.revokeDiscount(TENANT, "disc-1", { reason: "vencido" });

      expect(tx.tenantDiscount.update).toHaveBeenCalledWith({
        where: { id: "disc-1" },
        data: { isActive: false },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "billing.discount_revoked" }),
      );
    });
  });
});
