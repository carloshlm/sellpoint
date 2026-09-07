import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { applyTheme } from "./apply-theme";
import { installTenantThemeSync } from "./tenant-theme-sync";

/**
 * El tema de la cuenta manda apenas se conoce — gemelo de
 * `installAccountLanguageSync` y con las mismas guardas.
 */
const userWithTheme = (theme: string | null): AuthUser =>
  buildAuthUser({ tenant: buildTenantBlock({ theme: theme }) });

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
