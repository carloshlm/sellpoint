import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as posApi from "../lib/pos/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F4-UI-03 — el historial de ventas.
 *
 * Las dos reglas que se protegen: **las anuladas se ven marcadas, no se
 * esconden** —quien busca una venta que no cuadra necesita encontrarla justo
 * cuando está anulada— y **cada acción se gatea con SU permiso**: leer el
 * historial es `pos:view`, anular es `pos:cancel`, y no son lo mismo.
 */
vi.mock("../lib/pos/api", () => ({
  getSession: vi.fn(),
  openSession: vi.fn(),
  getSessionTotals: vi.fn(),
  closeSession: vi.fn(),
  lookup: vi.fn(),
  createSale: vi.fn(),
  listSales: vi.fn(),
  cancelSale: vi.fn(),
  printTicket: vi.fn(),
}));

const mocked = vi.mocked(posApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "cajero@demo.test",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "t1",
    name: "Demo",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

const venta = (overrides: Partial<posApi.SaleRow> = {}): posApi.SaleRow => ({
  id: "sale-1",
  folio: "VTA-000001",
  warehouseId: "w1",
  status: "completed",
  paymentMethod: "cash",
  subtotal: "100.00",
  discount: "0.00",
  total: "100.00",
  createdAt: "2026-08-21T16:00:00.000Z",
  barcode: "202608210001",
  items: [],
  warehouse: { id: "w1", name: "Almacén Centro" },
  seller: { id: "u1", name: "Ana Pérez" },
  canceledAt: null,
  cancelReason: null,
  ...overrides,
});

const pagina = (rows: posApi.SaleRow[], total = rows.length): posApi.SalesPage => ({
  rows,
  total,
  page: 1,
  pageSize: 20,
});

async function renderRuta(path: string, permissions: string[]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
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
}

describe("Historial de ventas (F4-UI-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.listSales.mockResolvedValue(pagina([venta()]));
  });

  describe("el nav", () => {
    /**
     * ⚠ La regla del nav de F2: el grupo se ve con cualquier permiso del
     * dominio y cada item se gatea con el SUYO. Un auditor con solo `pos:view`
     * tiene que llegar al historial sin ver un botón de vender que no puede
     * usar.
     */
    it("con solo `pos:view` muestra el historial y NO la venta", async () => {
      await renderRuta("/pos/sales", ["pos:view"]);

      const nav = await screen.findByRole("group", { name: "Punto de venta" });
      expect(within(nav).getByLabelText("Historial")).toBeInTheDocument();
      expect(within(nav).queryByLabelText("Venta")).not.toBeInTheDocument();
      expect(within(nav).queryByLabelText("Cierre de caja")).not.toBeInTheDocument();
    });

    it("con solo `pos:sell` muestra vender y cerrar, NO el historial", async () => {
      await renderRuta("/pos", ["pos:sell"]);

      const nav = await screen.findByRole("group", { name: "Punto de venta" });
      expect(within(nav).getByLabelText("Venta")).toBeInTheDocument();
      expect(within(nav).getByLabelText("Cierre de caja")).toBeInTheDocument();
      expect(within(nav).queryByLabelText("Historial")).not.toBeInTheDocument();
    });

    it("sin ningún permiso del POS, el grupo entero desaparece", async () => {
      await renderRuta("/dashboard", ["products:read"]);

      await screen.findByRole("navigation");
      expect(screen.queryByRole("group", { name: "Punto de venta" })).not.toBeInTheDocument();
    });
  });

  describe("la pantalla", () => {
    it("sin `pos:view` no se entra, aunque se escriba la URL", async () => {
      await renderRuta("/pos/sales", ["pos:sell"]);

      await waitFor(() => expect(screen.queryByTestId("sales-history")).not.toBeInTheDocument());
      expect(mocked.listSales).not.toHaveBeenCalled();
    });

    it("lista las ventas con su folio, quién vendió y el total", async () => {
      await renderRuta("/pos/sales", ["pos:view"]);

      expect(await screen.findByText("VTA-000001")).toBeInTheDocument();
      expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
      expect(screen.getByText("$100.00")).toBeInTheDocument();
    });

    /**
     * El código del ticket como COLUMNA (Carlos, 2026-08-24).
     *
     * Ya se podía buscar por él, pero no se veía: quien tiene el papel en la
     * mano y quiere confirmar que la fila es la suya comparaba contra un dato
     * invisible. Va segunda —pegada al folio— porque las dos son la misma
     * pregunta: «¿cuál venta es ésta?».
     */
    it("el código de barras es la SEGUNDA columna, al lado del folio", async () => {
      mocked.listSales.mockResolvedValue(pagina([venta({ barcode: "202608240045" })]));
      await renderRuta("/pos/sales", ["pos:view"]);

      const fila = (await screen.findByText("VTA-000001")).closest("tr") as HTMLElement;
      const tabla = fila.closest("table") as HTMLElement;

      expect(within(tabla).getAllByRole("columnheader")[1]).toHaveTextContent("Código de barras");
      expect(within(fila).getAllByRole("cell")[1]).toHaveTextContent("202608240045");
    });

    /**
     * Las ventas anteriores al cambio tienen `barcode` nulo y NO se
     * backfillearon (decisión del plan): la columna tiene que decir «no hay»
     * en vez de dejar un hueco que parece un dato perdido.
     */
    it("una venta sin código pinta un guion, no un vacío", async () => {
      mocked.listSales.mockResolvedValue(pagina([venta({ barcode: null })]));
      await renderRuta("/pos/sales", ["pos:view"]);

      const fila = (await screen.findByText("VTA-000001")).closest("tr") as HTMLElement;
      expect(within(fila).getAllByRole("cell")[1]).toHaveTextContent("—");
    });

    /**
     * El buscador sigue diciendo «Folio o código» —busca por los dos— pero la
     * COLUMNA del folio ya no puede llamarse igual: al lado de la columna del
     * código, «Folio o código» sería mentira.
     */
    it("la columna del folio se llama Folio, aunque el buscador diga Folio o código", async () => {
      await renderRuta("/pos/sales", ["pos:view"]);

      const fila = (await screen.findByText("VTA-000001")).closest("tr") as HTMLElement;
      const tabla = fila.closest("table") as HTMLElement;

      expect(within(tabla).getAllByRole("columnheader")[0]).toHaveTextContent("Folio");
      expect(within(tabla).getAllByRole("columnheader")[0]).not.toHaveTextContent("código");
    });

    it("sin ventas lo dice, en vez de dejar una tabla vacía", async () => {
      mocked.listSales.mockResolvedValue(pagina([]));
      await renderRuta("/pos/sales", ["pos:view"]);

      expect(await screen.findByText(/Todavía no hay ventas/)).toBeInTheDocument();
    });

    /**
     * ⚠ Esconder las anuladas por defecto sería tentador —«ruido»— y sería
     * exactamente lo contrario de lo que necesita quien audita.
     */
    it("una venta anulada se VE, marcada", async () => {
      mocked.listSales.mockResolvedValue(
        pagina([venta({ status: "canceled", canceledAt: "2026-08-21T17:00:00.000Z" })]),
      );
      await renderRuta("/pos/sales", ["pos:view"]);

      const fila = (await screen.findByText("VTA-000001")).closest("tr") as HTMLElement;
      // Acotado a la FILA: "Anulada" también es una opción del filtro de
      // estado, y buscarlo en toda la pantalla encontraría las dos.
      expect(within(fila).getByText("Anulada")).toBeInTheDocument();
    });

    it("el filtro por estado consulta al servidor, no filtra en el cliente", async () => {
      await renderRuta("/pos/sales", ["pos:view"]);
      await screen.findByText("VTA-000001");

      await userEvent.selectOptions(screen.getByLabelText("Estado"), "canceled");

      // Server-side: el historial son miles de filas y filtrar en el cliente
      // solo acotaría la página que ya llegó.
      await waitFor(() =>
        expect(mocked.listSales).toHaveBeenCalledWith(
          expect.objectContaining({ status: "canceled" }),
        ),
      );
    });
  });

  describe("anular", () => {
    /**
     * ⚠ `pos:cancel` NO está en el rol de mostrador: deshacer una operación
     * asentada es decisión de gestión. Pintar el botón para quien no puede
     * usarlo sería prometer algo que el API rechaza con 403.
     */
    it("sin `pos:cancel` el botón no se pinta", async () => {
      await renderRuta("/pos/sales", ["pos:view"]);
      await screen.findByText("VTA-000001");

      expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
    });

    it("con `pos:cancel` el botón está", async () => {
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");

      expect(screen.getByRole("button", { name: "Anular" })).toBeInTheDocument();
    });

    it("una venta YA anulada no ofrece anular de nuevo", async () => {
      mocked.listSales.mockResolvedValue(pagina([venta({ status: "canceled" })]));
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");

      // El API contestaría 409 y el botón habría mentido.
      expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
    });

    /**
     * El `colSpan` del diálogo tiene que seguir a la tabla: cada columna nueva
     * lo deja corto y el formulario de anular se encoge contra el borde. Este
     * test es la alarma que avisa cuando alguien agrega una columna y olvida
     * el número.
     */
    it("el diálogo de anular abarca la tabla entera", async () => {
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");
      await userEvent.click(screen.getByRole("button", { name: "Anular" }));

      const celda = (await screen.findByTestId("cancel-VTA-000001")).closest(
        "td",
      ) as HTMLTableCellElement;
      const tabla = celda.closest("table") as HTMLElement;
      const columnas = within(tabla).getAllByRole("columnheader").length;

      expect(celda.colSpan).toBe(columnas);
    });

    /**
     * El motivo es obligatorio en el API (mínimo 3 caracteres). Decirlo ANTES
     * del clic es mejor que dejar chocar con el 422.
     */
    it("sin motivo el confirmar está bloqueado", async () => {
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");
      await userEvent.click(screen.getByRole("button", { name: "Anular" }));

      const dialogo = await screen.findByTestId("cancel-VTA-000001");
      expect(within(dialogo).getByRole("button", { name: "Anular" })).toBeDisabled();
    });

    it("con motivo, anula y manda la razón", async () => {
      mocked.cancelSale.mockResolvedValue({ ...venta(), status: "canceled" });
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");
      await userEvent.click(screen.getByRole("button", { name: "Anular" }));

      await userEvent.type(
        await screen.findByLabelText(/Por qué se anula/),
        "el cliente devolvió todo",
      );
      const dialogo = screen.getByTestId("cancel-VTA-000001");
      await userEvent.click(within(dialogo).getByRole("button", { name: "Anular" }));

      await waitFor(() =>
        expect(mocked.cancelSale).toHaveBeenCalledWith("sale-1", "el cliente devolvió todo"),
      );
    });

    /**
     * Lección del confirm mudo de F3: el error del server NUNCA se traga.
     */
    it("un rechazo del servidor se pinta DENTRO del diálogo", async () => {
      mocked.cancelSale.mockRejectedValue({
        statusCode: 409,
        message: "Esa venta ya está anulada.",
        error: "Conflict",
        code: "pos.sale_already_canceled",
      });
      await renderRuta("/pos/sales", ["pos:view", "pos:cancel"]);
      await screen.findByText("VTA-000001");
      await userEvent.click(screen.getByRole("button", { name: "Anular" }));
      await userEvent.type(await screen.findByLabelText(/Por qué se anula/), "me equivoqué");

      const dialogo = screen.getByTestId("cancel-VTA-000001");
      await userEvent.click(within(dialogo).getByRole("button", { name: "Anular" }));

      expect(await within(dialogo).findByText(/ya está anulada/)).toBeInTheDocument();
    });
  });
});

