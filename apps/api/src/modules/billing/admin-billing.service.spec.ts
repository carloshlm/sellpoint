import { AdminBillingService } from "./admin-billing.service";

/**
 * F7-ADMIN-02/05/06 — la vista cross-tenant del dueño.
 *
 * El MRR se calcula desde los PAGOS VIGENTES (period_end en el futuro), no
 * desde los precios de lista: dinero real comprometido, no aspiracional — un
 * trial no aporta MRR y un anual aporta su doceava parte. Y SIEMPRE por
 * moneda: sumar MXN con USD daría un número que no existe.
 */
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

describe("AdminBillingService", () => {
  let tx: {
    tenantSubscription: { findMany: jest.Mock; findUnique: jest.Mock };
    subscriptionPayment: { findMany: jest.Mock };
    tenant: { findMany: jest.Mock };
    tenantDiscount: { findFirst: jest.Mock; findMany: jest.Mock };
    tenantModule: { findMany: jest.Mock };
    stockByWarehouse: { findMany: jest.Mock };
    plan: { findUniqueOrThrow: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    planPrice: { upsert: jest.Mock };
  };
  let prisma: {
    withBillingAdminContext: jest.Mock;
    withTenantContext: jest.Mock;
    plan: { findMany: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock };
    planPrice: { upsert: jest.Mock };
    tenant: { findMany: jest.Mock };
  };
  let service: AdminBillingService;

  beforeEach(() => {
    tx = {
      tenantSubscription: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      subscriptionPayment: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      tenantDiscount: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenantModule: { findMany: jest.fn().mockResolvedValue([]) },
      stockByWarehouse: { findMany: jest.fn().mockResolvedValue([]) },
      plan: { findUniqueOrThrow: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      planPrice: { upsert: jest.fn() },
    };
    prisma = {
      withBillingAdminContext: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      plan: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ code: "plus", ...data })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ code: "free", name: "Free" }),
      },
      planPrice: { upsert: jest.fn() },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new AdminBillingService(prisma as any);
  });

  describe("listTenants (F7-ADMIN-02)", () => {
    it("lee cross-tenant por la ÚNICA puerta (withBillingAdminContext) y arma la fila del panel", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([
        {
          tenantId: TENANT_A,
          status: "active",
          billingCycle: "monthly",
          dueAt: new Date("2026-09-06T06:00:00.000Z"),
          plan: { code: "plus", name: "Plus" },
          payments: [{ paidAt: new Date("2026-08-05"), amount: "499.00", currency: "MXN" }],
        },
        {
          tenantId: TENANT_B,
          status: "trialing",
          billingCycle: null,
          dueAt: null,
          plan: { code: "plus", name: "Plus" },
          payments: [],
        },
      ]);
      prisma.tenant.findMany.mockResolvedValue([
        { id: TENANT_A, name: "Acme", country: "MX" },
        { id: TENANT_B, name: "Beta", country: "US" },
      ]);

      const lista = await service.listTenants();

      expect(prisma.withBillingAdminContext).toHaveBeenCalled();
      expect(lista.tenants).toHaveLength(2);
      expect(lista.tenants[0]).toMatchObject({
        tenantId: TENANT_A,
        tenantName: "Acme",
        planCode: "plus",
        status: "active",
        lastPaymentAt: expect.any(Date),
      });
    });

    /**
     * La lista parte de los NEGOCIOS y no de las suscripciones. Al revés
     * —como estaba— los anteriores a la Fase 7 desaparecían del backoffice,
     * que son justo a los que hay que cobrarles (Carlos, 2026-08-29).
     */
    it("un negocio SIN suscripción sale igual, con status `none` sobre el plan free", async () => {
      tx.tenantSubscription.findMany.mockResolvedValue([]);
      prisma.tenant.findMany.mockResolvedValue([{ id: TENANT_A, name: "Viejo", country: null }]);

      const lista = await service.listTenants();

      expect(lista.tenants).toEqual([
        expect.objectContaining({
          tenantId: TENANT_A,
          tenantName: "Viejo",
          status: "none",
          planCode: "free",
          dueAt: null,
          lastPaymentAt: null,
        }),
      ]);
    });

    it("el MRR sale de los pagos VIGENTES, por moneda; el anual aporta su doceava parte", async () => {
      const futuro = new Date("2099-01-01");
      tx.subscriptionPayment.findMany.mockResolvedValue([
        { amount: "499.00", currency: "MXN", billingCycle: "monthly", periodEnd: futuro },
        { amount: "450.00", currency: "USD", billingCycle: "yearly", periodEnd: futuro },
        { amount: "299.00", currency: "MXN", billingCycle: "monthly", periodEnd: futuro },
      ]);

      const lista = await service.listTenants();

      expect(lista.mrrByCurrency).toEqual({ MXN: "798.00", USD: "37.50" });
    });
  });

  /**
   * F9-MOD-09 — cada fila trae sus módulos, leídos de `tenant_modules` en UNA
   * query dentro del mismo contexto de billing admin (nunca una por negocio).
   */
  describe("módulos por fila (F9-MOD-09)", () => {
    it("reparte los módulos por negocio con una sola consulta y descarta claves fuera del catálogo", async () => {
      prisma.tenant.findMany.mockResolvedValue([
        {
          id: TENANT_A,
          name: "A",
          country: "MX",
          currency: "MXN",
          timezone: "UTC",
          createdAt: new Date(),
        },
        {
          id: TENANT_B,
          name: "B",
          country: "MX",
          currency: "MXN",
          timezone: "UTC",
          createdAt: new Date(),
        },
      ]);
      tx.tenantModule.findMany.mockResolvedValue([
        { tenantId: TENANT_A, moduleKey: "reception" },
        { tenantId: TENANT_A, moduleKey: "foo" },
      ]);

      const lista = await service.listTenants();

      expect(tx.tenantModule.findMany).toHaveBeenCalledTimes(1);
      expect(lista.tenants.find((t) => t.tenantId === TENANT_A)?.modules).toEqual(["reception"]);
      expect(lista.tenants.find((t) => t.tenantId === TENANT_B)?.modules).toEqual([]);
    });
  });

  describe("upgradeWarnings (F7-ADMIN-06)", () => {
    it("lista los saldos NEGATIVOS con sku y almacén — qué inventariar al subir a un plan con control", async () => {
      tx.stockByWarehouse.findMany.mockResolvedValue([
        {
          quantity: "-3",
          product: { sku: "KY6" },
          warehouse: { name: "Central" },
        },
      ]);

      const warnings = await service.negativeStockWarnings(TENANT_A);

      expect(tx.stockByWarehouse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ quantity: { lt: 0 } }) }),
      );
      expect(warnings).toEqual([{ sku: "KY6", warehouse: "Central", quantity: "-3" }]);
    });
  });

  describe("updatePlan (F7-ADMIN-05)", () => {
    it("valida las features con el schema estricto: un typo revienta, no se guarda", async () => {
      await expect(
        service.updatePlan("plus", { features: { pos: true, lotes: true } }),
      ).rejects.toThrow();
      expect(prisma.plan.update).not.toHaveBeenCalled();
    });

    it("actualiza límites y upsertea precios con el anual = mensual × 10 (el CHECK manda)", async () => {
      await service.updatePlan("plus", {
        maxUsers: 25,
        prices: [{ country: "MX", currency: "MXN", priceMonthly: "549.00" }],
      });

      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: "plus" }, data: { maxUsers: 25 } }),
      );
      expect(prisma.planPrice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ priceMonthly: "549.00", priceYearly: "5490.00" }),
          update: expect.objectContaining({ priceMonthly: "549.00", priceYearly: "5490.00" }),
        }),
      );
    });
  });
});
