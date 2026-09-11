import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as taxApi from "@/lib/tenant/tax-api";
import type { AuthUser } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { TaxSettings } from "./tax-settings";

vi.mock("@/lib/tenant/tax-api", () => ({
  getTaxSettings: vi.fn(),
  updateTaxSettings: vi.fn(),
  deleteTaxGroup: vi.fn(),
}));
vi.mock("@/lib/auth/session-resync", () => ({
  resyncSession: vi.fn().mockResolvedValue(undefined),
}));
const mocked = vi.mocked(taxApi);

/**
 * F4-TAX-14 — «Impuestos» en Mi perfil: solo con `tenants:manage`; pinta lo
 * del API; el modo se guarda al elegirlo y manda SOLO el modo; marcar otro
 * default manda un solo `isDefault`; la tasa se valida en el cliente; y el
 * 409 de borrar se explica.
 */
const user = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, tenant: buildTenantBlock({ country: "CA" }) });

const vista = (): taxApi.TaxSettingsView => ({
  mode: "excluded",
  costMode: "excluded",
  country: "CA",
  region: "BC",
  needsRegion: true,
  hasSales: true,
  hasCosts: false,
  groups: [
    {
      id: "g1",
      code: "GST_PST",
      name: "GST 5% + PST 7%",
      isDefault: true,
      isActive: true,
      sortOrder: 0,
      usageCount: 3,
      rates: [
        { code: "GST", name: "GST 5%", rate: "5" },
        { code: "PST", name: "PST 7%", rate: "7" },
      ],
    },
    {
      id: "g2",
      code: "EXEMPT",
      name: "Exempt",
      isDefault: false,
      isActive: true,
      sortOrder: 1,
      usageCount: 0,
      rates: [],
    },
  ],
});

