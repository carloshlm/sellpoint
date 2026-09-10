import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as categoriesApi from "@/lib/expenses/categories-api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-EXP-03 — las categorías de gasto: listado con estado, alta inline en
 * tarjeta solo con `expenses:manage`, desactivar sin borrar, y el 409 de «en
 * uso» a la vista.
 */
vi.mock("@/lib/expenses/categories-api", () => ({
  listExpenseCategories: vi.fn(),
  createExpenseCategory: vi.fn(),
  updateExpenseCategory: vi.fn(),
  removeExpenseCategory: vi.fn(),
}));
const mocked = vi.mocked(categoriesApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules: ["expenses"] } });

const categoria = (
  over: Partial<categoriesApi.ExpenseCategory> = {},
): categoriesApi.ExpenseCategory => ({
  id: "c1",
  code: "rent",
  name: "Renta",
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
  ...over,
});

async function renderCategorias(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/expenses/categories"] }),
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

beforeEach(() => {
  mocked.listExpenseCategories.mockResolvedValue({
    rows: [
      categoria(),
      categoria({ id: "c2", code: "water", name: "Agua", sortOrder: 20, isActive: false }),
    ],
    total: 2,
    page: 1,
    pageSize: 100,
  });
  mocked.createExpenseCategory.mockResolvedValue(
    categoria({ id: "c3", code: "mensajeria", name: "Mensajería" }),
  );
  mocked.updateExpenseCategory.mockResolvedValue(categoria({ isActive: false }));
  mocked.removeExpenseCategory.mockResolvedValue(undefined);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Categorías de gasto (F9-EXP-03)", () => {
  it("lista las categorías con su estado, en el orden del API", async () => {
    await renderCategorias(["expenses:read", "expenses:manage"]);
    const filas = await screen.findAllByTestId(/^expense-category-/);
    expect(filas.map((f) => f.getAttribute("data-testid"))).toEqual([
      "expense-category-c1",
      "expense-category-c2",
    ]);
    expect(within(filas[0] as HTMLElement).getByText("Activa")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("Inactiva")).toBeInTheDocument();
  });

  it("sin expenses:manage se lee pero no hay alta ni acciones", async () => {
    await renderCategorias(["expenses:read"]);
    await screen.findByTestId("expense-category-c1");
    expect(screen.queryByRole("button", { name: "Nueva categoría" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });

  it("crear abre el formulario en una tarjeta y manda solo el nombre", async () => {
    await renderCategorias(["expenses:read", "expenses:manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nueva categoría" }));
    const campo = screen.getByLabelText("Nombre");
    expect(campo.closest('[data-slot="card"]')).not.toBeNull();
    await user.type(campo, "Mensajería");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createExpenseCategory).toHaveBeenCalledWith({ name: "Mensajería" }),
    );
  });

  it("desactivar manda isActive:false y no borra nada", async () => {
    await renderCategorias(["expenses:read", "expenses:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("expense-category-c1");
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));
    await waitFor(() =>
      expect(mocked.updateExpenseCategory).toHaveBeenCalledWith("c1", { isActive: false }),
    );
    expect(mocked.removeExpenseCategory).not.toHaveBeenCalled();
  });

  it("el 409 de «en uso» al borrar se muestra sin romper la tabla", async () => {
    mocked.removeExpenseCategory.mockRejectedValue({
      statusCode: 409,
      message: "Esta categoría ya tiene gastos registrados y no se puede borrar.",
      error: "Conflict",
    });
    await renderCategorias(["expenses:read", "expenses:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("expense-category-c1");
    await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const dialogo = screen.getByRole("alertdialog", { name: /Eliminar «Renta»/ });
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar categoría" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no se puede borrar");
    expect(screen.getByTestId("expense-category-c1")).toBeInTheDocument();
  });
});
