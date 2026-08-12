import type { AuthUser } from "../auth/types/auth-user";
import { RolesController } from "./roles.controller";
import type { RoleSummary, RolesService } from "./roles.service";

const CURRENT_USER: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: ["roles:manage", "roles:read"],
  locale: "es",
};

const ROLE: RoleSummary = {
  id: "role-1",
  name: "Custom",
  permissionCodes: ["users:read"],
  userCount: 0,
};

function buildController(overrides?: Partial<Record<keyof RolesService, jest.Mock>>) {
  const rolesService = {
    create: jest.fn().mockResolvedValue(ROLE),
    list: jest.fn().mockResolvedValue([ROLE]),
    update: jest.fn().mockResolvedValue(ROLE),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RolesService;

  const controller = new RolesController(rolesService);
  const request = { ip: "1.2.3.4", headers: { "user-agent": "jest" } } as never;
  return { controller, rolesService, request };
}

describe("RolesController (F1-RBAC-04)", () => {
  it("POST /roles delega en RolesService.create con la meta de la request", async () => {
    const { controller, rolesService, request } = buildController();

    const result = await controller.create(
      { name: "Custom", permissionCodes: ["users:read"] },
      CURRENT_USER,
      request,
    );

    expect(rolesService.create).toHaveBeenCalledWith(
      CURRENT_USER,
      { name: "Custom", permissionCodes: ["users:read"] },
      { ip: "1.2.3.4", userAgent: "jest" },
    );
    expect(result).toBe(ROLE);
  });

  it("GET /roles delega en RolesService.list", async () => {
    const { controller, rolesService } = buildController();

    const result = await controller.list(CURRENT_USER);

    expect(rolesService.list).toHaveBeenCalledWith(CURRENT_USER);
    expect(result).toEqual([ROLE]);
  });

  it("PATCH /roles/:id delega en RolesService.update", async () => {
    const { controller, rolesService, request } = buildController();

    await controller.update("role-1", { name: "Nuevo" }, CURRENT_USER, request);

    expect(rolesService.update).toHaveBeenCalledWith(
      CURRENT_USER,
      "role-1",
      { name: "Nuevo" },
      { ip: "1.2.3.4", userAgent: "jest" },
    );
  });

  it("DELETE /roles/:id delega en RolesService.remove", async () => {
    const { controller, rolesService, request } = buildController();

    await controller.remove("role-1", CURRENT_USER, request);

    expect(rolesService.remove).toHaveBeenCalledWith(CURRENT_USER, "role-1", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
  });
});
