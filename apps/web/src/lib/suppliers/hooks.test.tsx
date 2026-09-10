import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as suppliersApi from "./api";
import { SUPPLIERS_QUERY_KEY, useCreateSupplier, useSuppliers } from "./hooks";

vi.mock("./api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(suppliersApi);

/** F9-SUPPL-06 — una mutación invalida la raíz `["suppliers"]`: listado y picker se refrescan. */
describe("hooks de proveedores (F9-SUPPL-06)", () => {
  it("crear invalida la raíz del catálogo", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    mocked.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mocked.createSupplier.mockResolvedValue({
      id: "s1",
      name: "Norte",
      taxId: null,
      contactName: null,
      phone: null,
      email: null,
      address: null,
      notes: null,
      isActive: true,
      createdAt: "2026-09-10T18:00:00.000Z",
      updatedAt: "2026-09-10T18:00:00.000Z",
    });

    const lista = renderHook(() => useSuppliers({ query: "nor" }), { wrapper });
    await waitFor(() => expect(lista.result.current.isSuccess).toBe(true));
    expect(mocked.listSuppliers).toHaveBeenCalledWith({ query: "nor" });

    const crear = renderHook(() => useCreateSupplier(), { wrapper });
    crear.result.current.mutate({ name: "Norte" });
    await waitFor(() => expect(crear.result.current.isSuccess).toBe(true));
    // El cliente HTTP recibe SOLO el input, no el contexto de react-query.
    expect(mocked.createSupplier).toHaveBeenCalledWith({ name: "Norte" });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: SUPPLIERS_QUERY_KEY });
  });
});
