import type { AuthUser } from "../auth/types/auth-user";
import { AdminTenantsService } from "./admin-tenants.service";

/**
 * F9-ADMIN-02 — el resumen del negocio: conteos de usuarios por estado,
 * productos, servicios, subcatálogos y almacenes, más su plan y sus
 * módulos, todo en UN `withTenantContext` del tenant de la URL.
 */
const TENANT = "22222222-2222-2222-2222-222222222222";
type Mock = jest.Mock;
/** El administrador de plataforma que mira el backoffice. */
const VIEWER: AuthUser = {
  userId: "admin-1",
  tenantId: "backoffice",
  permissions: [],
  locale: "es",
};

describe("AdminTenantsService (F9-ADMIN-02)", () => {
  let tx: {
    user: { count: Mock; findUnique?: Mock };
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
          suspendedAt: null,
          suspendedById: null,
          suspendedReason: null,
          name: "Acme",
          country: "MX",
          currency: "MXN",
          timezone: "America/Mexico_City",
          onboarded: true,
        }),
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new AdminTenantsService(
      prisma as any,
      { record: jest.fn() } as any,
      { now: () => new Date("2026-09-04T18:00:00.000Z") },
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it("arma el resumen con los conteos del tenant de la URL", async () => {
    const resumen = await service.overview(TENANT, VIEWER);
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
    await service.overview(TENANT, VIEWER);
    expect(tx.catalog.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, isSystem: false } });
    expect(tx.warehouse.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT, isActive: true },
    });
  });

  it("un negocio sin suscripción responde status `none`, sin reventar", async () => {
    tx.tenantSubscription.findUnique.mockResolvedValue(null);
    const resumen = await service.overview(TENANT, VIEWER);
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
    await expect(service.overview(TENANT, VIEWER)).rejects.toMatchObject({ status: 404 });
  });

  it("activo: el ciclo de vida dice que no está desactivado ni es eliminable", async () => {
    const resumen = await service.overview(TENANT, VIEWER);
    expect(resumen.lifecycle).toEqual({
      suspendedAt: null,
      suspendedBy: null,
      reason: null,
      suspendedDays: 0,
      deletableAt: null,
      deletable: false,
    });
  });

  it("desactivado hace 40 días: eliminable, con quién y por qué", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      name: "Acme",
      country: "MX",
      currency: "MXN",
      timezone: "America/Mexico_City",
      onboarded: true,
      suspendedAt: new Date("2026-07-26T18:00:00.000Z"),
      suspendedById: "admin-1",
      suspendedReason: "Impago reiterado",
    });
    // Quien desactivó vive en el negocio del ADMIN que mira (users tiene RLS):
    // se lee dentro de ese contexto, no con un include sin contexto.
    tx.user.findUnique = jest
      .fn()
      .mockResolvedValue({ id: "admin-1", firstName: "Carlos", lastNamePaternal: "H" });
    const resumen = await service.overview(TENANT, VIEWER);
    expect(prisma.withTenantContext).toHaveBeenCalledWith(VIEWER.tenantId, expect.any(Function));
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-1" },
      select: { id: true, firstName: true, lastNamePaternal: true },
    });
    expect(resumen.lifecycle).toEqual({
      suspendedAt: "2026-07-26T18:00:00.000Z",
      suspendedBy: { id: "admin-1", name: "Carlos H" },
      reason: "Impago reiterado",
      suspendedDays: 40,
      deletableAt: "2026-08-25T18:00:00.000Z",
      deletable: true,
    });
    // El resumen sigue sin filtrar los campos crudos del negocio.
    expect(resumen.tenant).toEqual({
      name: "Acme",
      country: "MX",
      currency: "MXN",
      timezone: "America/Mexico_City",
      onboarded: true,
    });
  });
});

/**
 * F7-LIFECYCLE-03 — desactivar y reactivar un negocio. Desactivar es «ya no
 * entra»: fecha, quién y motivo en `tenants`, y sus refresh tokens borrados
 * en la MISMA transacción. La auditoría va en el negocio del ACTOR (el
 * auditado puede desaparecer después).
 */
