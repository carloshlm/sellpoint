import { TICKET_LOGO_SVG } from "@sellpoint/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as ticketApi from "@/lib/tenant/ticket-settings-api";
import type { AuthUser } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { TicketSettings } from "./ticket-settings";

vi.mock("@/lib/tenant/ticket-settings-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant/ticket-settings-api")>()),
  getTicketSettings: vi.fn(),
  updateTicketSettings: vi.fn(),
  uploadTicketLogo: vi.fn(),
  removeTicketLogo: vi.fn(),
}));
const mocked = vi.mocked(ticketApi);

/**
 * F4-TICKETCFG-08 — «Configuración del ticket» en Mi perfil: solo con
 * `tenants:manage`; seis logotipos de fábrica o una imagen propia (la vista
 * previa es lo que QUEDÓ, no el archivo original); cinco casillas de qué se
 * imprime y el mensaje del pie; Guardar manda SOLO lo que cambió.
 */
const user = (permissions: string[]): AuthUser => ({
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

const defaults = (): ticketApi.TicketSettingsView => ({
  showBusinessName: true,
  showTaxId: true,
  showAddress: true,
  showPhone: true,
  showWarehouse: true,
  footerMessage: null,
  logo: { kind: "none" },
  logoDataUrl: null,
});

function renderCard(u: AuthUser) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <TicketSettings user={u} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mocked.getTicketSettings.mockResolvedValue(defaults());
  mocked.updateTicketSettings.mockImplementation(async (input) => ({
    ...defaults(),
    ...input,
  }));
  mocked.uploadTicketLogo.mockResolvedValue({
    ...defaults(),
    logo: { kind: "custom" },
    logoDataUrl: "data:image/png;base64,QUJD",
  });
  mocked.removeTicketLogo.mockResolvedValue(defaults());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("«Configuración del ticket» en Mi perfil (F4-TICKETCFG-08)", () => {
  it("sin tenants:manage no se pinta ni se pide", () => {
    renderCard(user(["pos:sell"]));
    expect(screen.queryByTestId("ticket-settings")).not.toBeInTheDocument();
    expect(mocked.getTicketSettings).not.toHaveBeenCalled();
  });

  it("pinta los seis logotipos, las cinco casillas y el pie con lo que trae el API", async () => {
    mocked.getTicketSettings.mockResolvedValue({
      ...defaults(),
      showTaxId: false,
      footerMessage: "Vuelva pronto",
      logo: { kind: "preset", preset: "cafe" },
    });
    renderCard(user(["tenants:manage"]));
    const tarjeta = await screen.findByTestId("ticket-settings");
    expect(within(tarjeta).getByText("Configuración del ticket")).toBeVisible();
    for (const nombre of ["Comida", "Cafetería", "Farmacia", "Tienda", "Consultorio", "Taller"]) {
      expect(await screen.findByRole("button", { name: nombre })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Cafetería" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Farmacia" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Nombre del negocio")).toBeChecked();
    expect(screen.getByLabelText("RFC")).not.toBeChecked();
    expect(screen.getByLabelText("Dirección")).toBeChecked();
    expect(screen.getByLabelText("Teléfono")).toBeChecked();
    expect(screen.getByLabelText("Nombre del almacén")).toBeChecked();
    expect(screen.getByLabelText("Mensaje del pie")).toHaveValue("Vuelva pronto");
  });

  it("en pantalla el icono toma el color del texto; el negro es solo del papel (Carlos, 2026-09-05)", async () => {
    renderCard(user(["tenants:manage"]));
    const icono = (await screen.findByRole("button", { name: "Cafetería" })).querySelector("svg");
    expect(icono?.getAttribute("stroke")).toBe("currentColor");
    expect(TICKET_LOGO_SVG.cafe).toContain('stroke="#000000"');
  });

  it("elegir «Farmacia» y Guardar manda el preset, y solo eso", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Farmacia" }));
    expect(screen.getByRole("button", { name: "Farmacia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateTicketSettings).toHaveBeenCalledWith({
        logo: { kind: "preset", preset: "pharmacy" },
      }),
    );
    expect(await screen.findByText("Configuración guardada.")).toBeVisible();
  });

  it("desmarcar «RFC» y escribir el pie manda las dos cosas, y solo esas", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const rfc = await screen.findByLabelText("RFC");
    await waitFor(() => expect(rfc).toBeChecked());
    await usuario.click(rfc);
    await usuario.type(screen.getByLabelText("Mensaje del pie"), "Vuelva pronto");
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateTicketSettings).toHaveBeenCalledWith({
        showTaxId: false,
        footerMessage: "Vuelva pronto",
      }),
    );
  });

  it("vaciar el pie vuelve al de fábrica: manda null", async () => {
    mocked.getTicketSettings.mockResolvedValue({ ...defaults(), footerMessage: "Vuelva pronto" });
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const pie = await screen.findByLabelText("Mensaje del pie");
    await waitFor(() => expect(pie).toHaveValue("Vuelva pronto"));
    await usuario.clear(pie);
    await usuario.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateTicketSettings).toHaveBeenCalledWith({ footerMessage: null }),
    );
  });

  it("subir una imagen la manda en base64 y pinta la vista previa de lo que QUEDÓ", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const archivo = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", {
      type: "image/png",
    });
    const entrada = (await screen.findByLabelText("Subir imagen")) as HTMLInputElement;
    await usuario.upload(entrada, archivo);
    await waitFor(() =>
      expect(mocked.uploadTicketLogo).toHaveBeenCalledWith(
        Buffer.from([137, 80, 78, 71]).toString("base64"),
      ),
    );
    const preview = await screen.findByRole("img", { name: "Logotipo actual del ticket" });
    expect(preview).toHaveAttribute("src", "data:image/png;base64,QUJD");
    // Con imagen propia, ningún preset queda marcado y aparece «Quitar logotipo».
    expect(screen.getByRole("button", { name: "Farmacia" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Quitar logotipo" })).toBeInTheDocument();
  });

  it("un archivo de más de 2 MB no se sube y se dice por qué", async () => {
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const pesado = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "foto.jpg", {
      type: "image/jpeg",
    });
    await usuario.upload(
      (await screen.findByLabelText("Subir imagen")) as HTMLInputElement,
      pesado,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La imagen pesa demasiado: sube una de menos de 2 MB.",
    );
    expect(mocked.uploadTicketLogo).not.toHaveBeenCalled();
  });

  it("un 413 del borde (nginx) se explica como peso, no como falla genérica", async () => {
    mocked.uploadTicketLogo.mockRejectedValue({
      statusCode: 413,
      message: "Request failed with status code 413",
      error: "Request Entity Too Large",
    });
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    const archivo = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", {
      type: "image/png",
    });
    await usuario.upload(
      (await screen.findByLabelText("Subir imagen")) as HTMLInputElement,
      archivo,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La imagen pesa demasiado: sube una de menos de 2 MB.",
    );
  });

  it("«Quitar logotipo» llama al API y deja «Sin logotipo»", async () => {
    mocked.getTicketSettings.mockResolvedValue({
      ...defaults(),
      logo: { kind: "custom" },
      logoDataUrl: "data:image/png;base64,QUJD",
    });
    renderCard(user(["tenants:manage"]));
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Quitar logotipo" }));
    await waitFor(() => expect(mocked.removeTicketLogo).toHaveBeenCalled());
    expect(
      screen.queryByRole("img", { name: "Logotipo actual del ticket" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sin logotipo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
