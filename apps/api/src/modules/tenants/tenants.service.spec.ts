import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import { TENANT_ROLE_NAMES } from "./role-catalog";
import { TenantsService } from "./tenants.service";

function buildTx() {
  const roleIdByName = new Map<string, string>();
  let roleCounter = 0;

  const tenant = {
    create: jest.fn().mockResolvedValue({ id: "tenant-1", timezone: "America/Mexico_City" }),
  };
  const user = {
    create: jest.fn().mockResolvedValue({ id: "user-1" }),
    // F3-HOME-03: provision asigna el almacén inicial al owner.
    update: jest.fn().mockResolvedValue({ id: "user-1" }),
  };
  const permission = {
    findMany: jest.fn().mockResolvedValue([
      { id: "perm-users-read", code: "users:read" },
      { id: "perm-users-manage", code: "users:manage" },
      { id: "perm-pos-sell", code: "pos:sell" },
    ]),
  };
  const role = {
    create: jest.fn(({ data }: { data: { name: string } }) => {
      roleCounter += 1;
      const id = `role-${roleCounter}`;
      roleIdByName.set(data.name, id);
      return Promise.resolve({ id, ...data });
    }),
  };
  const rolePermission = { createMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const userRole = { create: jest.fn().mockResolvedValue(undefined) };
  const catalog = { create: jest.fn().mockResolvedValue({ id: "catalog-1" }) };
  const warehouse = { create: jest.fn().mockResolvedValue({ id: "warehouse-1" }) };
  // F7-CORE-03: el trial nace con el tenant, en la misma transacción.
  const plan = {
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "plan-plus", code: "plus" }),
  };
  const tenantSubscription = { create: jest.fn().mockResolvedValue({ id: "sub-1" }) };

  return {
    tenant,
    user,
    permission,
    role,
    rolePermission,
    userRole,
    catalog,
    warehouse,
    plan,
    tenantSubscription,
    roleIdByName,
  };
}

