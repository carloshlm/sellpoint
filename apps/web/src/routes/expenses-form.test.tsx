import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as expensesApi from "@/lib/expenses/api";
import * as categoriesApi from "@/lib/expenses/categories-api";
import * as posApi from "@/lib/pos/api";
import { createQueryClient } from "@/lib/query-client";
import * as reportsApi from "@/lib/reports/api";
import * as suppliersApi from "@/lib/suppliers/api";
import * as taxApi from "@/lib/tenant/tax-api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-EXP-14 — el formulario de gasto (skill `sellpoint-forms`): en tarjeta;
 * «Pendiente» esconde el método y muestra el vencimiento; «Efectivo» muestra
 * la caja con el turno propio preseleccionado y «No sale de una caja»; un
 * beneficiario deshabilita el picker de proveedor; y lo que viaja al API.
 */
vi.mock("@/lib/expenses/api", () => ({
  listExpenses: vi.fn(),
  getExpense: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  payExpense: vi.fn(),
  cancelExpense: vi.fn(),
  getExpenseSummary: vi.fn(),
  listExpenseAccounts: vi.fn(),
  downloadExpenses: vi.fn(),
}));
vi.mock("@/lib/expenses/categories-api", () => ({
  listExpenseCategories: vi.fn(),
  createExpenseCategory: vi.fn(),
  updateExpenseCategory: vi.fn(),
  removeExpenseCategory: vi.fn(),
}));
vi.mock("@/lib/pos/api", () => ({
  getSession: vi.fn(),
  openSession: vi.fn(),
  getSessionTotals: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
vi.mock("@/lib/reports/api", async (importOriginal) => ({
  ...(await importOriginal<typeof reportsApi>()),
  getShiftsReport: vi.fn(),
}));
vi.mock("@/lib/tenant/tax-api", async (importOriginal) => ({
  ...(await importOriginal<typeof taxApi>()),
  getTaxSettings: vi.fn(),
}));
const mocked = vi.mocked(expensesApi);
const mockedCategorias = vi.mocked(categoriesApi);
const mockedPos = vi.mocked(posApi);
const mockedReports = vi.mocked(reportsApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules: ["expenses"] } });

async function renderNuevo(permissions = ["expenses:read", "expenses:manage"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/expenses/new"] }),
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
  mockedCategorias.listExpenseCategories.mockResolvedValue({
    rows: [
      {
        id: "c1",
        code: "rent",
        name: "Renta",
        isActive: true,
        sortOrder: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  mocked.listExpenseAccounts.mockResolvedValue(["BBVA"]);
  mocked.createExpense.mockResolvedValue({ id: "g9" } as expensesApi.Expense);
  mocked.getExpense.mockResolvedValue({ id: "g9", folio: "GAS-000009" } as expensesApi.Expense);
  mockedPos.getSession.mockResolvedValue({ session: null });
  mockedReports.getShiftsReport.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
  vi.mocked(taxApi.getTaxSettings).mockResolvedValue({ mode: "included", groups: [] } as never);
  vi.mocked(suppliersApi.listSuppliers).mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Gastos — formulario (F9-EXP-14)", () => {
  it("vive en una tarjeta con su título, y el primer campo en la MISMA tarjeta", async () => {
    await renderNuevo();
    const titulo = await screen.findByRole("heading", { name: "Registrar gasto" });
    const tarjeta = titulo.closest('[data-slot="card"]');
    expect(tarjeta).not.toBeNull();
    expect(screen.getByLabelText("Fecha del gasto").closest('[data-slot="card"]')).toBe(tarjeta);
  });

  it("«Pendiente» esconde el método y muestra el vencimiento; con efectivo aparece la caja", async () => {
    mockedPos.getSession.mockResolvedValue({
      session: {
        id: "s1",
        warehouseId: "w1",
        status: "open",
        openedAt: "2026-09-10T15:00:00.000Z",
        closedAt: null,
        declaredCash: null,
        calculatedCash: null,
        cashDifference: null,
        closingNote: null,
        warehouse: { id: "w1", name: "Central" },
      },
    });
    await renderNuevo();
    const user = userEvent.setup();
    const pago = await screen.findByLabelText("Pago");
    expect(pago).toHaveValue("");
    expect(screen.getByLabelText("Vence")).toBeInTheDocument();
    expect(screen.queryByLabelText("Caja de origen")).not.toBeInTheDocument();

    await user.selectOptions(pago, "cash");
    expect(screen.queryByLabelText("Vence")).not.toBeInTheDocument();
    const caja = await screen.findByLabelText("Caja de origen");
    // El turno propio viene puesto, y «No sale de una caja» es una opción.
    await waitFor(() => expect(caja).toHaveValue("s1"));
    expect(screen.getByRole("option", { name: "No sale de una caja" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mi turno abierto (Central)" })).toBeInTheDocument();
  });

  it("un beneficiario deshabilita el picker de proveedor", async () => {
    await renderNuevo();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Beneficiario"), "Don Pepe");
    expect(screen.getByLabelText("Proveedor")).toBeDisabled();
  });

  it("sin descripción ni monto no llama al API; completo, crea y abre la ficha", async () => {
    const router = await renderNuevo();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Registrar gasto" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(mocked.createExpense).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Categoría"), "c1");
    await user.type(screen.getByLabelText("Beneficiario"), "Don Pepe");
    await user.type(screen.getByLabelText("Monto"), "116");
    await user.type(screen.getByLabelText("Descripción"), "Renta de septiembre");
    await user.selectOptions(screen.getByLabelText("Pago"), "transfer");
    await user.type(screen.getByLabelText("Cuenta de caja o banco"), "BBVA");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "c1",
          beneficiary: "Don Pepe",
          amount: 116,
          discount: 0,
          description: "Renta de septiembre",
          paymentMethod: "transfer",
          accountRef: "BBVA",
        }),
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/expenses/g9"));
  });
});
