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
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

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

const demoUser = (): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["reception:read", "reception:manage"],
  subscription: { ...SUBSCRIPTION_PLUS, modules: ["reception"] },
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
    monthlySalesGoal: null,
  },
});

const guardado: receptionApi.Customer = {
  id: "c1",
  firstName: "Rosa",
  lastNamePaternal: "Luna",
  lastNameMaternal: null,
  birthDate: "1990-09-02",
  age: 36,
  phone: "+525512345678",
  email: null,
  notes: null,
  isActive: true,
  createdAt: "2026-09-02T18:00:00.000Z",
  updatedAt: "2026-09-02T18:00:00.000Z",
};

async function renderEn(path: string) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser());
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
    const titulo = await screen.findByRole("heading", { name: "Nuevo cliente" });
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByLabelText("Nombres").closest('[data-slot="card"]')).toBe(
      titulo.closest('[data-slot="card"]'),
    );
  });

  it("guardar con los mínimos crea al cliente y vuelve al listado", async () => {
    const router = await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombres"), "Rosa");
    await user.type(screen.getByLabelText("Apellido paterno"), "Luna");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mocked.createCustomer).toHaveBeenCalledWith({
        firstName: "Rosa",
        lastNamePaternal: "Luna",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/reception/customers"));
  });

  it("un teléfono inválido muestra el error del campo y no llama al API", async () => {
    await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombres"), "Rosa");
    await user.type(screen.getByLabelText("Apellido paterno"), "Luna");
    await user.type(screen.getByLabelText("Teléfono"), "12");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/dígitos del número/);
    expect(mocked.createCustomer).not.toHaveBeenCalled();
  });

  it("la edad aparece en vivo al escribir la fecha de nacimiento", async () => {
    await renderEn("/reception/customers/new");
    const user = userEvent.setup();
    const fecha = await screen.findByLabelText("Fecha de nacimiento");
    await user.type(fecha, "1990-09-02");
    const esperada = ageFromBirthDate(
      "1990-09-02",
      localCalendarDate("America/Mexico_City", new Date()),
    );
    expect(screen.getByText(`Edad: ${esperada} años`)).toBeInTheDocument();
  });

  it("la edición precarga los datos y el PATCH manda solo lo que cambió", async () => {
    const router = await renderEn("/reception/customers/c1");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Nombres")).toHaveValue("Rosa");
    expect(screen.getByLabelText("Fecha de nacimiento")).toHaveValue("1990-09-02");
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
