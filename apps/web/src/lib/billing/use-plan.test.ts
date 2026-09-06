import { renderHook } from "@testing-library/react";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { usePlan } from "./use-plan";

/**
 * F9-MOD-07 — `hasModule` responde si el negocio tiene activo un módulo
 * avanzado. Fail-closed como `hasFeature`: sin sesión, nada.
 */
const usuario = (modules: AuthUser["subscription"]["modules"]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: [],
  subscription: { ...SUBSCRIPTION_PLUS, modules },
  tenant: buildTenantBlock(),
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("usePlan().hasModule (F9-MOD-07)", () => {
  it("sin sesión responde false: fail-closed", () => {
    const { result } = renderHook(() => usePlan());
    expect(result.current.modules).toEqual([]);
    expect(result.current.hasModule("reception")).toBe(false);
  });

  it("con el módulo en la sesión responde true", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["reception"]));
    const { result } = renderHook(() => usePlan());
    expect(result.current.modules).toEqual(["reception"]);
    expect(result.current.hasModule("reception")).toBe(true);
  });

  it("con la lista vacía responde false", () => {
    useAuthStore.getState().setAuth("jwt", usuario([]));
    const { result } = renderHook(() => usePlan());
    expect(result.current.hasModule("reception")).toBe(false);
  });
});
