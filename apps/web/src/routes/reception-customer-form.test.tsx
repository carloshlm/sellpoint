import { ageFromBirthDate, localCalendarDate } from "@sellpoint/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as receptionApi from "@/lib/reception/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-RECEP-12 — la pantalla de alta y edición de cliente (pantalla completa,
 * no modal). «Fecha de nacimiento» con la edad calculada al lado en vivo
 * (Carlos, 2026-09-02: la edad no se guarda); Guardar vuelve al listado.
 */
vi.mock("@/lib/reception/api", () => ({
  listCustomers: vi.fn(),
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  removeCustomer: vi.fn(),
  listTurns: vi.fn(),
  createTurn: vi.fn(),
  attendTurn: vi.fn(),
  waitTurn: vi.fn(),
  printTurnTicket: vi.fn().mockResolvedValue(undefined),
}));
const mocked = vi.mocked(receptionApi);

const demoUser = (country = "MX"): AuthUser =>
  buildAuthUser({
    permissions: ["reception:read", "reception:manage"],
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["reception"] },
    tenant: buildTenantBlock({ country }),
  });

const guardado: receptionApi.Customer = {
  id: "c1",
  firstName: "Rosa",
  lastName: "Luna",
  secondLastName: null,
  birthDate: "1990-09-02",
  age: 36,
  phone: "+525512345678",
  email: null,
  notes: null,
  isActive: true,
  createdAt: "2026-09-02T18:00:00.000Z",
  updatedAt: "2026-09-02T18:00:00.000Z",
};

async function renderEn(path: string, country = "MX") {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(country));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

beforeEach(() => {
  mocked.listCustomers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mocked.createCustomer.mockResolvedValue(guardado);
  mocked.updateCustomer.mockResolvedValue(guardado);
  mocked.getCustomer.mockResolvedValue(guardado);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("alta y edición de cliente (F9-RECEP-12)", () => {
  it("el formulario vive en una tarjeta con su título, como el de Servicios", async () => {
    await renderEn("/reception/customers/new");
    const titulo = await screen.findByRole("heading", { name: "Registrar cliente" });
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByLabelText("Nombre").closest('[data-slot="card"]')).toBe(
      titulo.closest('[data-slot="card"]'),
    );
  });

  it("guardar con los mínimos crea al cliente y vuelve al listado", async () => {
    const router = await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "Rosa");
    await user.type(screen.getByLabelText("Apellido paterno"), "Luna");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocked.createCustomer).toHaveBeenCalledWith({
        firstName: "Rosa",
        lastName: "Luna",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/reception/customers"));
  });

  it("un teléfono inválido muestra el error del campo y no llama al API", async () => {
    await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "Rosa");
    await user.type(screen.getByLabelText("Apellido paterno"), "Luna");
    await user.type(screen.getByLabelText("Teléfono"), "12");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/dígitos del número/);
    expect(mocked.createCustomer).not.toHaveBeenCalled();
  });

  it("la edad aparece en vivo al escribir la fecha de nacimiento", async () => {
    await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    // Tres campos en vez de un calendario: se teclea de corrido y el mes se
    // elige de una lista (F1-BDATE).
    await user.type(await screen.findByLabelText("Día"), "2");
    await user.selectOptions(screen.getByLabelText("Mes"), "9");
    await user.type(screen.getByLabelText("Año"), "1990");
    const esperada = ageFromBirthDate(
      "1990-09-02",
      localCalendarDate("America/Mexico_City", new Date()),
    );
    expect(screen.getByText(`Edad: ${esperada} años`)).toBeInTheDocument();
  });

  it("la edición precarga los datos y el PATCH manda solo lo que cambió", async () => {
    const router = await renderEn("/reception/customers/c1");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Nombre")).toHaveValue("Rosa");
    expect(screen.getByLabelText("Día")).toHaveValue("2");
    expect(screen.getByLabelText("Mes")).toHaveValue("9");
    expect(screen.getByLabelText("Año")).toHaveValue("1990");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");

    await user.type(screen.getByLabelText("Notas"), "VIP");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mocked.updateCustomer).toHaveBeenCalledWith("c1", { notes: "VIP" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/reception/customers"));
  });

  it("cancelar vuelve al listado sin guardar", async () => {
    const router = await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/reception/customers"));
    expect(mocked.createCustomer).not.toHaveBeenCalled();
  });
});

/**
 * F1-NAME-09 — el mismo formulario, tres mercados. Y la LEY: el formato decide
 * qué se PIDE, el dato decide qué se MUESTRA, y esconder JAMÁS borra.
 */
describe("los apellidos según el país del negocio (F1-NAME-09)", () => {
  it("México pide dos apellidos, con el vocabulario que la gente reconoce", async () => {
    await renderEn("/reception/customers/new", "MX");
    expect(await screen.findByLabelText("Apellido paterno")).toBeInTheDocument();
    expect(screen.getByLabelText("Apellido materno (opcional)")).toBeInTheDocument();
  });

  it("Estados Unidos pide uno solo: ahí «apellido paterno» no significa nada", async () => {
    await renderEn("/reception/customers/new", "US");
    expect(await screen.findByLabelText("Apellido")).toBeInTheDocument();
    expect(screen.queryByLabelText("Apellido materno (opcional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Apellido paterno")).not.toBeInTheDocument();
  });

  it("Brasil pide un campo, pero en plural: ahí caben hasta cuatro apellidos", async () => {
    await renderEn("/reception/customers/new", "BR");
    expect(await screen.findByLabelText("Apellidos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Apellido materno (opcional)")).not.toBeInTheDocument();
  });

  it("un cliente que YA tiene segundo apellido lo sigue viendo, aunque el país sea de uno", async () => {
    mocked.getCustomer.mockResolvedValue({ ...guardado, secondLastName: "García" });
    await renderEn("/reception/customers/c1", "US");
    // El dato manda sobre el formato: esconderlo sería ocultarle a alguien lo
    // que su propio registro dice.
    expect(await screen.findByLabelText("Apellido materno (opcional)")).toHaveValue("García");
  });

  /**
   * EL test de este módulo. Sin la guarda, el formulario de un negocio
   * estadounidense manda `secondLastName: null` en CADA edición y le borra el
   * segundo apellido a todo cliente que alguien abra para cambiarle el
   * teléfono. Silencioso, acumulativo, irreversible sin backup.
   */
  it("esconder el campo NO lo borra: cambiar solo el teléfono no manda la llave", async () => {
    const user = userEvent.setup();
    mocked.getCustomer.mockResolvedValue({ ...guardado, secondLastName: null });
    await renderEn("/reception/customers/c1", "US");

    await screen.findByLabelText("Apellido");
    expect(screen.queryByLabelText("Apellido materno (opcional)")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Teléfono"));
    await user.type(screen.getByLabelText("Teléfono"), "5599887766");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mocked.updateCustomer).toHaveBeenCalled());
    const cambios = mocked.updateCustomer.mock.calls[0]?.[1] ?? {};
    expect(cambios).not.toHaveProperty("secondLastName");
    expect(cambios).toHaveProperty("phone");
  });
});