/**
 * F4-TICKET-02 — imprimir y reimprimir.
 *
 * Lo que se protege: **fallar no pierde nada.** La venta ya está cobrada y el
 * papel se puede volver a sacar del historial cuando se quiera, así que el
 * error se AVISA y no bloquea ni reintenta.
 */
describe("Imprimir el ticket (F4-TICKET-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.listSales.mockResolvedValue(pagina([venta()]));
    mocked.printTicket.mockResolvedValue(undefined);
  });

  it("desde el historial se reimprime cualquier venta", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByText("VTA-000001");

    await userEvent.click(screen.getByRole("button", { name: "Reimprimir" }));

    await waitFor(() =>
      expect(mocked.printTicket).toHaveBeenCalledWith("sale", "sale-1", "VTA-000001", undefined),
    );
  });

  /**
   * ⚠ Reimprimir es LEER. Quien reclama trae en la mano el ticket de la venta
   * que se anuló: esconder el botón lo dejaría sin poder comparar nada.
   */
  it("una venta ANULADA también se reimprime", async () => {
    mocked.listSales.mockResolvedValue(pagina([venta({ status: "canceled" })]));
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByText("VTA-000001");

    expect(screen.getByRole("button", { name: "Reimprimir" })).toBeInTheDocument();
  });

  /**
   * El navegador no muestra NADA cuando una descarga falla: sin este aviso el
   * usuario cree que el ticket salió y va a buscarlo a la impresora.
   */
  it("si falla lo dice, y no rompe nada más", async () => {
    mocked.printTicket.mockRejectedValue(new Error("bloqueado"));
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByText("VTA-000001");

    await userEvent.click(screen.getByRole("button", { name: "Reimprimir" }));

    expect(await screen.findByText(/No pudimos abrir el ticket/)).toBeInTheDocument();
    // La fila sigue ahí: imprimir no es una operación sobre la venta.
    expect(screen.getByText("VTA-000001")).toBeInTheDocument();
  });
});