function renderCard(u: AuthUser) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <TaxSettings user={u} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mocked.getTaxSettings.mockResolvedValue(vista());
  mocked.updateTaxSettings.mockImplementation(async (input) => ({
    ...vista(),
    ...(input.mode !== undefined && { mode: input.mode }),
    ...(input.costMode !== undefined && { costMode: input.costMode }),
  }));
  mocked.deleteTaxGroup.mockResolvedValue(vista());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("«Impuestos» en Mi perfil (F4-TAX-14)", () => {
  it("sin tenants:manage no se pinta ni se pide", () => {
    renderCard(user(["pos:sell"]));
    expect(screen.queryByTestId("tax-settings")).not.toBeInTheDocument();
    expect(mocked.getTaxSettings).not.toHaveBeenCalled();
  });

  it("pinta el modo, la provincia, los grupos con sus componentes y cuántos artículos los usan", async () => {
    renderCard(user(["tenants:manage"]));
    const tarjeta = await screen.findByTestId("tax-settings");
    expect(within(tarjeta).getByText("Impuestos")).toBeVisible();
    await waitFor(() => expect(screen.getAllByTestId("tax-group")).toHaveLength(2));
    expect(screen.getByRole("radio", { name: /el impuesto se agrega al cobrar/i })).toBeChecked();
    expect(screen.getByLabelText("Provincia o estado")).toHaveValue("BC");
    expect(screen.getByText("Lo usan 3 artículos")).toBeInTheDocument();
    expect(screen.getByText(/Ya tienes ventas registradas/)).toBeInTheDocument();
    const primero = screen.getAllByTestId("tax-group")[0] as HTMLElement;
    expect(
      within(primero)
        .getAllByLabelText("Tasa (%)")
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(["5", "7"]);
  });

  it("cambiar el modo manda {mode} y solo eso", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await usuario.click(
      await screen.findByRole("radio", { name: /ya trae el impuesto|precio final/i }),
    );
    await waitFor(() =>
      expect(mocked.updateTaxSettings).toHaveBeenCalledWith({ mode: "included" }),
    );
  });

  /**
   * F9-COSTMODE-03 — el segundo interruptor: su propio grupo de radios (elegir
   * uno no desmarca el del precio), manda SOLO `costMode`, y avisa cuando ya
   * hay costos capturados (el número no se convierte, cambia su lectura).
   */
  it("el modo del costo es otro grupo de radios: elegir «con impuesto» manda {costMode} y deja el del precio como estaba", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const conImpuesto = await screen.findByRole("radio", { name: /lo que pagué en mostrador/i });
    const precioSinImpuesto = screen.getByRole("radio", {
      name: /el impuesto se agrega al cobrar/i,
    });
    expect(conImpuesto).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /antes del impuesto/i })).toBeChecked();
    expect((conImpuesto as HTMLInputElement).name).not.toBe(
      (precioSinImpuesto as HTMLInputElement).name,
    );

    await usuario.click(conImpuesto);
    await waitFor(() =>
      expect(mocked.updateTaxSettings).toHaveBeenCalledWith({ costMode: "included" }),
    );
    expect(mocked.updateTaxSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(conImpuesto).toBeChecked());
    expect(precioSinImpuesto).toBeChecked();
    expect(screen.queryByText(/Ya tienes costos capturados/)).not.toBeInTheDocument();
  });

  it("con costos capturados, el interruptor del costo avisa que no convierte nada", async () => {
    mocked.getTaxSettings.mockResolvedValue({ ...vista(), hasCosts: true });
    renderCard(user(["tenants:manage"]));
    expect(await screen.findByText(/Ya tienes costos capturados/)).toBeInTheDocument();
  });

  it("marcar otro grupo como predeterminado y guardar manda un solo isDefault", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("tax-group")).toHaveLength(2));
    const segundo = screen.getAllByTestId("tax-group")[1] as HTMLElement;
    await usuario.click(within(segundo).getByRole("radio", { name: "Predeterminado" }));
    await usuario.click(screen.getByRole("button", { name: "Guardar impuestos" }));
    await waitFor(() => expect(mocked.updateTaxSettings).toHaveBeenCalled());
    const enviado = mocked.updateTaxSettings.mock.calls[0]?.[0];
    expect(enviado?.mode).toBeUndefined();
    expect(enviado?.groups?.map((g) => [g.code, g.isDefault])).toEqual([
      ["GST_PST", false],
      ["EXEMPT", true],
    ]);
    expect(await screen.findByText("Impuestos guardados.")).toBeVisible();
  });

  it("una tasa de tres decimales se acepta; una de cinco se rechaza en el cliente, sin llamar al API", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("tax-group")).toHaveLength(2));
    const primero = screen.getAllByTestId("tax-group")[0] as HTMLElement;
    const [gst] = within(primero).getAllByLabelText("Tasa (%)");
    await usuario.clear(gst as HTMLElement);
    await usuario.type(gst as HTMLElement, "9.97500");
    await usuario.click(screen.getByRole("button", { name: "Guardar impuestos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hasta cuatro decimales");
    expect(mocked.updateTaxSettings).not.toHaveBeenCalled();

    await usuario.clear(gst as HTMLElement);
    await usuario.type(gst as HTMLElement, "9.975");
    await usuario.click(screen.getByRole("button", { name: "Guardar impuestos" }));
    await waitFor(() => expect(mocked.updateTaxSettings).toHaveBeenCalled());
    expect(mocked.updateTaxSettings.mock.calls[0]?.[0].groups?.[0]?.rates[0]?.rate).toBe("9.975");
  });

  it("borrar un grupo en uso: el 409 del API se explica en pantalla", async () => {
    mocked.deleteTaxGroup.mockRejectedValue({
      statusCode: 409,
      message: "No se puede borrar: lo usan 3 artículos.",
      error: "Conflict",
      code: "tenants.tax_group_in_use",
    });
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("tax-group")).toHaveLength(2));
    const primero = screen.getAllByTestId("tax-group")[0] as HTMLElement;
    await usuario.click(within(primero).getByRole("button", { name: "Borrar grupo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("lo usan 3 artículos");
    expect(mocked.deleteTaxGroup).toHaveBeenCalledWith("GST_PST");
  });
});
