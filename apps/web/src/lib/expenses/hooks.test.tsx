import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { POS_SESSION_KEY } from "@/lib/pos/hooks";
import * as expensesApi from "./api";
import { EXPENSES_QUERY_KEY, EXPENSES_SUMMARY_KEY, usePayExpense } from "./hooks";

vi.mock("./api", () => ({
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
const mocked = vi.mocked(expensesApi);

/** F9-EXP-12 — pagar invalida listado, resumen, el arqueo del turno y el reporte de cierres. */
describe("hooks de Gastos (F9-EXP-12)", () => {
  it("pagar un gasto refresca también el arqueo del turno y el reporte de cierres", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    mocked.payExpense.mockResolvedValue({ id: "g1" } as expensesApi.Expense);

    const { result } = renderHook(() => usePayExpense(), { wrapper });
    result.current.mutate({ id: "g1", input: { paymentMethod: "cash", cashboxSessionId: "s1" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocked.payExpense).toHaveBeenCalledWith("g1", {
      paymentMethod: "cash",
      cashboxSessionId: "s1",
    });
    const claves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(claves).toContain(JSON.stringify(EXPENSES_QUERY_KEY));
    expect(claves).toContain(JSON.stringify(EXPENSES_SUMMARY_KEY));
    expect(claves).toContain(JSON.stringify(POS_SESSION_KEY));
    expect(claves).toContain(JSON.stringify(["reports", "shifts"]));
  });
});
