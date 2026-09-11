import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as expensesApi from "@/lib/expenses/api";
import * as categoriesApi from "@/lib/expenses/categories-api";
import * as posApi from "@/lib/pos/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-EXP-13 — el listado de gastos: los anulados se ven marcados, el resumen
 * va en su propia consulta (no se repide al paginar), cambiar fechas no borra
 * la barra de filtros, y la ficha ofrece «Anular» solo con `expenses:cancel`.
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
const mocked = vi.mocked(expensesApi);
const mockedCategorias = vi.mocked(categoriesApi);
const mockedPos = vi.mocked(posApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules: ["expenses"] } });

const gasto = (over: Partial<expensesApi.Expense> = {}): expensesApi.Expense => ({
  id: "g1",
  folio: "GAS-000001",
  warehouseId: "w1",
  warehouseName: "Central",
  expenseDate: "2026-09-10",
  categoryId: "c1",
  categoryName: "Renta",
  supplierId: null,
  supplierName: null,
  beneficiary: "Don Pepe",
  description: "Renta de septiembre",
  reference: null,
  amount: "116",
  discount: "0",
  taxGroupCode: "VAT16",
  taxRates: [],
  taxAmount: "16",
  total: "116",
  taxMode: "included",
  status: "active",
  paymentStatus: "pending",
  paymentMethod: null,
  paidAt: null,
  dueDate: null,
  cashboxSessionId: null,
  accountRef: null,
  notes: null,
  createdBy: "u1",
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
  canceledAt: null,
  cancelReason: null,
  ...over,
});

async function renderEn(path: string, permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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
  mocked.listExpenses.mockResolvedValue({
    rows: [
      gasto(),
      gasto({
        id: "g2",
        folio: "GAS-000002",
        status: "canceled",
        canceledAt: "2026-09-10T19:00:00.000Z",
        cancelReason: "duplicado",
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.getExpenseSummary.mockResolvedValue({
    count: 1,
    amount: "116",
    discount: "0",
    tax: "16",
    total: "116",
    byCategory: [{ categoryId: "c1", categoryName: "Renta", count: 1, total: "116" }],
    byPaymentStatus: { pending: "116", paid: "0" },
  });
  mocked.getExpense.mockResolvedValue(gasto());
  mocked.cancelExpense.mockResolvedValue(gasto({ status: "canceled" }));
  mocked.payExpense.mockResolvedValue(gasto({ paymentStatus: "paid", paymentMethod: "card" }));
  mocked.listExpenseAccounts.mockResolvedValue([]);
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
  mockedPos.getSession.mockResolvedValue({ session: null });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Gastos — listado (F9-EXP-13)", () => {
  it("lista con folio, categoría, total y estados; los anulados se ven marcados", async () => {
    await renderEn("/expenses", ["expenses:read"]);
    const filas = await screen.findAllByTestId(/^expense-g/);
    expect(filas).toHaveLength(2);
    expect(within(filas[0] as HTMLElement).getByText("GAS-000001")).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText("Pendiente")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("Anulado")).toBeInTheDocument();
    expect(filas[1]).toHaveClass("line-through");
    // Sin `expenses:manage` no hay alta.
    expect(screen.queryByRole("link", { name: "Registrar gasto" })).not.toBeInTheDocument();
  });

  it("el resumen viene de SU consulta y no se repide al paginar", async () => {
    await renderEn("/expenses", ["expenses:read"]);
    expect(await screen.findByTestId("expenses-summary-total")).toHaveTextContent("$116.00");
    expect(mocked.getExpenseSummary).toHaveBeenCalledTimes(1);
    // El resumen NO lleva página ni tamaño de página.
    expect(mocked.getExpenseSummary.mock.calls[0]?.[0]).not.toHaveProperty("page");
  });

  it("cambiar la fecha «Desde» no borra la barra de filtros y viaja al API", async () => {
    await renderEn("/expenses", ["expenses:read"]);
    const user = userEvent.setup();
    await screen.findByTestId("expense-g1");
    await user.type(screen.getByLabelText(/desde/i), "2026-09-01");
    expect(screen.getByLabelText(/hasta/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.listExpenses).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "2026-09-01", page: 1 }),
      ),
    );
  });

  it("la ficha ofrece «Anular» solo con expenses:cancel, y pide el motivo", async () => {
    await renderEn("/expenses/g1", ["expenses:read", "expenses:manage"]);
    await screen.findByTestId("expense-detail");
    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como pagado" })).toBeInTheDocument();
    useAuthStore.getState().clearAuth();

    await renderEn("/expenses/g1", ["expenses:read", "expenses:cancel"]);
    const user = userEvent.setup();
    const boton = (await screen.findAllByRole("button", { name: "Anular" }))[0] as HTMLElement;
    await user.click(boton);
    const dialogo = screen.getByRole("alertdialog", { name: /Anular «GAS-000001»/ });
    expect(within(dialogo).getByRole("button", { name: "Anular gasto" })).toBeDisabled();
    await user.type(within(dialogo).getByLabelText("Motivo"), "duplicado");
    await user.click(within(dialogo).getByRole("button", { name: "Anular gasto" }));
    await waitFor(() => expect(mocked.cancelExpense).toHaveBeenCalledWith("g1", "duplicado"));
  });

  it("«Marcar como pagado» manda el método y, con efectivo y turno abierto, la caja propia", async () => {
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
    await renderEn("/expenses/g1", ["expenses:read", "expenses:manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Marcar como pagado" }));
    const dialogo = screen.getByRole("alertdialog", { name: /Marcar «GAS-000001» como pagado/ });
    expect(within(dialogo).getByLabelText("Caja de origen")).toHaveValue("s1");
    await user.click(within(dialogo).getByRole("button", { name: "Marcar como pagado" }));
    await waitFor(() =>
      expect(mocked.payExpense).toHaveBeenCalledWith("g1", {
        paymentMethod: "cash",
        cashboxSessionId: "s1",
      }),
    );
  });
});
