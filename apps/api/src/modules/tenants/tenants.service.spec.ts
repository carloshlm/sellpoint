import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import { TENANT_ROLE_NAMES } from "./role-catalog";
import { TenantsService } from "./tenants.service";

function buildTx() {
  const roleIdByName = new Map<string, string>();
  let roleCounter = 0;

  const tenant = { create: jest.fn().mockResolvedValue({ id: "tenant-1" }) };
  const user = { create: jest.fn().mockResolvedValue({ id: "user-1" }) };
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

  return { tenant, user, permission, role, rolePermission, userRole, roleIdByName };
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

  it("crea los 4 roles base y asigna TenantAdmin al owner", async () => {
    const { service, tx } = buildService();

    const result = await service.provision(baseInput);

    const createdRoleNames = tx.role.create.mock.calls.map((call) => call[0].data.name);
    expect(createdRoleNames.sort()).toEqual([...TENANT_ROLE_NAMES].sort());

    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: "user-1", roleId: tx.roleIdByName.get("TenantAdmin") },
    });
    expect(result).toEqual({ tenantId: "tenant-1", userId: "user-1" });
  });

  it("TenantAdmin recibe TODOS los permisos del catálogo existente", async () => {
    const { service, tx } = buildService();

    await service.provision(baseInput);

    const adminRoleId = tx.roleIdByName.get("TenantAdmin");
    const adminCall = tx.rolePermission.createMany.mock.calls.find((call) =>
      call[0].data.some((d: { roleId: string }) => d.roleId === adminRoleId),
    );
    expect(adminCall?.[0].data).toHaveLength(3);
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
