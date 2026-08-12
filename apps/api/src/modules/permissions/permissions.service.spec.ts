import { PermissionsService } from "./permissions.service";

/**
 * F1-RBAC-05: `GET /permissions` agrupado por módulo, para que el frontend
 * pueda construir el editor de roles (checkboxes por módulo). El catálogo es
 * GLOBAL (tabla `permissions`, sin tenant_id ni RLS) — sin `withTenantContext`
 * a propósito, ver comentario del service.
 */
describe("PermissionsService.listGroupedByModule", () => {
  function buildService(rows: Array<{ code: string; module: string; description: string | null }>) {
    const prisma = {
      permission: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new PermissionsService(prisma as never);
    return { service, prisma };
  }

  it("agrupa los codes por module, preservando description", async () => {
    const { service } = buildService([
      { code: "roles:manage", module: "roles", description: "Gestionar roles" },
      { code: "users:manage", module: "users", description: "Gestionar usuarios" },
      { code: "users:read", module: "users", description: "Ver usuarios" },
    ]);

    const result = await service.listGroupedByModule();

    expect(result).toEqual([
      { module: "roles", permissions: [{ code: "roles:manage", description: "Gestionar roles" }] },
      {
        module: "users",
        permissions: [
          { code: "users:manage", description: "Gestionar usuarios" },
          { code: "users:read", description: "Ver usuarios" },
        ],
      },
    ]);
  });

  it("catálogo vacío -> array vacío, no falla", async () => {
    const { service } = buildService([]);

    await expect(service.listGroupedByModule()).resolves.toEqual([]);
  });

  it("consulta el catálogo GLOBAL sin withTenantContext (permissions no tiene RLS)", async () => {
    const { service, prisma } = buildService([]);

    await service.listGroupedByModule();

    expect(prisma.permission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: expect.anything() }),
    );
  });
});
