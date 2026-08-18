import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { api } from "@/lib/api";
import { WarehouseSelect } from "./warehouse-select";

/**
 * F3-NAV-01 — el selector de almacén de toda la Fase 3.
 *
 * Con `scoped` pide solo los que el usuario administra: un Manager no tiene
 * que poder ni siquiera ELEGIR un almacén ajeno, porque el 403 posterior sería
 * una explicación tardía de algo que la pantalla nunca debió ofrecer.
 */
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
}));

const mocked = vi.mocked(api.get);

function renderSelect(props: Partial<Parameters<typeof WarehouseSelect>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={createI18n()}>
        <WarehouseSelect
          value={props.value ?? null}
          onChange={props.onChange ?? (() => {})}
          {...props}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const almacen = (id: string, name: string) => ({ id, name, address: null, isActive: true });

beforeEach(() => {
  mocked.mockReset();
});

describe("WarehouseSelect (F3-NAV-01)", () => {
  it("con `scoped` pide SOLO los almacenes del alcance", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central")] });

    renderSelect({ scoped: true });

    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("/warehouses", { params: { scoped: true } });
    });
  });

  it("sin `scoped` pide todos: es la pantalla de administración", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central")] });

    renderSelect();

    await waitFor(() => {
      expect(mocked).toHaveBeenCalledWith("/warehouses", { params: {} });
    });
  });

  it("muestra los almacenes como opciones", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central"), almacen("b", "Sucursal")] });

    renderSelect();

    expect(await screen.findByRole("option", { name: "Central" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sucursal" })).toBeInTheDocument();
  });

  /**
   * La enorme mayoría de los negocios tiene UN almacén. Obligarlos a elegirlo
   * en cada movimiento es fricción pura.
   */
  it("si hay uno solo lo selecciona solo", async () => {
    mocked.mockResolvedValue({ data: [almacen("unico", "Central")] });
    const onChange = vi.fn();

    renderSelect({ onChange });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("unico");
    });
  });

  /**
   * La auto-selección avisa UNA sola vez por montaje, aunque el padre le pase
   * un `onChange` nuevo en cada render y el `value` SIGA en null.
   *
   * Ese es el estado real cuando el PATCH que dispara el aviso **falla** (403,
   * 422, red caída): el documento nunca refleja el cambio, `value` se queda
   * nulo para siempre y, sin un guardia, el efecto vuelve a avisar en cada
   * render — un bucle que martilla el servidor con el mismo PATCH que ya
   * falló. Lo destapó F3-EXIT-02 con el almacén destino del traspaso, como
   * "Maximum update depth exceeded".
   */
  it("auto-selecciona UNA sola vez aunque el value nunca se actualice", async () => {
    mocked.mockResolvedValue({ data: [almacen("unico", "Central")] });
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const arbol = (marca: number) => (
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={createI18n()}>
          <WarehouseSelect
            value={null}
            // Identidad nueva en cada render, como `onChange={(id) => mutate(...)}`.
            onChange={(id) => onChange(id, marca)}
            excludeIds={[]}
          />
        </I18nextProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(arbol(0));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    // Diez renders más con el value todavía en null: el PATCH falló y nadie
    // lo va a arreglar. Ninguno debe volver a avisar.
    for (let i = 1; i <= 10; i++) {
      rerender(arbol(i));
    }

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("con dos almacenes NO elige por el usuario", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central"), almacen("b", "Sucursal")] });
    const onChange = vi.fn();

    renderSelect({ onChange });

    await screen.findByRole("option", { name: "Central" });
    expect(onChange).not.toHaveBeenCalled();
  });

  /** El destino de un traspaso no puede ser el origen. */
  it("`excludeIds` saca ese almacén de las opciones", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central"), almacen("b", "Sucursal")] });

    renderSelect({ excludeIds: ["a"] });

    expect(await screen.findByRole("option", { name: "Sucursal" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Central" })).not.toBeInTheDocument();
  });

  it("sin almacenes muestra un estado vacío en vez de un desplegable inútil", async () => {
    mocked.mockResolvedValue({ data: [] });

    renderSelect();

    expect(await screen.findByText(/almac/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
