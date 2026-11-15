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
    plan: { findUniqueOrThrow: Mock; findMany?: Mock };
    planPrice: { findUnique: Mock };
    subscriptionPayment: {
      create: Mock;
      findFirst: Mock;
      findUniqueOrThrow: Mock;
      findMany: Mock;
      update: Mock;
    };
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
        // La guarda de orden pregunta por el último pago vivo: sin pagos
        // previos, cualquier fecha (no futura) es válida.
        findFirst: jest.fn().mockResolvedValue(null),
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
    service = new BillingService(
      prisma as any,
      audit as any,
      entitlements as any,
      mailer as any,
      { get: () => "carlos@backoffice.mx, ana@backoffice.mx" } as any,
    );
  });

  describe("recordPayment (F7-CORE-04)", () => {
    const pagoBase = {
      tenantId: TENANT,
      billingCycle: "monthly" as const,
      method: "transfer" as const,
      paidAt: new Date("2026-08-05T18:00:00.000Z"), // 5-ago local CDMX
      // La regla del cuadre (Carlos, 2026-08-29): recibido + descuento debe
      // dar el precio, así que capturar el monto es obligatorio.
      amountReceived: "499.00",
    };

    /**
     * El backoffice captura un DÍA, no un instante (Carlos, 2026-09-04: un
     * negocio en Toronto rechazaba el pago de hoy). El día llega como
     * `YYYY-MM-DD` y se ancla al mediodía de la zona del NEGOCIO, así
     * ninguna de las tres zonas en juego —navegador, servidor y negocio— lo
     * corre de día.
     */
    it("acepta el día del negocio como YYYY-MM-DD y lo ancla a su mediodía", async () => {
      await service.recordPayment({ ...pagoBase, paidAt: "2026-08-05" });

      const creado = tx.subscriptionPayment.create.mock.calls[0][0].data;
      // Mediodía de CDMX = 18:00Z: el mismo día en UTC y en el negocio.
      expect(creado.paidAt.toISOString()).toBe("2026-08-05T18:00:00.000Z");
      const update = tx.tenantSubscription.update.mock.calls[0][0].data;
      expect(update.anchorDay).toBe(5);
    });

    it("el día de HOY del negocio no es futuro aunque en UTC ya sea mañana", async () => {
      // 3-sep 22:00 CDMX = 4-sep 04:00 UTC. El negocio todavía está en el 3.
      jest.useFakeTimers().setSystemTime(new Date("2026-09-04T04:00:00.000Z"));
      await expect(
        service.recordPayment({ ...pagoBase, paidAt: "2026-09-03" }),
      ).resolves.toBeDefined();
      jest.useRealTimers();
    });

    it("un día realmente futuro sigue rebotando", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-09-04T04:00:00.000Z"));
      await expect(
        service.recordPayment({ ...pagoBase, paidAt: "2026-09-05" }),
      ).rejects.toMatchObject({ response: { message: "billing.paid_at_in_future" } });
      jest.useRealTimers();
    });

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
      await service.recordPayment({ ...pagoBase, planCode: "basic", amountReceived: "199.00" });

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

      await service.recordPayment({ ...pagoBase, amountReceived: "299.00" });

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

      await service.recordPayment({ ...pagoBase, amountReceived: "45.00" });

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("45.00");
      expect(pago.currency).toBe("USD");
    });

    it("un país sin precio propio cae a la tarifa US (default internacional)", async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue(tenantRow({ country: "CO" }));

      await service.recordPayment({ ...pagoBase, amountReceived: "45.00" });

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

      await service.recordPayment({ ...pagoBase, amountReceived: "1250.00" });

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("1250.00");
      expect(pago.amount).toBe("1250.00");
    });

    /**
     * Antes, un monto distinto se registraba igual y la diferencia quedaba en
     * una nota de texto. Ahora la cuenta cuadra o no hay pago: lo que se
     * perdona se captura como DESCUENTO, que es un dato y no prosa.
     */
    it("un monto que no cuadra con el cargo se RECHAZA", async () => {
      await expect(
        service.recordPayment({ ...pagoBase, amountReceived: "2000.00" }),
      ).rejects.toThrow();
      expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
    });

    it("recibido + descuento = precio: 300 con 199 de descuento entra y queda asentado", async () => {
      await service.recordPayment({
        ...pagoBase,
        amountReceived: "300.00",
        discountAmount: "199.00",
      });

      const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
      expect(pago.grossAmount).toBe("499.00");
      expect(pago.discountAmount).toBe("199.00");
      // Con la cuenta cuadrada, lo guardado ES lo recibido.
      expect(pago.amount).toBe("300.00");
    });

    it("un pago sobre una suscripción cancelada rebota: primero se reactiva", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "canceled", canceledAt: new Date() }),
      );

      await expect(service.recordPayment(pagoBase)).rejects.toMatchObject({ status: 422 });
      expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
    });

    /**
     * Carlos (2026-11-14): «un negocio me va a pagar pero quiero que su pago
     * abarque hasta cierta fecha por un acuerdo». El pago trae «Cubre hasta»;
     * si difiere del automático es un ACUERDO: precio acordado (recibido +
     * descuento = acordado, el cupón no se suma), motivo obligatorio, y la
     * fecha acordada se vuelve el día de cobro.
     */
    describe("«Cubre hasta» y el precio acordado", () => {
      const acuerdo = {
        ...pagoBase,
        periodEnd: "2026-12-31",
        agreedPrice: "750.00",
        amountReceived: "750.00",
        notes: "Paga hasta fin de año",
      };
      const motivo = (clave: string) => ({ status: 422, response: { message: clave } });

      it("un «Cubre hasta» igual al automático no es acuerdo: todo sigue como hoy", async () => {
        await service.recordPayment({ ...pagoBase, periodEnd: "2026-09-05" });

        const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
        expect(pago.grossAmount).toBe("499.00");
        expect(pago.anchorDay).toBe(5);
        const update = tx.tenantSubscription.update.mock.calls[0][0].data;
        expect(update.dueAt.toISOString()).toBe("2026-09-06T06:00:00.000Z");
        expect(update.anchorDay).toBe(5);
      });

      it("un acuerdo al 31-dic vence ese día, cobra lo acordado y el 31 pasa a ser el día de cobro", async () => {
        await service.recordPayment(acuerdo);

        const update = tx.tenantSubscription.update.mock.calls[0][0].data;
        // Límite abierto: el arranque del 1-ene en CDMX.
        expect(update.dueAt.toISOString()).toBe("2027-01-01T06:00:00.000Z");
        expect(update.servicePeriodEnd.toISOString()).toBe("2027-01-01T06:00:00.000Z");
        expect(update.anchorDay).toBe(31);
        const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
        expect(pago).toMatchObject({
          grossAmount: "750.00",
          discountAmount: "0.00",
          amount: "750.00",
          anchorDay: 31,
          notes: "Paga hasta fin de año",
        });
        expect(pago.periodEnd.toISOString()).toBe("2027-01-01T06:00:00.000Z");
        const bitacora = audit.record.mock.calls[0][1];
        expect(bitacora.after).toMatchObject({
          coverage: { automatic: "2026-09-05", agreed: "2026-12-31" },
          listGross: "499.00",
        });
      });

      it("una cortesía es un acuerdo en $0", async () => {
        await service.recordPayment({ ...acuerdo, agreedPrice: "0", amountReceived: "0" });

        const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
        expect(pago).toMatchObject({ grossAmount: "0.00", amount: "0.00" });
      });

      it("recibido + descuento tiene que dar el precio ACORDADO, no el de lista", async () => {
        await service.recordPayment({
          ...acuerdo,
          amountReceived: "500.00",
          discountAmount: "250.00",
        });
        expect(tx.subscriptionPayment.create.mock.calls[0][0].data.amount).toBe("500.00");

        tx.subscriptionPayment.create.mockClear();
        await expect(
          service.recordPayment({ ...acuerdo, amountReceived: "499.00" }),
        ).rejects.toMatchObject(motivo("billing.amount_mismatch"));
        expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
      });

      it("el cupón no se suma a un acuerdo: el precio acordado ya es el trato", async () => {
        tx.tenantDiscount.findFirst.mockResolvedValue({
          id: "disc-1",
          kind: "fixed_amount",
          amount: "200.00",
          maxPeriods: 12,
          appliedPeriods: 3,
          isActive: true,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
        });

        await service.recordPayment(acuerdo);

        const pago = tx.subscriptionPayment.create.mock.calls[0][0].data;
        expect(pago).toMatchObject({ grossAmount: "750.00", discountAmount: "0.00" });
        expect(pago.discountId).toBeNull();
        expect(tx.tenantDiscount.update).not.toHaveBeenCalled();
      });

      it.each([
        ["2026-11-30", 31],
        ["2027-02-28", 31],
        ["2026-12-15", 15],
      ])(
        "un acuerdo al %s deja el día de cobro en el %i: fin de mes se queda en fin de mes",
        async (fecha, ancla) => {
          await service.recordPayment({ ...acuerdo, periodEnd: fecha });

          expect(tx.tenantSubscription.update.mock.calls[0][0].data.anchorDay).toBe(ancla);
          expect(tx.subscriptionPayment.create.mock.calls[0][0].data.anchorDay).toBe(ancla);
        },
      );

      it("en gracia, el acuerdo no puede terminar antes del día del pago", async () => {
        tx.tenantSubscription.findUnique.mockResolvedValue(
          subRow({
            status: "past_due",
            billingCycle: "monthly",
            anchorDay: 28,
            servicePeriodEnd: new Date("2026-03-01T06:00:00.000Z"),
            dueAt: new Date("2026-03-01T06:00:00.000Z"),
          }),
        );

        await expect(
          service.recordPayment({
            ...acuerdo,
            paidAt: new Date("2026-03-05T18:00:00.000Z"),
            periodEnd: "2026-03-03",
          }),
        ).rejects.toMatchObject({
          response: { message: "billing.period_end_before_start", args: { start: "2026-03-05" } },
        });
      });

      it("el tope de 3 años desde un 29 de febrero es el 28: no propone una fecha que no existe", async () => {
        tx.tenantSubscription.findUnique.mockResolvedValue(
          subRow({
            status: "active",
            billingCycle: "monthly",
            anchorDay: 29,
            // Venció el 28-feb-2028: el período nuevo arranca el 29.
            servicePeriodEnd: new Date("2028-02-29T06:00:00.000Z"),
          }),
        );

        await expect(
          service.recordPayment({ ...acuerdo, periodEnd: "2031-03-01" }),
        ).rejects.toMatchObject({
          response: { message: "billing.period_end_too_far", args: { max: "2031-02-28" } },
        });
      });

      it.each([
        [
          "antes de que empiece el período",
          { periodEnd: "2026-08-01" },
          "billing.period_end_before_start",
        ],
        [
          "a más de 3 años (un año mal tecleado)",
          { periodEnd: "2030-01-01" },
          "billing.period_end_too_far",
        ],
        ["sin precio acordado", { agreedPrice: undefined }, "billing.agreed_price_required"],
        ["sin motivo", { notes: undefined }, "billing.agreement_reason_required"],
      ])("un acuerdo %s rebota", async (_caso, cambio, clave) => {
        await expect(service.recordPayment({ ...acuerdo, ...cambio })).rejects.toMatchObject(
          motivo(clave),
        );
        expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
      });
    });

    /**
     * El bug de la captura (Carlos, 2026-11-14): «Debe pagar: 499.00» y el API
     * «precio 650.00». El pactado es de UN plan —el que el negocio tiene—, como
     * ya lo aplicaba el listado del backoffice.
     */
    describe("el precio pactado es del plan que el negocio tiene", () => {
      it("pagar otro plan cobra su precio de lista, y el pactado se suelta", async () => {
        tx.tenantSubscription.findUnique.mockResolvedValue(
          subRow({ planId: "plan-premium", plan: PLAN_PREMIUM, customPrice: "650.00" }),
        );

        await service.recordPayment({ ...pagoBase, planCode: "plus", amountReceived: "499.00" });

        expect(tx.subscriptionPayment.create.mock.calls[0][0].data.grossAmount).toBe("499.00");
        const update = tx.tenantSubscription.update.mock.calls[0][0].data;
        expect(update.planId).toBe("plan-plus");
        expect(update.customPrice).toBeNull();
      });

      it("pagar el mismo plan conserva el pactado", async () => {
        tx.tenantSubscription.findUnique.mockResolvedValue(
          subRow({ planId: "plan-premium", plan: PLAN_PREMIUM, customPrice: "1250.00" }),
        );
        tx.planPrice.findUnique.mockResolvedValue(null);

        await service.recordPayment({ ...pagoBase, amountReceived: "1250.00" });

        expect(tx.tenantSubscription.update.mock.calls[0][0].data).not.toHaveProperty(
          "customPrice",
        );
      });
    });
  });

  /**
   * La cotización que pinta «Debe pagar» y «Cubre del … al …»: la MISMA
   * cuenta que hace el pago, sin escribir nada.
   */
  describe("quotePayment", () => {
    it("cotiza el primer pago desde el día del pago, sin escribir nada", async () => {
      const cotizacion = await service.quotePayment({
        tenantId: TENANT,
        billingCycle: "monthly",
        paidAt: "2026-08-05",
      });

      expect(cotizacion).toEqual({
        periodStart: "2026-08-05",
        periodEnd: "2026-09-05",
        gross: "499.00",
        discount: "0.00",
        net: "499.00",
        currency: "MXN",
      });
      expect(tx.tenantSubscription.update).not.toHaveBeenCalled();
      expect(tx.subscriptionPayment.create).not.toHaveBeenCalled();
    });

    it("encadena con el vencimiento anterior, como el pago", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({
          status: "active",
          billingCycle: "monthly",
          anchorDay: 5,
          servicePeriodEnd: new Date("2026-09-06T06:00:00.000Z"),
        }),
      );

      const cotizacion = await service.quotePayment({
        tenantId: TENANT,
        billingCycle: "monthly",
        paidAt: "2026-09-01",
      });

      expect(cotizacion).toMatchObject({ periodStart: "2026-09-06", periodEnd: "2026-10-05" });
    });

    it("con el pactado de otro plan, cotiza el precio de lista del plan elegido", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ planId: "plan-premium", plan: PLAN_PREMIUM, customPrice: "650.00" }),
      );

      const cotizacion = await service.quotePayment({
        tenantId: TENANT,
        billingCycle: "monthly",
        planCode: "plus",
        paidAt: "2026-08-05",
      });

      expect(cotizacion.net).toBe("499.00");
    });

    it("una suscripción cancelada no se cotiza: el pago la rechazaría igual", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "canceled", canceledAt: new Date() }),
      );

      await expect(
        service.quotePayment({ tenantId: TENANT, billingCycle: "monthly", paidAt: "2026-08-05" }),
      ).rejects.toMatchObject({ response: { message: "billing.subscription_canceled" } });
    });

    it("un negocio sin suscripción se cotiza con el plan elegido, sin darlo de alta", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(null);
      const crear = jest.fn();
      (tx.tenantSubscription as unknown as { create: Mock }).create = crear;

      await expect(
        service.quotePayment({ tenantId: TENANT, billingCycle: "monthly", paidAt: "2026-08-05" }),
      ).rejects.toMatchObject({ status: 422 });

      const cotizacion = await service.quotePayment({
        tenantId: TENANT,
        billingCycle: "monthly",
        planCode: "basic",
        paidAt: "2026-08-05",
      });
      expect(cotizacion).toMatchObject({ net: "199.00", periodStart: "2026-08-05" });
      expect(crear).not.toHaveBeenCalled();
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

    /**
     * Anular un acuerdo devuelve el día de cobro del pago vivo anterior: con el
     * ancla del acuerdo (31) y el vencimiento del 15, el siguiente pago
     * mensual cubriría hasta el 31 del mes que sigue — mes y medio.
     */
    it("anular devuelve el ancla que dejó el pago vivo más reciente", async () => {
      tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
        id: "pay-2",
        tenantId: TENANT,
        subscriptionId: "sub-1",
        status: "recorded",
        periodEnd: new Date("2099-01-01T06:00:00.000Z"),
        anchorDay: 31,
      });
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "active", billingCycle: "monthly", anchorDay: 31, trialEndsAt: null }),
      );
      tx.subscriptionPayment.findMany.mockResolvedValue([
        {
          id: "pay-1",
          periodStart: new Date("2098-11-15T18:00:00.000Z"),
          periodEnd: new Date("2098-12-16T06:00:00.000Z"),
          anchorDay: 15,
        },
      ]);

      await service.voidPayment(TENANT, "pay-2", { reason: "fecha mal", voidedBy: "user-1" });

      expect(tx.tenantSubscription.update.mock.calls[0][0].data.anchorDay).toBe(15);
    });

    it("un pago de antes sin ancla guardada no toca el ancla", async () => {
      tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
        id: "pay-2",
        tenantId: TENANT,
        subscriptionId: "sub-1",
        status: "recorded",
        periodEnd: new Date("2099-01-01T06:00:00.000Z"),
      });
      tx.tenantSubscription.findUnique.mockResolvedValue(
        subRow({ status: "active", billingCycle: "monthly", anchorDay: 5, trialEndsAt: null }),
      );
      tx.subscriptionPayment.findMany.mockResolvedValue([
        { id: "pay-1", periodEnd: new Date("2099-09-06T06:00:00.000Z"), anchorDay: null },
      ]);

      await service.voidPayment(TENANT, "pay-2", { reason: "x", voidedBy: "user-1" });

      expect(tx.tenantSubscription.update.mock.calls[0][0].data).not.toHaveProperty("anchorDay");
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

    /**
     * Sin pagos vivos no queda día de cobro: el del pago anulado —el de un
     * acuerdo al 31, por ejemplo— haría que el siguiente pago desde el trial
     * cubriera hasta el 31 aunque se pague un 14 (verificación, 2026-11-14).
     */
    it.each([
      ["el trial sigue vivo", new Date("2099-01-01T00:00:00.000Z"), "trialing"],
      ["el trial ya venció", new Date("2020-01-01T00:00:00.000Z"), "free"],
    ])(
      "anular el único pago cuando %s suelta el día de cobro",
      async (_caso, trialEndsAt, estado) => {
        tx.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
          id: "pay-1",
          tenantId: TENANT,
          subscriptionId: "sub-1",
          status: "recorded",
          periodEnd: new Date("2026-12-01T06:00:00.000Z"),
          anchorDay: 31,
        });
        tx.tenantSubscription.findUnique.mockResolvedValue(
          subRow({ status: "active", billingCycle: "monthly", anchorDay: 31, trialEndsAt }),
        );
        tx.subscriptionPayment.findMany.mockResolvedValue([]);

        await service.voidPayment(TENANT, "pay-1", { reason: "acuerdo mal", voidedBy: "user-1" });

        const update = tx.tenantSubscription.update.mock.calls[0][0].data;
        expect(update).toMatchObject({ status: estado, anchorDay: null });
      },
    );

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

  describe("listPublicPlans (F7-WEB-02)", () => {
    beforeEach(() => {
      tx.plan.findMany = jest.fn().mockResolvedValue([
        {
          code: "basic",
          name: "Basic",
          description: "POS",
          sortOrder: 1,
          maxUsers: 3,
          maxWarehouses: 1,
          features: {},
          prices: [
            { country: "MX", currency: "MXN", priceMonthly: "199", priceYearly: "1990" },
            { country: "US", currency: "USD", priceMonthly: "15", priceYearly: "150" },
          ],
        },
        {
          code: "premium",
          name: "Premium",
          description: "A la medida",
          sortOrder: 4,
          maxUsers: null,
          maxWarehouses: null,
          features: {},
          prices: [],
        },
      ]);
      // El catálogo es global (sin RLS): se lee con el cliente base.
      // biome-ignore lint/suspicious/noExplicitAny: mock parcial a propósito
      (service as any).prisma.plan = tx.plan;
    });

    it("excluye free, resuelve el precio del país pedido y Premium sale SIN precio", async () => {
      const planes = await service.listPublicPlans("MX");

      expect(tx.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, code: { not: "free" } },
        }),
      );
      expect(planes[0]).toMatchObject({
        code: "basic",
        price: { currency: "MXN", monthly: "199", yearly: "1990" },
      });
      expect(planes[1]).toMatchObject({ code: "premium", price: null });
    });

    it("un país sin precio propio cae a la tarifa US", async () => {
      const planes = await service.listPublicPlans("CO");
      expect(planes[0]?.price).toMatchObject({ currency: "USD", monthly: "15" });
    });
  });

  /**
   * F7-CONTACT — «Escríbenos para activar tu plan»: se audita primero, se
   * avisa a cada administrador de la plataforma en español, y se le agradece
   * al negocio en SU idioma. Si el aviso al backoffice no sale, 503.
   */
  describe("requestPlan (F7-CONTACT)", () => {
    const USER = { userId: "u1", tenantId: TENANT, permissions: [], locale: "en" as const };
    beforeEach(() => {
      Object.assign(tx.tenant, {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "Acme" }),
      });
      Object.assign(tx.user, {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ firstName: "Ana", lastName: "Pérez", email: "ana@acme.mx" }),
      });
      mailer.send.mockResolvedValue(undefined);
    });

    it("audita el mensaje, avisa a cada admin en español y agradece al negocio en su idioma", async () => {
      await expect(
        service.requestPlan(USER, "Quiero el plan Pro, por favor", "en"),
      ).resolves.toEqual({ sent: true });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "billing.plan_requested",
          resourceId: TENANT,
          after: { message: "Quiero el plan Pro, por favor" },
        }),
      );
      const vars = {
        tenantName: "Acme",
        userName: "Ana Pérez",
        userEmail: "ana@acme.mx",
        message: "Quiero el plan Pro, por favor",
      };
      expect(mailer.send).toHaveBeenCalledWith({
        to: "carlos@backoffice.mx",
        template: "plan-request",
        locale: "es",
        vars,
      });
      expect(mailer.send).toHaveBeenCalledWith({
        to: "ana@backoffice.mx",
        template: "plan-request",
        locale: "es",
        vars,
      });
      expect(mailer.send).toHaveBeenCalledWith({
        to: "ana@acme.mx",
        template: "plan-request-received",
        locale: "en",
        vars: { firstName: "Ana", tenantName: "Acme" },
      });
    });

    it("si el aviso al backoffice falla → 503 y no se manda el acuse", async () => {
      mailer.send.mockRejectedValueOnce(new Error("smtp caído"));
      await expect(
        service.requestPlan(USER, "Quiero el plan Pro, por favor", "es"),
      ).rejects.toMatchObject({
        status: 503,
        response: { message: "billing.plan_request_failed" },
      });
      expect(mailer.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ template: "plan-request-received" }),
      );
      // La auditoría ya quedó: el mensaje no se pierde aunque el correo falle.
      expect(audit.record).toHaveBeenCalled();
    });
  });
});
