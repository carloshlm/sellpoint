import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as receptionApi from "@/lib/reception/api";
import * as settingsApi from "@/lib/reception/settings-api";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-RECEP-18 — la palabra propia del negocio se pinta en TODO el módulo de
 * Recepción: título, buscador, columnas, vacíos y el menú. Y una entrada
 * apagada en la configuración no se abre por la URL: dice que está apagada
 * (nunca redirige, como todo gate de la casa).
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
  printTurnTicket: vi.fn(),
}));
vi.mock("@/lib/reception/settings-api", () => ({
  getReceptionSettings: vi.fn(),
  updateReceptionSettings: vi.fn(),
}));
const api = vi.mocked(receptionApi);
const settings = vi.mocked(settingsApi);

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

async function renderRuta(path: string) {
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
}

import { routeTree } from "@/routeTree.gen";

beforeEach(() => {
  api.listCustomers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  api.listTurns.mockResolvedValue([
    {
      id: "t1",
      number: 1,
      businessDate: "2026-09-04",
      customerId: null,
      customerName: null,
      status: "waiting",
      attendedAt: null,
      createdAt: "2026-09-04T14:00:00.000Z",
    },
  ]);
  settings.getReceptionSettings.mockResolvedValue({
    customerLabel: "Paciente",
    showCustomers: true,
    showTurns: true,
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("la palabra propia del negocio en Recepción (F9-RECEP-18)", () => {
  it("el registro dice «paciente» en el título, el buscador, el vacío y el menú", async () => {
    await renderRuta("/reception/customers");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Registro de paciente" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar paciente")).toBeInTheDocument();
    expect(await screen.findByText("Todavía no registraste pacientes.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registro de paciente" })).toHaveAttribute(
      "href",
      "/reception/customers",
    );
    // Y NO queda ningún «cliente» suelto en la pantalla.
    expect(document.body.textContent).not.toMatch(/cliente/i);
  });

  it("los turnos dicen «Paciente» en la columna y «Sin paciente» en la fila", async () => {
    await renderRuta("/reception/turns");
    expect(await screen.findByRole("columnheader", { name: "Paciente" })).toBeInTheDocument();
    expect(await screen.findByText("Sin paciente")).toBeInTheDocument();
  });

  it("el alta dice «Registrar paciente»", async () => {
    await renderRuta("/reception/customers/new");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Registrar paciente" }),
    ).toBeInTheDocument();
  });

  it("sin palabra propia, todo sigue diciendo «cliente»", async () => {
    settings.getReceptionSettings.mockResolvedValue({
      customerLabel: null,
      showCustomers: true,
      showTurns: true,
    });
    await renderRuta("/reception/customers");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Registro de cliente" }),
    ).toBeInTheDocument();
  });

  it("una entrada apagada no se abre por la URL: dice que está desactivada", async () => {
    settings.getReceptionSettings.mockResolvedValue({
      customerLabel: null,
      showCustomers: true,
      showTurns: false,
    });
    await renderRuta("/reception/turns");
    expect(await screen.findByText("Esta sección está desactivada")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cliente" })).not.toBeInTheDocument();
    // Y en el menú tampoco está.
    expect(screen.queryByRole("link", { name: "Generar turno" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registro de cliente" })).toBeInTheDocument();
  });

  it("con los turnos apagados, la fila del registro tampoco ofrece «Generar turno»", async () => {
    settings.getReceptionSettings.mockResolvedValue({
      customerLabel: null,
      showCustomers: true,
      showTurns: false,
    });
    api.listCustomers.mockResolvedValue({
      rows: [
        {
          id: "c1",
          firstName: "Rosa",
          lastNamePaternal: "Luna",
          lastNameMaternal: null,
          birthDate: null,
          age: null,
          phone: null,
          email: null,
          notes: null,
          isActive: true,
          createdAt: "2026-09-04T14:00:00.000Z",
          updatedAt: "2026-09-04T14:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderRuta("/reception/customers");
    expect(await screen.findByText("Rosa Luna")).toBeInTheDocument();
    // Si el negocio apagó los turnos, no se generan desde ningún lado.
    await screen.findByRole("link", { name: "Editar" });
    expect(screen.queryByRole("button", { name: "Generar turno" })).not.toBeInTheDocument();
  });
});
