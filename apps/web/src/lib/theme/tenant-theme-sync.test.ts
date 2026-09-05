import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { applyTheme } from "./apply-theme";
import { installTenantThemeSync } from "./tenant-theme-sync";

/**
 * El tema de la cuenta manda apenas se conoce — gemelo de
 * `installAccountLanguageSync` y con las mismas guardas.
 */
const userWithTheme = (theme: string | null): AuthUser => ({
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
    theme,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

describe("installTenantThemeSync", () => {
  let uninstall: () => void;

  beforeEach(() => {
    useAuthStore.getState().clearAuth();
    applyTheme("light");
    uninstall = installTenantThemeSync();
  });

  afterEach(() => {
    uninstall();
    useAuthStore.getState().clearAuth();
  });

  it("al entrar la sesión, aplica el tema del negocio", () => {
    useAuthStore.getState().setAuth("jwt", userWithTheme("sand"));

    expect(document.documentElement.dataset.theme).toBe("sand");
  });

  it("un tenant sin tema elegido cae al claro", () => {
    applyTheme("grape");
    useAuthStore.getState().setAuth("jwt", userWithTheme(null));

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("cerrar sesión NO revierte: sin fogonazo camino al login", () => {
    useAuthStore.getState().setAuth("jwt", userWithTheme("dark"));
    useAuthStore.getState().clearAuth();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("un cambio de store que no toca el tema no pisa una vista previa optimista", () => {
    const user = userWithTheme("sand");
    useAuthStore.getState().setAuth("jwt", user);
    // El wizard/perfil aplican en vivo ANTES del PATCH:
    applyTheme("grape");
    // Un resync que trae el MISMO tema no debe revertir la vista previa.
    useAuthStore.getState().setUser({ ...user });

    expect(document.documentElement.dataset.theme).toBe("grape");
  });
});
