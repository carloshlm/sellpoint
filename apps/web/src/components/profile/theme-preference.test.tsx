import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as tenantApi from "@/lib/tenant/api";
import { applyTheme } from "@/lib/theme/apply-theme";
import type { AuthUser } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { ThemePreference } from "./theme-preference";

/**
 * El tema desde Mi perfil (Carlos, 2026-08-26): optimista de verdad — el
 * clic re-pinta al momento y el PATCH viaja detrás; el rechazo REVIERTE.
 */
vi.mock("@/lib/tenant/api", async (importOriginal) => ({
  ...(await importOriginal<typeof tenantApi>()),
  updateMyTenant: vi.fn(),
}));
vi.mock("@/lib/auth/session-resync", () => ({
  resyncSession: vi.fn().mockResolvedValue(undefined),
}));

const mockedUpdate = vi.mocked(tenantApi.updateMyTenant);

const demoUser = (permissions: string[], theme: string | null = null): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
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

function renderCard(user: AuthUser) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <ThemePreference user={user} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedUpdate.mockReset();
  applyTheme("light");
});

describe("El tema desde Mi perfil (2026-08-26)", () => {
  it("sin tenants:manage la tarjeta no existe: el tema es del NEGOCIO", () => {
    renderCard(demoUser(["users:read"]));

    expect(screen.queryByTestId("theme-preference")).not.toBeInTheDocument();
  });

  it("muestra el tema guardado del tenant como seleccionado", () => {
    renderCard(demoUser(["tenants:manage"], "sand"));

    expect(screen.getByRole("radio", { name: "Arena" })).toBeChecked();
  });

  /** A diferencia del wizard, el perfil ofrece el catálogo COMPLETO. */
  it("ofrece los OCHO temas, segunda tanda incluida", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getAllByRole("radio")).toHaveLength(8);
    for (const nombre of ["Esmeralda", "Cabina", "Algodón", "Carbón"]) {
      expect(screen.getByRole("radio", { name: nombre })).toBeInTheDocument();
    }
  });

  it("elegir uno de la segunda tanda re-pinta y persiste igual que los básicos", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, theme: "cabin" });
    renderCard(actor);

    await user.click(screen.getByRole("radio", { name: "Cabina" }));

    expect(document.documentElement.dataset.theme).toBe("cabin");
    // Cabina es un tema OSCURO: la clase dark lo acompaña.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ theme: "cabin" });
    });
  });

  it("el clic re-pinta AL MOMENTO y manda el PATCH detrás", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, theme: "grape" });
    renderCard(actor);

    await user.click(screen.getByRole("radio", { name: "Uva" }));

    expect(document.documentElement.dataset.theme).toBe("grape");
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ theme: "grape" });
    });
  });

  it("si el servidor lo rechaza, el tema REVIERTE y el motivo se ve", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue({ statusCode: 500, message: "Algo salió mal" });
    renderCard(demoUser(["tenants:manage"]));

    await user.click(screen.getByRole("radio", { name: "Oscuro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    // La pantalla no miente un tema que no se guardó.
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(screen.getByRole("radio", { name: "Claro" })).toBeChecked();
  });
});
