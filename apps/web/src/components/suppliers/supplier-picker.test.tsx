import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as suppliersApi from "@/lib/suppliers/api";
import { SupplierPicker } from "./supplier-picker";

vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(suppliersApi);

const norte: suppliersApi.Supplier = {
  id: "s1",
  name: "Distribuidora Norte",
  taxId: "DNO900101AB1",
  contactName: "Rosa Luna",
  phone: null,
  email: null,
  address: null,
  notes: null,
  isActive: true,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
};

function renderPicker(props: Partial<React.ComponentProps<typeof SupplierPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SupplierPicker value={null} onChange={onChange} {...props} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return onChange;
}

afterEach(() => vi.clearAllMocks());

/** F9-SUPPL-07 — UN buscador para Compras y Gastos: busca activos con debounce y un clic elige. */
describe("SupplierPicker (F9-SUPPL-07)", () => {
  it("busca solo activos tras el debounce y un clic en el renglón devuelve al proveedor", async () => {
    mocked.listSuppliers.mockResolvedValue({ rows: [norte], total: 1, page: 1, pageSize: 20 });
    const onChange = renderPicker();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Proveedor"), "nor");
    await waitFor(() =>
      expect(mocked.listSuppliers).toHaveBeenCalledWith({
        query: "nor",
        isActive: true,
        pageSize: 20,
      }),
    );
    // Una consulta por término asentado, no una por letra.
    expect(mocked.listSuppliers).toHaveBeenCalledTimes(1);
    const opcion = await screen.findByTestId("supplier-option-s1");
    await user.click(within(opcion).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(norte);
  });

  it("con uno elegido muestra su nombre y «Quitar» lo suelta", async () => {
    mocked.getSupplier.mockResolvedValue(norte);
    const onChange = renderPicker({ value: "s1" });
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByTestId("supplier-picker-selected")).toHaveTextContent(
        "Distribuidora Norte",
      ),
    );
    expect(mocked.listSuppliers).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("sin coincidencias lo dice en palabras", async () => {
    mocked.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    renderPicker();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Proveedor"), "zzz");
    expect(await screen.findByText("Ningún proveedor activo coincide.")).toBeInTheDocument();
  });
});
