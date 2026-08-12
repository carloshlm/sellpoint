import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../auth/types/auth-user";
import { assertNoRoleAssignmentEscalation } from "./role-assignment-guard";

function actor(permissions: string[]): AuthUser {
  return { userId: "actor-1", tenantId: "tenant-1", permissions, locale: "es" };
}

function role(id: string, permissionCodes: string[]) {
  return { id, permissionCodes };
}

describe("assertNoRoleAssignmentEscalation (W1b hardening, verify #274 pasada 2)", () => {
  it("no tira si no hay roles agregados (lista vacía)", () => {
    expect(() => assertNoRoleAssignmentEscalation(actor(["users:manage"]), [])).not.toThrow();
  });

  it("no tira si el actor posee TODOS los permisos de los roles agregados", () => {
    const addedRoles = [role("role-1", ["roles:manage", "users:manage"])];
    expect(() =>
      assertNoRoleAssignmentEscalation(
        actor(["roles:manage", "users:manage", "users:read"]),
        addedRoles,
      ),
    ).not.toThrow();
  });

  it("403 roles.cannot_grant_unheld_permission si el actor NO posee alguno de los permisos del rol agregado", () => {
    // Repro exacto del verify #274 pasada 2: actor con SOLO users:manage
    // (sin roles:manage) intenta asignarse un rol que otorga roles:manage.
    const addedRoles = [role("tenant-admin", ["roles:manage", "users:manage"])];
    expect(() =>
      assertNoRoleAssignmentEscalation(actor(["users:manage", "users:read"]), addedRoles),
    ).toThrow(ForbiddenException);
  });

  it("el mensaje distingue que es un ROL, no un permiso suelto", () => {
    const addedRoles = [role("tenant-admin", ["roles:manage"])];
    try {
      assertNoRoleAssignmentEscalation(actor(["users:manage"]), addedRoles);
      throw new Error("no debería llegar acá");
    } catch (error) {
      expect(error).toMatchObject({
        response: { message: "users.cannot_assign_unheld_role_permission" },
      });
    }
  });

  it("evalúa la UNIÓN de permisos de TODOS los roles agregados, no uno por uno", () => {
    // Ninguno de los dos roles agregados por sí solo excede al actor, pero
    // la UNIÓN sí (roles:manage viene de uno, algo que el actor no tiene
    // viene del otro).
    const addedRoles = [role("r1", ["users:read"]), role("r2", ["roles:manage"])];
    expect(() => assertNoRoleAssignmentEscalation(actor(["users:read"]), addedRoles)).toThrow(
      ForbiddenException,
    );
  });
});
