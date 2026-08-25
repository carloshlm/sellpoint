import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { PermissionGate } from "./permission-gate";

/**
 * D2 del design: sin el permiso requerido, el gate muestra un panel "sin
 * permiso" — NO redirige. Redirigir esconde el motivo del rebote.
 */

function user(permissions: string[]): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    locale: "es",
    permissions,
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
    },
  };
}

function renderGate(permissions: string[], need: string) {
  act(() => {
    useAuthStore.getState().setAuth("token", user(permissions));
  });
  return render(
    <I18nextProvider i18n={createI18n()}>
      <PermissionGate need={need}>
        <p data-testid="protected-content">Contenido protegido</p>
      </PermissionGate>
    </I18nextProvider>,
  );
}

describe("PermissionGate", () => {
  afterEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("sin el permiso requerido, muestra el panel 'sin permiso' y NO los children", () => {
    renderGate(["roles:read"], "users:read");

    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
  });

  it("con el permiso requerido, renderiza los children", () => {
    renderGate(["users:read"], "users:read");

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
  });
});