/**
 * ── FILTRO POR RANGO DE FECHAS (2026-08-24, pedido de Carlos) ─────────────
 *
 * El mismo `DateRangeFilter` que ya usan Entradas, Salidas e Inventario: son
 * cuatro pantallas hoy y los reportes de F5 pedirán la quinta. Copiarlo sería
 * garantizar que una se quede atrás y mienta sin ponerse roja.
 *
 * Ninguna de las dos arranca acotada, a diferencia del Kardex: acá se entra a
 * buscar «la venta que no cuadra» o «la cotización de la semana pasada», y un
 * rango por defecto escondería justo lo que se busca.
 */
describe("Historial de ventas: rango de fechas (F4-SALE-04)", () => {
  it("pinta el filtro de rango de fechas", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);

    expect(await screen.findByLabelText(/desde/i)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/hasta/i)).toHaveAttribute("type", "date");
  });

  it("elegir un rango lo manda al API", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByLabelText(/desde/i);

    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: "2026-08-24" } });

    await waitFor(() => {
      expect(mocked.listSales).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-01", to: "2026-08-24" }),
      );
    });
  });

  it("sin rango puesto, no viajan fechas vacías", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByLabelText(/desde/i);

    // Mandar `from: ""` haría que el API rechace la consulta por formato.
    const enviado = mocked.listSales.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(enviado.from).toBeUndefined();
    expect(enviado.to).toBeUndefined();
  });
});

