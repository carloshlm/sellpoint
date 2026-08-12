import { ConflictException } from "@nestjs/common";
import { assertTenantRetainsAdmin } from "./tenant-admin-guard";

function tenantAdminRole(userStatus: "active" | "invited" | "suspended") {
  return {
    permissions: [
      { permission: { code: "roles:manage" } },
      { permission: { code: "users:manage" } },
    ],
    users: [{ user: { status: userStatus } }],
  };
}

function partialAdminRole(code: "roles:manage" | "users:manage", userStatus = "active") {
  return {
    permissions: [{ permission: { code } }],
    users: [{ user: { status: userStatus } }],
  };
}

describe("assertTenantRetainsAdmin (W2 hardening, verify #274)", () => {
  it("no tira si hay un rol con roles:manage+users:manage asignado a un usuario activo", async () => {
    const tx = { role: { findMany: jest.fn().mockResolvedValue([tenantAdminRole("active")]) } };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).resolves.toBeUndefined();
  });

  it("409 roles.last_admin_protected si el único rol admin no tiene usuarios", async () => {
    const tx = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ permissions: tenantAdminRole("active").permissions, users: [] }]),
      },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toMatchObject({
      response: { message: "roles.last_admin_protected" },
    });
  });

  it("409 si el usuario del único rol admin está suspendido (no cuenta como activo)", async () => {
    const tx = {
      role: { findMany: jest.fn().mockResolvedValue([tenantAdminRole("suspended")]) },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("409 si el usuario del único rol admin está invited (nunca logueó)", async () => {
    const tx = {
      role: { findMany: jest.fn().mockResolvedValue([tenantAdminRole("invited")]) },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("409 si el rol activo tiene SOLO users:manage (le falta roles:manage) -> no es admin completo", async () => {
    const tx = {
      role: { findMany: jest.fn().mockResolvedValue([partialAdminRole("users:manage")]) },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("409 si el rol activo tiene SOLO roles:manage (le falta users:manage) -> no es admin completo", async () => {
    const tx = {
      role: { findMany: jest.fn().mockResolvedValue([partialAdminRole("roles:manage")]) },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("no tira si HAY dos roles admin y solo uno tiene usuario activo", async () => {
    const tx = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { permissions: tenantAdminRole("active").permissions, users: [] },
            tenantAdminRole("active"),
          ]),
      },
    };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).resolves.toBeUndefined();
  });

  it("409 si el tenant no tiene ningún rol", async () => {
    const tx = { role: { findMany: jest.fn().mockResolvedValue([]) } };

    await expect(assertTenantRetainsAdmin(tx as never, "tenant-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
