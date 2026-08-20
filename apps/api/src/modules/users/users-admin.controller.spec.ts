import type { AuthUser } from "../auth/types/auth-user";
import { UsersAdminController } from "./users-admin.controller";
import type { UserDetail, UsersAdminService } from "./users-admin.service";
import type { WarehouseScopeService } from "./warehouse-scope.service";

const ACTOR: AuthUser = {
  userId: "actor-1",
  tenantId: "tenant-1",
  permissions: ["users:manage", "users:read"],
  locale: "es",
};

const DETAIL: UserDetail = {
  id: "user-2",
  email: "x@example.com",
  firstName: "Bruno",
  lastNamePaternal: "Díaz",
  lastNameMaternal: null,
  status: "invited",
  locale: "es",
  defaultWarehouseId: null,
  roles: [],
};

function buildController(overrides?: Partial<Record<keyof UsersAdminService, jest.Mock>>) {
  const usersAdminService = {
    create: jest.fn().mockResolvedValue(DETAIL),
    list: jest.fn().mockResolvedValue([DETAIL]),
    findOne: jest.fn().mockResolvedValue(DETAIL),
    update: jest.fn().mockResolvedValue(DETAIL),
    suspend: jest.fn().mockResolvedValue({ ...DETAIL, status: "suspended" }),
    reactivate: jest.fn().mockResolvedValue({ ...DETAIL, status: "active" }),
    resendInvitation: jest.fn().mockResolvedValue(DETAIL),
    ...overrides,
  } as unknown as UsersAdminService;

  /**
   * El controller ganó `WarehouseScopeService` en F2-SCOPE-02 y este spec
   * siguió construyéndolo con UN argumento: los tests pasaban porque ninguno
   * tocaba el alcance —quedaba `undefined`—, así que los dos endpoints de
   * scope no tenían cobertura acá. Lo destapó `pnpm typecheck:full`.
   */
  const warehouseScopeService = {
    get: jest.fn().mockResolvedValue(["wh-1"]),
    replace: jest.fn().mockResolvedValue(["wh-1", "wh-2"]),
  } as unknown as WarehouseScopeService;

  const controller = new UsersAdminController(usersAdminService, warehouseScopeService);
  const request = { ip: "1.2.3.4", headers: { "user-agent": "jest" } } as never;
  return { controller, usersAdminService, warehouseScopeService, request };
}

describe("UsersAdminController (F1-RBAC-03)", () => {
  it("POST /users delega en UsersAdminService.create", async () => {
    const { controller, usersAdminService, request } = buildController();
    const dto = {
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      roleIds: ["role-1"],
    };

    await controller.create(dto, ACTOR, request);

    expect(usersAdminService.create).toHaveBeenCalledWith(ACTOR, dto, {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
  });

  it("GET /users delega en UsersAdminService.list", async () => {
    const { controller, usersAdminService } = buildController();

    const result = await controller.list(ACTOR);

    expect(usersAdminService.list).toHaveBeenCalledWith(ACTOR);
    expect(result).toEqual([DETAIL]);
  });

  it("GET /users/:id delega en UsersAdminService.findOne", async () => {
    const { controller, usersAdminService } = buildController();

    await controller.findOne("user-2", ACTOR);

    expect(usersAdminService.findOne).toHaveBeenCalledWith(ACTOR, "user-2");
  });

  it("PATCH /users/:id delega en UsersAdminService.update", async () => {
    const { controller, usersAdminService, request } = buildController();

    await controller.update("user-2", { locale: "en" }, ACTOR, request);

    expect(usersAdminService.update).toHaveBeenCalledWith(
      ACTOR,
      "user-2",
      { locale: "en" },
      {
        ip: "1.2.3.4",
        userAgent: "jest",
      },
    );
  });

  it("POST /users/:id/suspend delega en UsersAdminService.suspend", async () => {
    const { controller, usersAdminService, request } = buildController();

    const result = await controller.suspend("user-2", ACTOR, request);

    expect(usersAdminService.suspend).toHaveBeenCalledWith(ACTOR, "user-2", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(result.status).toBe("suspended");
  });

  it("POST /users/:id/resend-invitation delega en UsersAdminService.resendInvitation (gap S1)", async () => {
    const { controller, usersAdminService, request } = buildController();

    const result = await controller.resendInvitation("user-2", ACTOR, request);

    expect(usersAdminService.resendInvitation).toHaveBeenCalledWith(ACTOR, "user-2", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(result.status).toBe("invited");
  });

  it("POST /users/:id/reactivate delega en UsersAdminService.reactivate", async () => {
    const { controller, usersAdminService, request } = buildController();

    const result = await controller.reactivate("user-2", ACTOR, request);

    expect(usersAdminService.reactivate).toHaveBeenCalledWith(ACTOR, "user-2", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    expect(result.status).toBe("active");
  });

  // F2-SCOPE-02. Sin cobertura hasta hoy: el spec construía el controller sin
  // `WarehouseScopeService` y nadie lo notó porque los tests no lo tocaban.
  it("GET /users/:id/warehouse-scope delega en WarehouseScopeService.get", async () => {
    const { controller, warehouseScopeService } = buildController();

    const result = await controller.getWarehouseScope("user-2", ACTOR);

    expect(warehouseScopeService.get).toHaveBeenCalledWith(ACTOR, "user-2");
    expect(result).toEqual(["wh-1"]);
  });

  it("PUT /users/:id/warehouse-scope reemplaza la lista COMPLETA, no agrega", async () => {
    const { controller, warehouseScopeService, request } = buildController();

    await controller.replaceWarehouseScope(
      "user-2",
      { warehouseIds: ["wh-1", "wh-2"] },
      ACTOR,
      request,
    );

    expect(warehouseScopeService.replace).toHaveBeenCalledWith(ACTOR, "user-2", ["wh-1", "wh-2"], {
      ip: "1.2.3.4",
      userAgent: "jest",
    });
  });
});
