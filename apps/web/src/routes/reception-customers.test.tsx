import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as receptionApi from "@/lib/reception/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-RECEP-11 — «Registro de cliente»: el listado del más reciente al más
 * viejo, «Nuevo» arriba, y por fila «Generar turno», «Editar» y «Eliminar».
 * El número del turno se muestra en un DIÁLOGO, no en un toast: la
 * recepcionista lo dicta en voz alta y un toast se va solo.
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

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
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

const cliente = (over: Partial<receptionApi.Customer> = {}): receptionApi.Customer => ({
  id: "c1",
  firstName: "Rosa",
  lastNamePaternal: "Luna",
  lastNameMaternal: null,
  birthDate: "1990-09-02",
  age: 36,
  phone: "+525512345678",
  email: "rosa@example.com",
  notes: null,
  isActive: true,
  createdAt: "2026-09-02T18:00:00.000Z",
  updatedAt: "2026-09-02T18:00:00.000Z",
  ...over,
});

async function renderCustomers(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/reception/customers"] }),
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
  mocked.listCustomers.mockResolvedValue({
    rows: [
      cliente({ id: "c1", firstName: "Rosa", lastNamePaternal: "Luna" }),
      cliente({
        id: "c2",
        firstName: "Luis",
        lastNamePaternal: "Gómez",
        age: null,
        birthDate: null,
        createdAt: "2026-09-01T18:00:00.000Z",
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.createTurn.mockResolvedValue({
    id: "t1",
    number: 7,
    businessDate: "2026-09-02",
    customerId: "c1",
    customerName: "Rosa Luna",
    status: "waiting",
    attendedAt: null,
    createdAt: "2026-09-02T18:05:00.000Z",
  });
  mocked.removeCustomer.mockResolvedValue(undefined);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Registro de cliente (F9-RECEP-11)", () => {
  it("lista a los clientes en el orden del API, con su edad y sin edad cuando no hay fecha", async () => {
    await renderCustomers(["reception:read", "reception:manage"]);
    const filas = await screen.findAllByTestId(/^customer-/);
    expect(filas.map((f) => f.getAttribute("data-testid"))).toEqual(["customer-c1", "customer-c2"]);
    expect(within(filas[0] as HTMLElement).getByText("36 años")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo" })).toHaveAttribute(
      "href",
      "/reception/customers/new",
    );
  });

  it("«Generar turno» llama al API con el cliente y muestra el número en un diálogo", async () => {
    await renderCustomers(["reception:read", "reception:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("customer-c1");
    await user.click(within(fila).getByRole("button", { name: /generar turno/i }));

    expect(mocked.createTurn).toHaveBeenCalledWith({ customerId: "c1" });
    const dialogo = await screen.findByRole("dialog", { name: "Turno generado" });
    expect(within(dialogo).getByTestId("turn-number")).toHaveTextContent("7");
    expect(within(dialogo).getByText(/Rosa Luna/)).toBeInTheDocument();
    // El papel sale solo al abrir el diálogo (Carlos, 2026-09-02): la misma
    // térmica del ticket de venta, sin un clic más por cada persona.
    await waitFor(() => expect(mocked.printTurnTicket).toHaveBeenCalledWith("t1", 7));
    expect(within(dialogo).getByTestId("turn-ticket")).toHaveTextContent("Turno");
  });

  it("«Eliminar» pide confirmación y solo entonces llama al API", async () => {
    await renderCustomers(["reception:read", "reception:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("customer-c1");
    await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(mocked.removeCustomer).not.toHaveBeenCalled();

    const dialogo = screen.getByRole("alertdialog", { name: /Eliminar a «Rosa Luna»/ });
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar cliente" }));
    await waitFor(() => expect(mocked.removeCustomer).toHaveBeenCalledWith("c1"));
  });

  it("«Editar» lleva a la pantalla del cliente", async () => {
    await renderCustomers(["reception:read", "reception:manage"]);
    const fila = await screen.findByTestId("customer-c1");
    expect(within(fila).getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/reception/customers/c1",
    );
  });

  it("sin reception:manage no hay «Nuevo» ni acciones de escritura", async () => {
    await renderCustomers(["reception:read"]);
    await screen.findByTestId("customer-c1");
    expect(screen.queryByRole("link", { name: "Nuevo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generar turno/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });
});
