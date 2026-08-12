import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthUser } from "../types/auth-user";
import { PermissionsGuard } from "./permissions.guard";

function buildContext(user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function buildGuard(required?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;

  return { guard: new PermissionsGuard(reflector), reflector };
}

function userWith(permissions: string[]): AuthUser {
  return { userId: "user-1", tenantId: "tenant-1", permissions, locale: "es" };
}

describe("PermissionsGuard (F1-RBAC-01)", () => {
  it("sin metadata de permisos, deja pasar (el endpoint solo exige estar autenticado)", () => {
    const { guard } = buildGuard(undefined);

    expect(guard.canActivate(buildContext(userWith([])))).toBe(true);
  });

  it("con metadata vacía, deja pasar", () => {
    const { guard } = buildGuard([]);

    expect(guard.canActivate(buildContext(userWith([])))).toBe(true);
  });

  it("usuario CON el permiso requerido, pasa", () => {
    const { guard } = buildGuard(["users:manage"]);

    expect(guard.canActivate(buildContext(userWith(["users:manage", "users:read"])))).toBe(true);
  });

  it("usuario SIN el permiso requerido → 403 con clave i18n traducible", () => {
    const { guard } = buildGuard(["users:manage"]);

    expect(() => guard.canActivate(buildContext(userWith(["users:read"])))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(buildContext(userWith(["users:read"])))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ message: "auth.forbidden" }),
      }),
    );
  });

  it("semántica AND: con permisos requeridos múltiples, tener SOLO uno no alcanza", () => {
    const { guard } = buildGuard(["users:manage", "roles:manage"]);

    expect(() => guard.canActivate(buildContext(userWith(["users:manage"])))).toThrow(
      ForbiddenException,
    );
  });

  it("semántica AND: teniendo TODOS los requeridos, pasa", () => {
    const { guard } = buildGuard(["users:manage", "roles:manage"]);

    expect(
      guard.canActivate(buildContext(userWith(["users:manage", "roles:manage", "pos:sell"]))),
    ).toBe(true);
  });

  it("request sin user (el JwtAuthGuard debería haberlo puesto) → 403, nunca pasa por defecto", () => {
    const { guard } = buildGuard(["users:manage"]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
  });

  it("un JWT con permissions:[] (tenant sin catálogo sembrado) NO pasa un endpoint protegido", () => {
    const { guard } = buildGuard(["users:manage"]);

    expect(() => guard.canActivate(buildContext(userWith([])))).toThrow(ForbiddenException);
  });
});
