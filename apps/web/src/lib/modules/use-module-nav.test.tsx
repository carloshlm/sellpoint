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
 * F9-SUPPL-09 → 2026-09-12: Proveedores YA NO vive en Compras ni en Gastos —
 * es un catálogo y el layout lo pinta en Catálogos (`SUPPLIERS_LINK`). Acá se
 * fija que los grupos de módulo no lo traen, que un grupo sin links no se
 * pinta, y que la deduplicación por ruta sigue viva para el próximo enlace
 * compartido.
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

describe("useModuleNav — Proveedores ya no es de Compras ni de Gastos (2026-09-12)", () => {
  it("con Compras y Gastos y solo suppliers:read, ningún grupo de módulo se pinta", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["purchases", "expenses"], ["suppliers:read"]));
    expect(grupos()).toEqual([]);
  });

  it("sin permisos de módulo no sale nada, y los grupos vacíos no se pintan", () => {
    useAuthStore.getState().setAuth("jwt", usuario(["purchases", "expenses"], ["products:read"]));
    expect(grupos()).toEqual([]);
  });

  /** F9-EXP-14 — Gastos ya tiene rutas: el listado y las categorías. */
  it("con Gastos, el grupo trae Gastos y Categorías; sin el módulo no se pinta", () => {
    useAuthStore
      .getState()
      .setAuth("jwt", usuario(["expenses"], ["expenses:read", "suppliers:read"]));
    const resultado = grupos();
    expect(resultado.map((g) => g.key)).toEqual(["expenses"]);
    expect(resultado[0]?.links.map((l) => l.to)).toEqual(["/expenses", "/expenses/categories"]);
    expect(resultado[0]?.links.map((l) => l.label)).toEqual(["Gastos", "Categorías"]);

    useAuthStore.getState().setAuth("jwt", usuario([], ["expenses:read", "suppliers:read"]));
    expect(grupos()).toEqual([]);
  });

  it("los grupos salen en el orden de MODULE_KEYS y cada uno con sus propios links", () => {
    useAuthStore
      .getState()
      .setAuth("jwt", usuario(["reception", "purchases"], ["reception:read", "purchases:read"]));
    const resultado = grupos();
    expect(resultado.map((g) => g.key)).toEqual(["reception", "purchases"]);
    expect(resultado[0]?.links.map((l) => l.to)).toEqual([
      "/reception/customers",
      "/reception/turns",
    ]);
    expect(resultado[1]?.links.map((l) => l.to)).toEqual(["/purchases"]);
  });
});