/**
 * (1) Carlos: «no se ve alineado el estado con los rangos de fechas».
 *
 * La barra mezclaba dos criterios: el «Estado» era etiqueta al LADO del
 * control (`items-center`) y el filtro de fechas trae la etiqueta ENCIMA. Con
 * alturas distintas, los controles quedaban a distinto nivel. Se unifica al
 * molde del filtro compartido: etiqueta arriba y todo alineado por la BASE.
 */
describe("Historial de ventas: la barra de filtros (F4-SALE-04)", () => {
  it("todos los filtros se alinean por la base, con su etiqueta encima", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);

    const desde = await screen.findByLabelText(/desde/i);
    const barra = desde.closest("div")?.parentElement;

    expect(barra?.className).toContain("items-end");
    expect(barra?.className).not.toContain("items-center");
  });

  /**
   * ── BUSCAR POR FOLIO (2026-08-24) ─────────────────────────────────────
   *
   * Nace junto al código de barras del ticket: se escanea el papel (cámara o
   * pistola USB sobre el campo) y aparece la venta para reimprimir o anular.
   * También sirve dictado por teléfono — el filtro es parcial.
   */
  it("teclear un folio lo manda al API", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/folio/i), "000009");

    await waitFor(() => {
      expect(mocked.listSales).toHaveBeenCalledWith(expect.objectContaining({ folio: "000009" }));
    });
  });

  it("un folio vacío NO viaja", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);
    await screen.findByLabelText(/folio/i);

    const enviado = mocked.listSales.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(enviado.folio).toBeUndefined();
  });

  it("el Estado tiene su etiqueta ENCIMA, como los demás", async () => {
    await renderRuta("/pos/sales", ["pos:view"]);

    const select = await screen.findByLabelText(/estado/i);
    // La etiqueta y el control comparten un contenedor en COLUMNA: si fueran
    // hermanos en fila, la etiqueta volvería al costado.
    expect(select.closest("label,div")?.className).toContain("flex-col");
  });
});