describe("TenantsService.provision (f1-auth design §4)", () => {
  function buildService() {
    const tx = buildTx();
    const setTenantContext = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      withNewTenantContext: jest.fn((fn: (tx: unknown, set: typeof setTenantContext) => unknown) =>
        fn(tx, setTenantContext),
      ),
    } as unknown as PrismaService;

    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    const service = new TenantsService(prisma, auditService);
    return { service, tx, setTenantContext, auditService };
  }

  const baseInput = {
    tenantName: "Acme",
    ownerEmail: "owner@acme.test",
    ownerPasswordHash: "hash",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    ip: "127.0.0.1",
    userAgent: "jest",
  };

  it("crea tenant, abre su contexto y crea el owner invited con el passwordHash dado", async () => {
    const { service, tx, setTenantContext } = buildService();

    await service.provision(baseInput);

    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: { name: "Acme", currency: "MXN" },
    });
    expect(setTenantContext).toHaveBeenCalledWith("tenant-1");
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        email: "owner@acme.test",
        passwordHash: "hash",
        status: "invited",
        locale: "es",
      }),
    });
  });

  it("el tenant nace con su trial de 14 días nivel Plus, en la MISMA transacción (F7-CORE-03)", async () => {
    const { service, tx, auditService } = buildService();

    await service.provision(baseInput);

    expect(tx.plan.findUniqueOrThrow).toHaveBeenCalledWith({ where: { code: "plus" } });
    expect(tx.tenantSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        planId: "plan-plus",
        status: "trialing",
        trialEndsAt: expect.any(Date),
      }),
    });
    // El fin del trial es un INSTANTE futuro a ~14 días (fin del día local:
    // el día 14 completo es hábil — misma semántica que los vencimientos).
    const { trialEndsAt } = tx.tenantSubscription.create.mock.calls[0][0].data;
    const dias = (trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(13.9);
    expect(dias).toBeLessThan(15.1);
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "billing.trial_started", resourceType: "subscription" }),
    );
  });

  it("crea los 4 roles base y asigna Admin al owner", async () => {
    const { service, tx } = buildService();

    const result = await service.provision(baseInput);

    const createdRoleNames = tx.role.create.mock.calls.map((call) => call[0].data.name);
    expect(createdRoleNames.sort()).toEqual([...TENANT_ROLE_NAMES].sort());

    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: "user-1", roleId: tx.roleIdByName.get("Admin") },
    });
    expect(result).toEqual({ tenantId: "tenant-1", userId: "user-1" });
  });

  it("Admin recibe TODOS los permisos del catálogo existente", async () => {
    const { service, tx } = buildService();

    await service.provision(baseInput);

    const adminRoleId = tx.roleIdByName.get("Admin");
    const adminCall = tx.rolePermission.createMany.mock.calls.find((call) =>
      call[0].data.some((d: { roleId: string }) => d.roleId === adminRoleId),
    );
    expect(adminCall?.[0].data).toHaveLength(3);
  });

  // F2-CAT-01: el Catálogo de Productos es OBLIGATORIO y del sistema. Nace con
  // el tenant, en la misma transacción que los roles, porque un tenant sin él
  // no puede dar de alta un producto — y el motor no tendría dónde colgar los
  // campos personalizados.
  it("crea los TRES catálogos del sistema en la misma tx que el tenant", async () => {
    const { service, tx } = buildService();

    await service.provision(baseInput);

    // products (F2-CAT) + warehouses y services (2026-08-26): cada uno es el
    // ancla de los campos dinámicos de su entidad.
    expect(tx.catalog.create).toHaveBeenCalledTimes(3);
    for (const systemKey of ["products", "warehouses", "services"]) {
      expect(tx.catalog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          systemKey,
          isSystem: true,
        }),
      });
    }
  });

  /**
   * F3-HOME-03: el tenant nace CON su almacén, en la misma tx. Antes existía el
   * estado "tenant sin almacén" hasta que alguien completaba el paso 3 del
   * onboarding — y el POS de F4 no puede vender desde la nada.
   */
  it("crea el almacén inicial y se lo asigna al owner, en la misma tx", async () => {
    const { service, tx } = buildService();

    await service.provision(baseInput);

    expect(tx.warehouse.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-1", code: "ALM-001", name: "Almacén Central" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { defaultWarehouseId: "warehouse-1" },
    });
  });

  /** El nombre sale del idioma del owner. Neutro por LEY en los dos. */
  it("en inglés el almacén inicial se llama «Main Warehouse»", async () => {
    const { service, tx } = buildService();

    await service.provision({ ...baseInput, locale: "en" });

    expect(tx.warehouse.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-1", code: "ALM-001", name: "Main Warehouse" },
    });
  });

  it("el catálogo se crea DESPUÉS de abrir el contexto de tenant (tiene RLS)", async () => {
    const { service, tx, setTenantContext } = buildService();

    await service.provision(baseInput);

    // `catalogs` lleva policy tenant_isolation: crear la fila antes del
    // set_config la rechazaría el WITH CHECK.
    const contextOrder = setTenantContext.mock.invocationCallOrder[0] as number;
    const catalogOrder = tx.catalog.create.mock.invocationCallOrder[0] as number;
    expect(catalogOrder).toBeGreaterThan(contextOrder);
  });

  it("registra un AuditLog auth.register_tenant dentro de la misma tx", async () => {
    const { service, tx, auditService } = buildService();

    await service.provision(baseInput);

    expect(auditService.record).toHaveBeenCalledWith(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.register_tenant",
      resourceType: "tenant",
      resourceId: "tenant-1",
      ip: "127.0.0.1",
      userAgent: "jest",
    });
  });

  it("catálogo de permisos vacío → roles se crean sin permisos, no falla", async () => {
    const { service, tx } = buildService();
    tx.permission.findMany.mockResolvedValueOnce([]);

    await expect(service.provision(baseInput)).resolves.toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });
});
