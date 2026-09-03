import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as receptionApi from "@/lib/reception/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-RECEP-13 — «Generar turno»: los turnos del día del negocio, del número
 * mayor al menor, con su estado; «Atender» y «Volver a espera»; el turno
 * suelto desde el botón de arriba; y el filtro de fecha.
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

const turno = (over: Partial<receptionApi.Turn> = {}): receptionApi.Turn => ({
  id: "t5",
  number: 5,
  businessDate: "2026-09-02",
  customerId: "c1",
  customerName: "Rosa Luna",
  status: "waiting",
  attendedAt: null,
  createdAt: "2026-09-02T18:05:00.000Z",
  ...over,
});

async function renderTurns(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/reception/turns"] }),
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
  mocked.listTurns.mockResolvedValue([
    turno({ id: "t5", number: 5 }),
    turno({ id: "t3", number: 3, customerId: null, customerName: null }),
  ]);
  mocked.createTurn.mockResolvedValue(
    turno({ id: "t6", number: 6, customerId: null, customerName: null }),
  );
  mocked.attendTurn.mockResolvedValue(
    turno({ status: "attended", attendedAt: "2026-09-02T18:10:00.000Z" }),
  );
  mocked.waitTurn.mockResolvedValue(turno());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Generar turno (F9-RECEP-13)", () => {
  it("pinta los turnos del día en el orden del API, con cliente o «Sin cliente» y su estado", async () => {
    await renderTurns(["reception:read", "reception:manage"]);
    const filas = await screen.findAllByTestId(/^turn-/);
    expect(filas.map((f) => f.getAttribute("data-testid"))).toEqual(["turn-t5", "turn-t3"]);
    expect(within(filas[0] as HTMLElement).getByText("Rosa Luna")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("Sin cliente")).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText("En espera")).toBeInTheDocument();
  });

  it("«Atender» llama al API y la fila pasa a «Atendido»", async () => {
    await renderTurns(["reception:read", "reception:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("turn-t5");
    mocked.listTurns.mockResolvedValue([
      turno({ id: "t5", number: 5, status: "attended", attendedAt: "2026-09-02T18:10:00.000Z" }),
      turno({ id: "t3", number: 3, customerId: null, customerName: null }),
    ]);
    await user.click(within(fila).getByRole("button", { name: "Atender" }));
    await waitFor(() => expect(mocked.attendTurn).toHaveBeenCalledWith("t5"));
    expect(await within(screen.getByTestId("turn-t5")).findByText("Atendido")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("turn-t5")).getByRole("button", { name: "Volver a espera" }),
    ).toBeInTheDocument();
  });

  it("«Generar turno» arriba crea un turno sin cliente y muestra el número en grande", async () => {
    await renderTurns(["reception:read", "reception:manage"]);
    const user = userEvent.setup();
    await screen.findByTestId("turn-t5");
    await user.click(screen.getByRole("button", { name: "Generar turno" }));
    expect(mocked.createTurn).toHaveBeenCalledWith({});
    const dialogo = await screen.findByRole("dialog", { name: "Turno generado" });
    expect(within(dialogo).getByTestId("turn-number")).toHaveTextContent("6");
    await waitFor(() => expect(mocked.printTurnTicket).toHaveBeenCalledWith("t6", 6));
  });

  it("si el papel no sale, el diálogo lo dice y ofrece imprimir de nuevo", async () => {
    mocked.printTurnTicket.mockRejectedValueOnce(new Error("popup bloqueado"));
    await renderTurns(["reception:read", "reception:manage"]);
    const user = userEvent.setup();
    await screen.findByTestId("turn-t5");
    await user.click(screen.getByRole("button", { name: "Generar turno" }));
    const dialogo = await screen.findByRole("dialog", { name: "Turno generado" });
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(/imprimirlo de nuevo/);
    await user.click(within(dialogo).getByRole("button", { name: "Imprimir de nuevo" }));
    await waitFor(() => expect(mocked.printTurnTicket).toHaveBeenCalledTimes(2));
  });

  it("cambiar el día vuelve a pedir la lista con esa fecha", async () => {
    await renderTurns(["reception:read", "reception:manage"]);
    await screen.findByTestId("turn-t5");
    // Un input date controlado no acepta clear+type: se cambia el valor entero.
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(mocked.listTurns).toHaveBeenCalledWith({ date: "2026-08-31" }));
  });

  it("«Reimprimir» en una fila vuelve a pedir el papel de ESE turno, aun sin reception:manage", async () => {
    await renderTurns(["reception:read"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("turn-t5");
    await user.click(within(fila).getByRole("button", { name: "Reimprimir" }));
    await waitFor(() => expect(mocked.printTurnTicket).toHaveBeenCalledWith("t5", 5));
    expect(mocked.printTurnTicket).toHaveBeenCalledTimes(1);
  });

  it("si al reimprimir el papel no sale, la pantalla lo dice", async () => {
    mocked.printTurnTicket.mockRejectedValueOnce(new Error("bloqueado"));
    await renderTurns(["reception:read"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("turn-t5");
    await user.click(within(fila).getByRole("button", { name: "Reimprimir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/imprimirlo de nuevo/);
  });

  it("sin reception:manage no hay botones de acción", async () => {
    await renderTurns(["reception:read"]);
    await screen.findByTestId("turn-t5");
    expect(screen.queryByRole("button", { name: "Generar turno" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atender" })).not.toBeInTheDocument();
  });
});