describe("AdminTenantsService — ciclo de vida (F7-LIFECYCLE-03)", () => {
  const NOW = new Date("2026-09-04T18:00:00.000Z");
  const ADMIN: AuthUser = {
    userId: "admin-1",
    tenantId: "backoffice",
    permissions: [],
    locale: "es",
  };
  const META = { ip: "10.0.0.1", userAgent: "jest" };
  let tx: {
    tenant: { update: Mock };
    refreshToken: { deleteMany: Mock };
    user: { findUnique: Mock };
    $executeRaw: Mock;
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let audit: { record: Mock };
  let service: AdminTenantsService;

  const activo = { id: TENANT, name: "Acme", suspendedAt: null, suspendedReason: null };
  const suspendido = {
    id: TENANT,
    name: "Acme",
    suspendedAt: new Date("2026-08-01T00:00:00.000Z"),
    suspendedReason: "Impago",
  };

  beforeEach(() => {
    tx = {
      tenant: { update: jest.fn(async ({ data }) => ({ ...activo, ...data })) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "admin-1", firstName: "Carlos", lastNamePaternal: "H" }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: { findUnique: jest.fn().mockResolvedValue(activo) },
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new AdminTenantsService(
      prisma as any,
      audit as any,
      { now: () => NOW },
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it("suspender guarda fecha, quién y motivo, borra los refresh tokens del negocio y audita en el tenant del actor", async () => {
    await service.suspend(ADMIN, TENANT, { reason: "Impago reiterado" }, META);

    expect(prisma.withTenantContext).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT },
      data: { suspendedAt: NOW, suspendedById: ADMIN.userId, suspendedReason: "Impago reiterado" },
    });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { tenantId: TENANT } });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: ADMIN.tenantId,
        userId: ADMIN.userId,
        action: "tenant.suspended",
        resourceType: "tenant",
        resourceId: TENANT,
        before: { suspendedAt: null },
        after: { suspendedAt: NOW.toISOString(), reason: "Impago reiterado" },
        ip: META.ip,
        userAgent: META.userAgent,
      }),
    );
    // La auditoría se escribe DESPUÉS de cambiar el contexto al tenant del actor.
    const ordenCambio = tx.$executeRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const ordenAudit = audit.record.mock.invocationCallOrder[0] ?? 0;
    expect(ordenCambio).toBeLessThan(ordenAudit);
  });

  it("suspender un negocio ya desactivado → 409 admin.tenant_already_suspended, sin tocar nada", async () => {
    prisma.tenant.findUnique.mockResolvedValue(suspendido);
    await expect(
      service.suspend(ADMIN, TENANT, { reason: "Otra vez" }, META),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: "admin.tenant_already_suspended" },
    });
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it("el propio negocio del administrador → 409 admin.cannot_touch_own_tenant, sin ni siquiera leerlo", async () => {
    await expect(
      service.suspend(ADMIN, ADMIN.tenantId, { reason: "Me equivoqué" }, META),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: "admin.cannot_touch_own_tenant" },
    });
    await expect(service.reactivate(ADMIN, ADMIN.tenantId, META)).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("un negocio que no existe → 404", async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.suspend(ADMIN, TENANT, { reason: "Impago" }, META)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reactivar limpia los tres campos y audita; sobre uno activo → 409", async () => {
    prisma.tenant.findUnique.mockResolvedValue(suspendido);
    await service.reactivate(ADMIN, TENANT, META);
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT },
      data: { suspendedAt: null, suspendedById: null, suspendedReason: null },
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: ADMIN.tenantId,
        action: "tenant.reactivated",
        resourceId: TENANT,
        before: { suspendedAt: suspendido.suspendedAt.toISOString(), reason: "Impago" },
        after: { suspendedAt: null },
      }),
    );

    prisma.tenant.findUnique.mockResolvedValue(activo);
    await expect(service.reactivate(ADMIN, TENANT, META)).rejects.toMatchObject({
      status: 409,
      response: { message: "admin.tenant_not_suspended" },
    });
  });
});

/**
 * F7-LIFECYCLE-05 — eliminar un negocio: cuatro candados EN ORDEN, cada uno
 * deja la base intacta; el camino feliz audita en el tenant del actor con el
 * snapshot de antes y el resumen de `purge_tenant()`, y tira el caché de
 * entitlements del negocio borrado.
 */
