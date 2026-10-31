import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as tenantApi from "@/lib/tenant/api";
import { applyTheme } from "@/lib/theme/apply-theme";
import type { AuthUser } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
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

const demoUser = (permissions: string[], theme: string | null = null): AuthUser =>
  buildAuthUser({ permissions, tenant: buildTenantBlock({ theme: theme }) });

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

  /**
   * A diferencia del wizard, el perfil ofrece el catálogo COMPLETO: los quince
   * del 2026-10-30, en el orden que pidió Carlos, con SellPointy Claro nuevo y
   * SellPointy renombrado a SellPointy Clásico.
   */
  it("ofrece los QUINCE temas en su orden, y ya no los retirados", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getAllByRole("radio")).toHaveLength(15);
    const orden = [
      "Claro",
      "Oscuro",
      "SellPointy Clásico",
      "SellPointy Claro",
      "Arena",
      "Café Expreso",
      "Esmeralda Jade",
      "Esmeralda Bosque",
      "Algodón",
      "Algodón Noche",
      "Violeta",
      "Amatista",
      "Cielo",
      "Marino",
      "Cabina",
    ];
    const radios = orden.map((nombre) => screen.getByRole("radio", { name: nombre }));
    // Cada uno va DESPUÉS del anterior en el documento: el orden es el que se ve.
    for (let i = 1; i < radios.length; i += 1) {
      expect(
        (radios[i - 1] as Node).compareDocumentPosition(radios[i] as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    for (const retirado of [
      "Uva",
      "Esmeralda",
      "Carbón",
      "Grafito Líquido",
      "Niebla Cobalto",
      "SellPointy",
    ]) {
      expect(screen.queryByRole("radio", { name: retirado })).not.toBeInTheDocument();
    }
  });

  /**
   * F10-THEME-05 — Oscuro lleva el estilo de Grafito Líquido: es oscuro y
   * además trae PIEL. Elegirlo enciende las dos clases y se guarda con su id
   * de siempre, `dark`.
   */
  it("elegir Oscuro enciende el oscuro y la piel, y lo guarda como dark", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, theme: "dark" });
    renderCard(actor);

    await user.click(screen.getByRole("radio", { name: "Oscuro" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("skinned")).toBe(true);
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ theme: "dark" });
    });
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
    mockedUpdate.mockResolvedValue({ ...actor.tenant, theme: "jade" });
    renderCard(actor);

    await user.click(screen.getByRole("radio", { name: "Esmeralda Jade" }));

    expect(document.documentElement.dataset.theme).toBe("jade");
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ theme: "jade" });
    });
  });

  it("si el servidor lo rechaza, el tema REVIERTE y el motivo se ve", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue({ statusCode: 500, message: "Algo salió mal" });
    renderCard(demoUser(["tenants:manage"]));

    await user.click(screen.getByRole("radio", { name: "Oscuro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    // La pantalla no miente un tema que no se guardó: vuelve al que tenía
    // (el negocio de prueba no eligió tema, así que el default, SellPointy Clásico).
    expect(document.documentElement.dataset.theme).toBe("sellpointy");
    expect(screen.getByRole("radio", { name: "SellPointy Clásico" })).toBeChecked();
  });
});
