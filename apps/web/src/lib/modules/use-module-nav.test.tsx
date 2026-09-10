import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { useModuleNav } from "./use-module-nav";

/**
 * F9-SUPPL-09 — Proveedores es UN enlace aunque viva en dos grupos: con
 * Compras y Gastos aparece una vez, bajo Compras (el primero en `MODULE_KEYS`);
 * con solo Gastos, bajo Gastos; sin `suppliers:read`, en ninguno — y un grupo
 * que se queda sin links no se pinta.
 */
const usuario = (modules: AuthUser["subscription"]["modules"], permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules } });

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={createI18n()}>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  </I18nextProvider>
);

const grupos = () => renderHook(() => useModuleNav(), { wrapper }).result.current;

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("useModuleNav — el enlace compartido de Proveedores (F9-SUPPL-09)", () => {
  it("con Compras y Gastos, Proveedores sale UNA vez, bajo Compras", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["purchases", "expenses"], ["suppliers:read"]));
    const resultado = grupos();
    expect(resultado.map((g) => g.key)).toEqual(["purchases"]);
    expect(resultado[0]?.links.map((l) => l.to)).toEqual(["/suppliers"]);
    expect(resultado[0]?.links[0]?.label).toBe("Proveedores");
  });

  it("con solo Gastos, sale bajo Gastos con la MISMA etiqueta", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["expenses"], ["suppliers:read"]));
    const resultado = grupos();
    expect(resultado.map((g) => g.key)).toEqual(["expenses"]);
    expect(resultado[0]?.links[0]?.label).toBe("Proveedores");
  });

  it("sin suppliers:read no sale en ninguno, y los grupos vacíos no se pintan", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["purchases", "expenses"], ["products:read"]));
    expect(grupos()).toEqual([]);
  });

  it("la deduplicación es por RUTA y no toca los links de otros grupos", () => {
    useAuthStore
      .getState()
      .setAuth("jwt", usuario(["reception", "purchases"], ["reception:read", "suppliers:read"]));
    const resultado = grupos();
    expect(resultado.map((g) => g.key)).toEqual(["reception", "purchases"]);
    expect(resultado[0]?.links.map((l) => l.to)).toEqual([
      "/reception/customers",
      "/reception/turns",
    ]);
    expect(resultado[1]?.links.map((l) => l.to)).toEqual(["/suppliers"]);
  });
});
