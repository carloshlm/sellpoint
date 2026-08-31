import { act, renderHook } from "@testing-library/react";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { hasPermission, usePermissions } from "./permissions";

/**
 * F1-WEB-USERS WU2 (D1 del design): `hasPermission` es la función PURA que
 * gatea nav/rutas/botones. `usePermissions()` es el wrapper reactivo sobre
 * el store — nav y ruta leen `:read`; `canManage` viaja como PROP a los
 * presentacionales, nunca leído directo del store por ellos.
 */

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    locale: "es",
    permissions: [],
    subscription: SUBSCRIPTION_PLUS,
    tenant: {
      id: "tenant-1",
      name: "Acme",
      legalName: null,
      taxId: null,
      phone: null,
      theme: null,
      address: null,
      timezone: "America/Mexico_City",
      currency: "MXN",
      templateChoice: null,
      country: "MX",
      onboarded: true,
      sellWithoutStock: false,
      usesLocations: false,
    },
    ...overrides,
  };
}

describe("hasPermission (función pura)", () => {
  it("sin sesión (null) nunca tiene ningún permiso", () => {
    expect(hasPermission(null, "users:read")).toBe(false);
  });

  it("false si el usuario no tiene ese code", () => {
    expect(hasPermission(user({ permissions: ["roles:read"] }), "users:read")).toBe(false);
  });

  it("true si el usuario tiene ese code exacto", () => {
    expect(hasPermission(user({ permissions: ["users:read"] }), "users:read")).toBe(true);
  });
});

describe("usePermissions()", () => {
  afterEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("has(code) refleja los permisos del usuario en el store", () => {
    act(() => {
      useAuthStore
        .getState()
        .setAuth("token", user({ permissions: ["users:read", "users:manage"] }));
    });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.has("users:read")).toBe(true);
    expect(result.current.has("users:manage")).toBe(true);
    expect(result.current.has("roles:manage")).toBe(false);
  });

  it("sin sesión, has(code) siempre es false", () => {
    const { result } = renderHook(() => usePermissions());

    expect(result.current.has("users:read")).toBe(false);
  });
});
