import { AdminTenantsService } from "./admin-tenants.service";

/**
 * F9-ADMIN-02 — el resumen del negocio: conteos de usuarios por estado,
 * productos, servicios, subcatálogos y almacenes, más su plan y sus
 * módulos, todo en UN `withTenantContext` del tenant de la URL.
 */
const TENANT = "22222222-2222-2222-2222-222222222222";
type Mock = jest.Mock;

describe("AdminTenantsService (F9-ADMIN-02)", () => {
  let tx: {
    user: { count: Mock };
    product: { count: Mock };
    service: { count: Mock };
    catalog: { count: Mock };
    warehouse: { count: Mock };
    tenantSubscription: { findUnique: Mock };
    tenantModule: { findMany: Mock };
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let service: AdminTenantsService;

  beforeEach(() => {
    tx = {
      user: {
        count: jest.fn().mockImplementation(({ where }) => {
          const porEstado: Record<string, number> = { active: 3, invited: 1, suspended: 2 };
          return Promise.resolve(porEstado[where.status] ?? 0);
        }),
      },
      product: { count: jest.fn().mockResolvedValue(120) },
      service: { count: jest.fn().mockResolvedValue(7) },
      catalog: { count: jest.fn().mockResolvedValue(4) },
      warehouse: { count: jest.fn().mockResolvedValue(2) },
      tenantSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          status: "active",
          billingCycle: "monthly",
          dueAt: new Date("2026-10-02T06:00:00.000Z"),
          customPrice: null,
          plan: { code: "plus", name: "Plus" },
        }),
      },
      tenantModule: { findMany: jest.fn().mockResolvedValue([{ moduleKey: "reception" }]) },
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: "Acme",
          country: "MX",
          currency: "MXN",
          timezone: "America/Mexico_City",
          onboarded: true,
        }),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new AdminTenantsService(prisma as any);
  });

  it("arma el resumen con los conteos del tenant de la URL", async () => {
    const resumen = await service.overview(TENANT);
    expect(prisma.withTenantContext).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(resumen.tenant).toEqual({
      name: "Acme",
      country: "MX",
      currency: "MXN",
      timezone: "America/Mexico_City",
      onboarded: true,
    });
    expect(resumen.users).toEqual({ active: 3, invited: 1, suspended: 2 });
    expect(resumen.counts).toEqual({ products: 120, services: 7, subcatalogs: 4, warehouses: 2 });
    expect(resumen.subscription).toEqual({
      planCode: "plus",
      planName: "Plus",
      status: "active",
      billingCycle: "monthly",
      dueAt: "2026-10-02T06:00:00.000Z",
      customPrice: null,
    });
    expect(resumen.modules).toEqual(["reception"]);
  });

  it("los subcatálogos son los catálogos que NO son de sistema; los almacenes, los activos", async () => {
    await service.overview(TENANT);
    expect(tx.catalog.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, isSystem: false } });
    expect(tx.warehouse.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT, isActive: true },
    });
  });

  it("un negocio sin suscripción responde status `none`, sin reventar", async () => {
    tx.tenantSubscription.findUnique.mockResolvedValue(null);
    const resumen = await service.overview(TENANT);
    expect(resumen.subscription).toEqual({
      planCode: "free",
      planName: null,
      status: "none",
      billingCycle: null,
      dueAt: null,
      customPrice: null,
    });
  });

  it("un tenant que no existe → 404", async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.overview(TENANT)).rejects.toMatchObject({ status: 404 });
  });
});
