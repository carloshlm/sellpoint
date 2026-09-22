import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as authApi from "@/lib/auth/api";
import { createQueryClient } from "@/lib/query-client";
import * as taxApi from "@/lib/tenant/tax-api";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { TaxSettings } from "./tax-settings";

vi.mock("@/lib/tenant/tax-api", () => ({
  getTaxSettings: vi.fn(),
  updateTaxSettings: vi.fn(),
  deleteTaxGroup: vi.fn(),
}));
// Solo `/me` se simula: el refresco de la sesión corre de verdad, igual que en
// el navegador, y lo que se comprueba es lo que queda en el store.
vi.mock("@/lib/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/api")>()),
  getMe: vi.fn(),
}));

/**
 * Carlos, 2026-09-22: cambiaba en Mi perfil si el costo lleva impuesto, iba a
 * dar de alta un producto y el formulario seguía con el modo viejo hasta
 * recargar. Los formularios de producto, servicio y estudio leen los dos modos
 * de la SESIÓN (`user.tenant`), así que guardar un modo tiene que refrescarla —
 * el del precio lo hacía (F4-TAX-14) y el del costo, nacido después
 * (F9-COSTMODE), se quedó fuera.
 */
describe("guardar un modo de impuesto refresca la sesión, sin recargar", () => {
  const inicial = (): AuthUser =>
    buildAuthUser({
      permissions: ["tenants:manage"],
      tenant: buildTenantBlock({ country: "MX", taxMode: "excluded", costTaxMode: "excluded" }),
    });

  beforeEach(() => {
    useAuthStore.getState().setAuth("jwt", inicial());
    vi.mocked(taxApi.getTaxSettings).mockResolvedValue({
      mode: "excluded",
      costMode: "excluded",
      country: "MX",
      region: null,
      needsRegion: false,
      hasSales: false,
      hasCosts: false,
      groups: [],
    });
    vi.mocked(taxApi.updateTaxSettings).mockImplementation(async (input) => ({
      ...(await vi.mocked(taxApi.getTaxSettings)()),
      ...(input.mode !== undefined && { mode: input.mode }),
      ...(input.costMode !== undefined && { costMode: input.costMode }),
    }));
  });

  afterEach(() => {
    useAuthStore.getState().clearAuth();
    vi.clearAllMocks();
  });

  function renderCard() {
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <TaxSettings user={inicial()} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
  }

  it("el modo del COSTO: la sesión queda con «con impuesto» al instante", async () => {
    vi.mocked(authApi.getMe).mockResolvedValue({
      ...inicial(),
      tenant: { ...inicial().tenant, costTaxMode: "included" },
    });
    renderCard();
    await userEvent.click(await screen.findByRole("radio", { name: /lo que pagué en mostrador/i }));
    await waitFor(() => expect(useAuthStore.getState().user?.tenant.costTaxMode).toBe("included"));
  });

  it("el modo del PRECIO: la sesión queda con «incluido» al instante", async () => {
    vi.mocked(authApi.getMe).mockResolvedValue({
      ...inicial(),
      tenant: { ...inicial().tenant, taxMode: "included" },
    });
    renderCard();
    await userEvent.click(await screen.findByRole("radio", { name: /precio final al público/i }));
    await waitFor(() => expect(useAuthStore.getState().user?.tenant.taxMode).toBe("included"));
  });
});
