import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY, RequirePermissions } from "./require-permissions.decorator";

describe("@RequirePermissions (F1-RBAC-02)", () => {
  const reflector = new Reflector();

  it("setea la metadata que lee el PermissionsGuard", () => {
    class Controller {
      @RequirePermissions("users:manage")
      handler() {}
    }

    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.handler)).toEqual(["users:manage"]);
  });

  it("acepta varios permisos (semántica AND en el guard)", () => {
    class Controller {
      @RequirePermissions("users:manage", "roles:manage")
      handler() {}
    }

    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.handler)).toEqual([
      "users:manage",
      "roles:manage",
    ]);
  });

  it("aplicado a una clase, la metadata queda en la clase", () => {
    @RequirePermissions("roles:read")
    class Controller {}

    expect(reflector.get(PERMISSIONS_KEY, Controller)).toEqual(["roles:read"]);
  });
});
