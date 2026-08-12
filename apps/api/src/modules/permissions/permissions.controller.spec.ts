import { PermissionsController } from "./permissions.controller";
import type { PermissionGroup, PermissionsService } from "./permissions.service";

const GROUPS: PermissionGroup[] = [
  { module: "users", permissions: [{ code: "users:read", description: null }] },
];

describe("PermissionsController.list (F1-RBAC-05)", () => {
  it("delega en PermissionsService.listGroupedByModule", async () => {
    const permissionsService = {
      listGroupedByModule: jest.fn().mockResolvedValue(GROUPS),
    } as unknown as PermissionsService;
    const controller = new PermissionsController(permissionsService);

    const result = await controller.list();

    expect(permissionsService.listGroupedByModule).toHaveBeenCalled();
    expect(result).toBe(GROUPS);
  });
});