describe("AdminTenantsService — eliminar (F7-LIFECYCLE-05)", () => {
  const NOW = new Date("2026-09-04T18:00:00.000Z");
  const ADMIN: AuthUser = {
    userId: "admin-1",
    tenantId: "backoffice",
    permissions: [],
    locale: "es",
  };
  const META = { ip: "10.0.0.1", userAgent: "jest" };
  const HACE_40_DIAS = new Date("2026-07-26T18:00:00.000Z");
  const RESUMEN = { id: TENANT, name: "Acme", users: 3, sales: 12, tables: 46 };
  let tx: {
    user: { findUnique: Mock; count: Mock };
    sale: { count: Mock };
    $queryRaw: Mock;
    $executeRaw: Mock;
  };
  let prisma: { withTenantContext: Mock; tenant: { findUnique: Mock } };
  let audit: { record: Mock };
  let hasher: { verify: Mock };
  let redis: { get: Mock; incr: Mock; expire: Mock; del: Mock };
  let entitlements: { invalidate: Mock };
  let service: AdminTenantsService;
  const cuerpo = { password: "mi-clave", confirmName: "Acme" };

  beforeEach(() => {
    tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ passwordHash: "hash-del-admin" }),
        count: jest.fn().mockResolvedValue(3),
      },
      sale: { count: jest.fn().mockResolvedValue(12) },
      $queryRaw: jest.fn().mockResolvedValue([{ purge_tenant: RESUMEN }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: TENANT,
          name: "Acme",
          legalName: "Acme SA",
          suspendedAt: HACE_40_DIAS,
          suspendedReason: "Impago",
        }),
      },
    };
    audit = { record: jest.fn() };
    hasher = { verify: jest.fn().mockResolvedValue(true) };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };
    entitlements = { invalidate: jest.fn().mockResolvedValue(undefined) };
    service = new AdminTenantsService(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      audit as any,
      { now: () => NOW },
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      hasher as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      redis as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      entitlements as any,
    );
  });

  it("candado 1: el propio negocio → 409 sin leer nada", async () => {
    await expect(service.purge(ADMIN, ADMIN.tenantId, cuerpo, META)).rejects.toMatchObject({
      status: 409,
      response: { message: "admin.cannot_touch_own_tenant" },
    });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("candado 2: activo o con menos de 30 días desactivado → 409 con deletableAt", async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      name: "Acme",
      legalName: null,
      suspendedAt: new Date("2026-09-01T18:00:00.000Z"),
      suspendedReason: "Pruebas",
    });
    await expect(service.purge(ADMIN, TENANT, cuerpo, META)).rejects.toMatchObject({
      status: 409,
      response: {
        message: "admin.tenant_not_deletable",
        deletableAt: "2026-10-01T18:00:00.000Z",
      },
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      name: "Acme",
      legalName: null,
      suspendedAt: null,
      suspendedReason: null,
    });
    await expect(service.purge(ADMIN, TENANT, cuerpo, META)).rejects.toMatchObject({
      status: 409,
      response: { message: "admin.tenant_not_deletable", deletableAt: null },
    });
    expect(hasher.verify).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("candado 3: el nombre no coincide EXACTO → 422, sin pedir la contraseña", async () => {
    await expect(
      service.purge(ADMIN, TENANT, { ...cuerpo, confirmName: "acme" }, META),
    ).rejects.toMatchObject({ status: 422, response: { message: "admin.confirm_name_mismatch" } });
    expect(hasher.verify).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("candado 4: la contraseña del ADMIN se verifica contra SU hash; si falla → 401 y cuenta el intento", async () => {
    hasher.verify.mockResolvedValue(false);
    await expect(service.purge(ADMIN, TENANT, cuerpo, META)).rejects.toMatchObject({
      status: 401,
      response: { message: "admin.password_mismatch" },
    });
    expect(prisma.withTenantContext).toHaveBeenCalledWith(ADMIN.tenantId, expect.any(Function));
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: ADMIN.userId },
      select: { passwordHash: true },
    });
    expect(hasher.verify).toHaveBeenCalledWith("hash-del-admin", "mi-clave");
    expect(redis.incr).toHaveBeenCalledWith(`throttle:admin-purge:${ADMIN.userId}`);
    expect(redis.expire).toHaveBeenCalledWith(`throttle:admin-purge:${ADMIN.userId}`, 15 * 60);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("al quinto fallo → 429 sin verificar nada", async () => {
    redis.get.mockResolvedValue("5");
    await expect(service.purge(ADMIN, TENANT, cuerpo, META)).rejects.toMatchObject({
      status: 429,
      response: { message: "admin.too_many_attempts" },
    });
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it("camino feliz: purga en el tenant del actor, audita con snapshot y resumen, tira el caché y libera los intentos", async () => {
    const resultado = await service.purge(ADMIN, TENANT, cuerpo, META);

    expect(resultado).toEqual({ purged: true, name: "Acme" });
    // El snapshot se toma en el contexto del negocio que se va…
    expect(prisma.withTenantContext).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(tx.user.count).toHaveBeenCalledWith({ where: { tenantId: TENANT } });
    expect(tx.sale.count).toHaveBeenCalledWith({ where: { tenantId: TENANT } });
    // …y la purga y la auditoría van en el del actor, en la MISMA transacción.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: ADMIN.tenantId,
        userId: ADMIN.userId,
        action: "tenant.purged",
        resourceType: "tenant",
        resourceId: TENANT,
        before: {
          id: TENANT,
          name: "Acme",
          legalName: "Acme SA",
          suspendedAt: HACE_40_DIAS.toISOString(),
          suspendedReason: "Impago",
          users: 3,
          sales: 12,
        },
        after: RESUMEN,
      }),
    );
    expect(redis.del).toHaveBeenCalledWith(`throttle:admin-purge:${ADMIN.userId}`);
    expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
  });
});
