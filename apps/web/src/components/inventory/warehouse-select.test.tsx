import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
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

  /**
   * Carlos (2026-09-14): la etiqueta de la pantalla apunta al `id` del
   * selector. Si mientras carga no existe, Chrome reporta una etiqueta que
   * apunta a nada. El `id` tiene que estar desde el primer render.
   */
  it("mientras carga ya existe el desplegable con su id, deshabilitado", () => {
    mocked.mockReturnValue(new Promise(() => {}));

    renderSelect({ id: "almacen-de-prueba", scoped: true });

    const select = screen.getByRole("combobox");
    expect(select).toHaveAttribute("id", "almacen-de-prueba");
    expect(select).toBeDisabled();
    expect(screen.getByRole("option", { name: "Cargando sucursales…" })).toBeInTheDocument();
  });

  it("sin sucursales muestra un estado vacío en vez de un desplegable inútil", async () => {
    mocked.mockResolvedValue({ data: [] });

    renderSelect();

    // El mensaje EXACTO del vacío, no `/sucursal/i`: desde que la carga también
    // es un desplegable («Cargando sucursales…»), un pedazo de palabra
    // coincidía con el estado de carga y la prueba miraba antes de tiempo
    // (2026-09-14).
    expect(
      await screen.findByText(
        "No hay sucursales disponibles. Crea una antes de registrar movimientos.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

/**
 * F10-MANFIX-02 — «Todas las sucursales», SOLO para quien lo encienda.
 *
 * Los reportes prenden `allowAll` porque ahí «Todas» es un resultado seguro:
 * el API sin `warehouseId` ya junta el alcance del usuario. Los movimientos
 * NO tocan esta opción — de ahí que la auto-selección de F3-HOME-04 (la
 * asignada o la única) siga intacta en el describe de arriba.
 */
describe("WarehouseSelect con `allowAll` (F10-MANFIX-02)", () => {
  it("ofrece «Todas las sucursales» como opción elegible, no deshabilitada", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central"), almacen("b", "Norte")] });

    renderSelect({ allowAll: true, scoped: true });

    const todas = await screen.findByRole("option", { name: "Todas las sucursales" });
    expect(todas).toBeEnabled();
  });

  it("sin `allowAll` la opción «Todas» no existe: sigue el placeholder de siempre", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central")] });

    renderSelect();

    await screen.findByRole("option", { name: "Central" });
    expect(screen.queryByText("Todas las sucursales")).not.toBeInTheDocument();
  });

  /**
   * La razón de ser de la tarea: hoy el selector se auto-asigna la sucursal
   * del usuario (F3-HOME-04) y una dueña con Centro asignada no puede ver el
   * negocio completo. Con `allowAll`, ni la asignada ni el «hay uno solo»
   * fuerzan nada — el reporte se queda en «Todas».
   */
  it("NO autoselecciona la asignada ni la única, aunque haya: se queda en «Todas»", async () => {
    mocked.mockResolvedValue({ data: [almacen("unico", "Central")] });
    const onChange = vi.fn();

    renderSelect({ allowAll: true, scoped: true, onChange });

    await screen.findByRole("option", { name: "Todas las sucursales" });
    // Un par de renders más para descartar que la auto-selección llegue tarde.
    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it("elegir «Todas» de vuelta llama a `onChange` con cadena vacía", async () => {
    mocked.mockResolvedValue({ data: [almacen("a", "Central"), almacen("b", "Norte")] });
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderSelect({ allowAll: true, scoped: true, onChange, value: "a" });

    const select = await screen.findByRole("combobox");
    // Verificado (no es un supuesto): `findByRole("combobox")` puede resolver
    // MIENTRAS el `<select>` sigue deshabilitado —es el mismo nodo del
    // estado de carga, que React reutiliza y luego habilita—, y
    // `selectOptions` sobre un combobox deshabilitado no dispara nada, sin
    // error. Hay que esperar una opción real antes de interactuar.
    await screen.findByRole("option", { name: "Norte" });
    await user.selectOptions(select, "");

    expect(onChange).toHaveBeenCalledWith("");
  });
});

/**
 * F10-MANFIX-08 — las opciones de OTRA fuente. «Abrir turno» no puede pedirlas
 * a `/warehouses`: el cajero (rol Seller) no tiene `warehouses:read` y veía
 * «No hay sucursales disponibles». La caja trae su propia lista y el selector
 * solo la pinta: sin consultar nada por su cuenta, pero con la preselección de
 * la asignada y la auto-selección de la única, como siempre.
 */
describe("WarehouseSelect con `source` (F10-MANFIX-08)", () => {
  const dos = [almacen("a", "Central"), almacen("b", "Norte")];

  afterEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("pinta las opciones que le dan y NO pide /warehouses", async () => {
    renderSelect({ source: { data: dos, isPending: false } });

    expect(await screen.findByRole("option", { name: "Norte" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Central" })).toBeInTheDocument();
    expect(mocked).not.toHaveBeenCalled();
  });

  it("preselecciona la sucursal asignada del usuario entre esas opciones", async () => {
    useAuthStore.getState().setAuth("jwt", buildAuthUser({ defaultWarehouseId: "b" }));
    const onChange = vi.fn();

    renderSelect({ onChange, source: { data: dos, isPending: false } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("b");
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("con una sola, la elige sola", async () => {
    const onChange = vi.fn();

    renderSelect({ onChange, source: { data: [almacen("unico", "Central")], isPending: false } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("unico");
    });
  });

  it("mientras la fuente carga: el desplegable deshabilitado con su id, sin consultar nada", () => {
    renderSelect({ id: "sucursal-de-la-caja", source: { data: undefined, isPending: true } });

    const select = screen.getByRole("combobox");
    expect(select).toHaveAttribute("id", "sucursal-de-la-caja");
    expect(select).toBeDisabled();
    expect(mocked).not.toHaveBeenCalled();
  });
});
