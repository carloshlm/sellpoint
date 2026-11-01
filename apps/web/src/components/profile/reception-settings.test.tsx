import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as settingsApi from "@/lib/reception/settings-api";
import * as servicesApi from "@/lib/services/api";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { expectRowActionsColumn } from "@/test/row-actions";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { ReceptionSettings } from "./reception-settings";

vi.mock("@/lib/reception/settings-api", () => ({
  getReceptionSettings: vi.fn(),
  updateReceptionSettings: vi.fn(),
}));
const mocked = vi.mocked(settingsApi);
vi.mock("@/lib/services/api", async (original) => ({
  ...(await original<typeof import("@/lib/services/api")>()),
  listServices: vi.fn(),
}));
const servicios = vi.mocked(servicesApi);

const servicio = (id: string, name: string, price: string, isActive = true) => ({
  id,
  code: name.toUpperCase().replaceAll(" ", "-"),
  name,
  description: null,
  cost: null,
  price,
  isActive,
  warehouseIds: [],
  taxGroupId: null,
  attributes: {},
});
/** Como la manda la lectura de la configuración: sin lo que la tarjeta no usa. */
const enLista = (s: ReturnType<typeof servicio>) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  price: s.price,
});
const CONSULTA = servicio("11111111-1111-4111-8111-111111111111", "Consulta médica", "500.00");
const ESPECIALIDAD = servicio(
  "22222222-2222-4222-8222-222222222222",
  "Consulta de especialidad",
  "900.00",
);
const INACTIVA = servicio(
  "33333333-3333-4333-8333-333333333333",
  "Consulta vieja",
  "300.00",
  false,
);

/**
 * F9-RECEP-18 — «Configuración Recepción» en Mi perfil: solo con el módulo
 * y `tenants:manage`; la palabra es UNA, sin espacios, y se previsualiza ya
 * Capitalizada; las dos entradas del menú se apagan por separado; Guardar
 * manda SOLO lo que cambió.
 */
const user = (modules: AuthUser["subscription"]["modules"], permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules } });

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
    turnServices: [],
  });
  mocked.updateReceptionSettings.mockImplementation(async (input) => ({
    customerLabel: null,
    showCustomers: true,
    showTurns: true,
    turnServices: [],
    ...input,
  }));
});

beforeEach(() => {
  // Como el API: busca por nombre o código, y trae también los inactivos.
  servicios.listServices.mockImplementation(async (params = {}) => {
    const texto = (params.query ?? "").toLocaleLowerCase("es");
    const rows = [CONSULTA, ESPECIALIDAD, INACTIVA].filter(
      (s) =>
        s.name.toLocaleLowerCase("es").includes(texto) ||
        s.code.toLocaleLowerCase("es").includes(texto),
    );
    return { rows, total: rows.length, page: 1, pageSize: 20 };
  });
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
      turnServices: [],
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

  /**
   * F9-RECEP-32 — los servicios que generan turno al venderse (ley 31), con
   * un BUSCADOR: el catálogo puede tener miles, así que no se despliega
   * entero. La lista guardada llega con nombre y precio; se agrega desde la
   * búsqueda, se quita en la tabla y Guardar manda la lista COMPLETA, solo si
   * cambió.
   */
  describe("servicios que generan turno al venderse (F9-RECEP-32)", () => {
    const admin = () => user(["reception"], ["tenants:manage", "services:read"]);
    const conLista = (turnServices: ReturnType<typeof enLista>[]) =>
      mocked.getReceptionSettings.mockResolvedValue({
        customerLabel: null,
        showCustomers: true,
        showTurns: true,
        turnServices,
      });

    it("pinta los guardados con su precio sin pedir el catálogo", async () => {
      conLista([enLista(CONSULTA)]);
      renderCard(admin());

      const lista = await screen.findByTestId("reception-turn-services");
      const fila = await within(lista).findByRole("row", { name: /Consulta médica/ });
      expect(fila).toHaveTextContent("$500.00");
      expect(servicios.listServices).not.toHaveBeenCalled();
    });

    it("buscar y agregar uno, y Guardar manda la lista completa", async () => {
      conLista([enLista(CONSULTA)]);
      const usuario = userEvent.setup();
      renderCard(admin());

      await usuario.type(await screen.findByLabelText("Buscar servicio"), "espec");
      await usuario.click(await screen.findByRole("button", { name: /^Consulta de especialidad/ }));
      expect(
        within(screen.getByTestId("reception-turn-services")).getByRole("row", {
          name: /Consulta de especialidad/,
        }),
      ).toBeInTheDocument();
      // El buscador queda listo para el siguiente.
      expect(screen.getByLabelText("Buscar servicio")).toHaveValue("");

      await usuario.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(mocked.updateReceptionSettings).toHaveBeenCalledWith({
          turnServiceIds: [CONSULTA.id, ESPECIALIDAD.id],
        }),
      );
      expect(servicios.listServices).toHaveBeenCalledWith(
        expect.objectContaining({ query: "espec" }),
      );
    });

    // Carlos (2026-11-01): toda columna de acciones lleva su título.
    it("la última columna se titula «Acciones» y «Quitar» va en ella", async () => {
      conLista([enLista(CONSULTA)]);
      renderCard(admin());

      expectRowActionsColumn(await screen.findByRole("button", { name: "Quitar Consulta médica" }));
    });

    it("Quitar uno y Guardar manda la lista sin él", async () => {
      conLista([enLista(CONSULTA), enLista(ESPECIALIDAD)]);
      const usuario = userEvent.setup();
      renderCard(admin());

      await usuario.click(await screen.findByRole("button", { name: "Quitar Consulta médica" }));
      await usuario.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() =>
        expect(mocked.updateReceptionSettings).toHaveBeenCalledWith({
          turnServiceIds: [ESPECIALIDAD.id],
        }),
      );
    });

    it("en la búsqueda, el que ya está en la lista no se agrega dos veces y el inactivo no sale", async () => {
      conLista([enLista(CONSULTA)]);
      const usuario = userEvent.setup();
      renderCard(admin());

      await usuario.type(await screen.findByLabelText("Buscar servicio"), "consulta");

      expect(await screen.findByRole("button", { name: /^Consulta médica/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Consulta de especialidad/ })).toBeEnabled();
      expect(screen.queryByRole("button", { name: /^Consulta vieja/ })).not.toBeInTheDocument();
    });

    it("sin servicios en la lista lo dice, en lugar de una tabla vacía", async () => {
      renderCard(admin());

      expect(await screen.findByText(/Ningún servicio genera turno todavía/)).toBeInTheDocument();
      expect(
        within(screen.getByTestId("reception-turn-services")).queryByRole("table"),
      ).not.toBeInTheDocument();
    });

    it("lo que no coincide con nada lo dice", async () => {
      const usuario = userEvent.setup();
      renderCard(admin());

      await usuario.type(await screen.findByLabelText("Buscar servicio"), "zzz");

      expect(await screen.findByText("Ningún servicio activo coincide.")).toBeInTheDocument();
    });
  });
});
