import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as settingsApi from "@/lib/reception/settings-api";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { ReceptionSettings } from "./reception-settings";

vi.mock("@/lib/reception/settings-api", () => ({
  getReceptionSettings: vi.fn(),
  updateReceptionSettings: vi.fn(),
}));
const mocked = vi.mocked(settingsApi);

/**
 * F9-RECEP-18 — «Configuración Recepción» en Mi perfil: solo con el módulo
 * y `tenants:manage`; la palabra es UNA, sin espacios, y se previsualiza ya
 * Capitalizada; las dos entradas del menú se apagan por separado; Guardar
 * manda SOLO lo que cambió.
 */
const user = (modules: AuthUser["subscription"]["modules"], permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, modules },
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
    sellWithoutStock: false,
    usesLocations: false,
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

function renderCard(u: AuthUser) {
  // El hook de la entidad lee el módulo del store, no de la prop.
  useAuthStore.getState().setAuth("jwt-demo", u);
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <ReceptionSettings user={u} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mocked.getReceptionSettings.mockResolvedValue({
    customerLabel: null,
    showCustomers: true,
    showTurns: true,
  });
  mocked.updateReceptionSettings.mockImplementation(async (input) => ({
    customerLabel: null,
    showCustomers: true,
    showTurns: true,
    ...input,
  }));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("«Configuración Recepción» en Mi perfil (F9-RECEP-18)", () => {
  it("sin el módulo no se pinta ni se pide", () => {
    renderCard(user([], ["tenants:manage"]));
    expect(screen.queryByTestId("reception-settings")).not.toBeInTheDocument();
    expect(mocked.getReceptionSettings).not.toHaveBeenCalled();
  });

  it("con el módulo pero sin tenants:manage tampoco", () => {
    renderCard(user(["reception"], ["reception:manage"]));
    expect(screen.queryByTestId("reception-settings")).not.toBeInTheDocument();
  });

  it("marcar «Personalizar» abre el campo; la palabra se previsualiza Capitalizada y Guardar manda solo eso", async () => {
    renderCard(user(["reception"], ["tenants:manage"]));
    const tarjeta = await screen.findByTestId("reception-settings");
    expect(within(tarjeta).getByText("Configuración Recepción")).toBeVisible();
    // El formulario aparece cuando llega la configuración.
    const personalizar = await screen.findByLabelText("Personalizar la palabra «Cliente»");
    // Sin personalizar no hay campo de palabra.
    expect(screen.queryByLabelText("Palabra")).not.toBeInTheDocument();

    const usuario = userEvent.setup();
    await usuario.click(personalizar);
    const campo = screen.getByLabelText("Palabra");
    await usuario.type(campo, "pACIENTE");
    expect(
      screen.getByText("Una sola palabra, sin espacios. Se guarda como «Paciente»."),
    ).toBeVisible();
    // Las casillas del menú ya hablan con la palabra nueva.
    expect(screen.getByLabelText("Registro de paciente")).toBeChecked();

    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateReceptionSettings).toHaveBeenCalledWith({ customerLabel: "Paciente" }),
    );
    expect(await screen.findByText("Configuración guardada.")).toBeVisible();
  });

  it("el campo no admite espacios: se escriben y desaparecen", async () => {
    renderCard(user(["reception"], ["tenants:manage"]));
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByLabelText("Personalizar la palabra «Cliente»"));
    await usuario.type(screen.getByLabelText("Palabra"), "pa ciente");
    expect(screen.getByLabelText("Palabra")).toHaveValue("paciente");
  });

  it("con palabra guardada, desmarcar «Personalizar» y Guardar vuelve a la de fábrica (null)", async () => {
    mocked.getReceptionSettings.mockResolvedValue({
      customerLabel: "Paciente",
      showCustomers: true,
      showTurns: true,
    });
    renderCard(user(["reception"], ["tenants:manage"]));
    await screen.findByTestId("reception-settings");
    const personalizar = await screen.findByLabelText("Personalizar la palabra «Cliente»");
    await waitFor(() => expect(personalizar).toBeChecked());
    expect(screen.getByLabelText("Palabra")).toHaveValue("Paciente");
    const usuario = userEvent.setup();
    await usuario.click(personalizar);
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateReceptionSettings).toHaveBeenCalledWith({ customerLabel: null }),
    );
  });

  it("apagar «Generar turno» manda solo showTurns", async () => {
    renderCard(user(["reception"], ["tenants:manage"]));
    await screen.findByTestId("reception-settings");
    const usuario = userEvent.setup();
    const turnos = await screen.findByLabelText("Generar turno");
    await waitFor(() => expect(turnos).toBeChecked());
    await usuario.click(turnos);
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateReceptionSettings).toHaveBeenCalledWith({ showTurns: false }),
    );
  });

  it("una palabra inválida no se manda y se dice por qué", async () => {
    renderCard(user(["reception"], ["tenants:manage"]));
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByLabelText("Personalizar la palabra «Cliente»"));
    // Personalizar marcado y palabra vacía: no hay nada válido que guardar.
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribe una sola palabra, sin espacios.",
    );
    expect(mocked.updateReceptionSettings).not.toHaveBeenCalled();
  });
});
