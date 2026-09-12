import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import * as importApi from "@/lib/suppliers/import-api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-SUPPL-08 — «Proveedores»: el listado alfabético del API con su estado,
 * «Nuevo» solo con `suppliers:manage`, y el borrado con confirmación. Un 409
 * (el proveedor tiene compras o gastos) se pinta y OFRECE desactivarlo.
 */
vi.mock("@/lib/suppliers/import-api", () => ({
  downloadSupplierImportTemplate: vi.fn(),
  runSupplierImport: vi.fn(),
}));
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(suppliersApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] } });

const proveedor = (over: Partial<suppliersApi.Supplier> = {}): suppliersApi.Supplier => ({
  id: "s1",
  code: "PROV-001",
  name: "Distribuidora Norte",
  taxId: "DNO900101AB1",
  contactName: "Rosa Luna",
  phone: "+525512345678",
  email: "ventas@norte.mx",
  address: null,
  notes: null,
  attributes: {},
  isActive: true,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
  ...over,
});

async function renderSuppliers(permissions: string[], path = "/suppliers") {
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
  mocked.listSuppliers.mockResolvedValue({
    rows: [
      proveedor({ id: "s2", name: "Abarrotes Centro", taxId: null, isActive: false }),
      proveedor({ id: "s1" }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  mocked.removeSupplier.mockResolvedValue(undefined);
  mocked.updateSupplier.mockResolvedValue(proveedor({ isActive: false }));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Proveedores (F9-SUPPL-08)", () => {
  it("lista en el orden del API con su estado, y «Nuevo» lleva al alta", async () => {
    await renderSuppliers(["suppliers:read", "suppliers:manage"]);
    const filas = await screen.findAllByTestId(/^supplier-s/);
    expect(filas.map((f) => f.getAttribute("data-testid"))).toEqual(["supplier-s2", "supplier-s1"]);
    expect(within(filas[0] as HTMLElement).getByText("Inactivo")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("Activo")).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText("DNO900101AB1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo" })).toHaveAttribute("href", "/suppliers/new");
  });

  it("sin suppliers:read la pantalla no existe", async () => {
    await renderSuppliers(["products:read"]);
    await waitFor(() => expect(screen.queryByText("Proveedores")).not.toBeInTheDocument());
    expect(mocked.listSuppliers).not.toHaveBeenCalled();
  });

  it("con :read sin :manage se lee pero no hay alta ni acciones", async () => {
    await renderSuppliers(["suppliers:read"]);
    await screen.findByTestId("supplier-s1");
    expect(screen.queryByRole("link", { name: "Nuevo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("la tabla muestra el CÓDIGO del proveedor, primero (F9-SUPPCAT-04)", async () => {
    await renderSuppliers(["suppliers:read"]);
    const fila = await screen.findByTestId("supplier-s1");
    expect(within(fila).getAllByRole("cell")[0]).toHaveTextContent("PROV-001");
    expect(screen.getByRole("columnheader", { name: "Código" })).toBeInTheDocument();
  });

  it("«Eliminar» pide confirmación y solo entonces llama al API", async () => {
    await renderSuppliers(["suppliers:read", "suppliers:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("supplier-s1");
    await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
    expect(mocked.removeSupplier).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("alertdialog", { name: /Eliminar a «Distribuidora Norte»/ });
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar proveedor" }));
    await waitFor(() => expect(mocked.removeSupplier).toHaveBeenCalledWith("s1"));
    // El éxito se VE (Carlos, 2026-09-12): verde y con el foco.
    const aviso = await screen.findByTestId("supplier-deleted");
    expect(aviso).toHaveTextContent("Se eliminó el proveedor «Distribuidora Norte».");
    expect(aviso).toHaveFocus();
  });

  it("un 409 al borrar muestra el aviso y ofrece desactivarlo ahí mismo", async () => {
    mocked.removeSupplier.mockRejectedValue({
      statusCode: 409,
      message: "Este proveedor tiene compras o gastos registrados y no se puede borrar.",
      error: "Conflict",
    });
    await renderSuppliers(["suppliers:read", "suppliers:manage"]);
    const user = userEvent.setup();
    const fila = await screen.findByTestId("supplier-s1");
    await user.click(within(fila).getByRole("button", { name: "Eliminar" }));
    const dialogo = screen.getByRole("alertdialog", { name: /Distribuidora Norte/ });
    await user.click(within(dialogo).getByRole("button", { name: "Eliminar proveedor" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("no se puede borrar");
    await user.click(within(aviso).getByRole("button", { name: "Desactivar proveedor" }));
    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", { isActive: false }),
    );
  });
});

/**
 * Importar proveedores por Excel (Carlos, 2026-09-12): el mismo flujo de dos
 * pasos de almacenes, con el diálogo común de la casa.
 */
describe("importar proveedores (2026-09-12)", () => {
  it("dry-run con reporte y aplicar solo tras verlo; al final, el cuadro verde", async () => {
    await renderSuppliers(["suppliers:read", "suppliers:manage"]);
    const user = userEvent.setup();
    const mockedRun = vi.mocked(importApi.runSupplierImport);
    mockedRun.mockResolvedValue({
      valid: 2,
      failed: 0,
      created: 1,
      updated: 1,
      errors: [],
      applied: false,
    });

    await user.click(await screen.findByRole("button", { name: "Importar proveedores" }));
    expect(screen.getByText(/El código es la llave/)).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([new Uint8Array([0x50, 0x4b])], "proveedores.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    // Primero el reporte SIN escribir: dry-run obligatorio.
    await waitFor(() =>
      expect(mockedRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true })),
    );
    expect(await screen.findByTestId("supplier-import-report")).toHaveTextContent("1 altas");

    mockedRun.mockResolvedValue({
      valid: 2,
      failed: 0,
      created: 1,
      updated: 1,
      errors: [],
      applied: true,
    });
    await user.click(screen.getByRole("button", { name: "Importar" }));
    await waitFor(() =>
      expect(mockedRun).toHaveBeenLastCalledWith(expect.objectContaining({ skipErrors: false })),
    );
    const listo = await screen.findByTestId("supplier-import-done");
    expect(listo).toHaveTextContent("2 proveedores");
    expect(listo).toHaveFocus();
  });

  it("sin suppliers:manage no hay botón de importar", async () => {
    await renderSuppliers(["suppliers:read"]);
    await screen.findByTestId("supplier-s1");
    expect(screen.queryByRole("button", { name: "Importar proveedores" })).not.toBeInTheDocument();
  });
});
