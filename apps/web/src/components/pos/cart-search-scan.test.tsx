import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as posApi from "@/lib/pos/api";
import { useCartStore } from "@/stores/cart.store";
import { CartSearch } from "./cart-search";

/**
 * F4-CART-04 — el escaneo como ACCIÓN, no como búsqueda (2026-08-23).
 *
 * **El bug que motiva este archivo:** Carlos, con el escáner ya leyendo:
 * «escanea bien pero a veces no agrega el producto». La causa era de diseño:
 * `onScan` metía el código por el MISMO estado que el teclado (`setTexto`), y
 * el agregado dependía de la consulta reactiva de ese estado. Si un segundo
 * escaneo llegaba con la consulta del primero EN VUELO, la clave cambiaba y
 * el primero se perdía sin ruido — «a veces», exactamente.
 *
 * El arreglo: escanear es una acción imperativa con COLA SECUENCIAL — cada
 * código consulta y agrega uno por uno, sin pasar por el input. El input
 * queda para lo que teclea una persona (y como destino de lo ambiguo).
 */

let proximoCodigo = "";

vi.mock("@/components/pos/barcode-scanner", () => ({
  // Un escáner de mentira con un botón: dispara `onScan` sin cámara ni zxing.
  BarcodeScanner: ({ onScan }: { onScan: (texto: string) => void }) => (
    <button type="button" onClick={() => onScan(proximoCodigo)}>
      simular-escaneo
    </button>
  ),
}));

vi.mock("@/components/pos/quote-load-panel", () => ({
  QuoteLoadPanel: ({ folio, onClose }: { folio: string; onClose: () => void }) => (
    <div data-testid="quote-panel">
      {folio}
      <button type="button" onClick={onClose}>
        cerrar-panel
      </button>
    </div>
  ),
}));

vi.mock("@/lib/pos/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pos/api")>()),
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(posApi.lookup);

const PIEZA: posApi.LookupPresentation = {
  id: "pres-pieza",
  name: "Pieza",
  factor: "1",
  price: "20.00",
  barcode: null,
  isDefaultSale: true,
  allowFractionalInput: false,
};

const AVENA: posApi.LookupProductItem = {
  type: "product",
  matchedBy: "sku",
  id: "prod-avena",
  sku: "064042603179",
  name: "Oatmeal Bars",
  baseUnit: "unit",
  isComposite: false,
  available: "20",
  expired: "0",
  presentations: [PIEZA],
  matchedPresentationId: null,
};

const GRANOLA: posApi.LookupProductItem = {
  ...AVENA,
  id: "prod-granola",
  sku: "064042999999",
  name: "Granola",
};

const exacto = (item: posApi.LookupItem): posApi.LookupResult => ({
  warehouseId: "w1",
  exact: true,
  items: [item],
});

function renderBuscador() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n()}>
        <CartSearch />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const escanear = (codigo: string) => {
  proximoCodigo = codigo;
  return userEvent.click(screen.getByRole("button", { name: "simular-escaneo" }));
};

describe("escaneo → carrito (cola imperativa)", () => {
  beforeEach(() => {
    // `clearAllMocks` borra las LLAMADAS, no las implementaciones: sin este
    // reset, un `mockImplementation` se filtra al test siguiente.
    lookupMock.mockReset();
    useCartStore.setState({ lines: [], pendingScans: 0 });
  });

  it("un código escaneado entra DIRECTO al carrito, sin pasar por el input", async () => {
    lookupMock.mockResolvedValue(exacto(AVENA));
    renderBuscador();

    await escanear("064042603179");

    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    // El input nunca vio el código: es el canal del TECLADO.
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("dos escaneos seguidos se agregan LOS DOS aunque el primero siga en vuelo", async () => {
    // El bug original: el segundo escaneo cambiaba la clave de la consulta y
    // el primero se perdía. La cola procesa UNO POR UNO, en orden.
    let resolverAvena: (r: posApi.LookupResult) => void = () => undefined;
    lookupMock
      .mockImplementationOnce(
        () =>
          new Promise<posApi.LookupResult>((res) => {
            resolverAvena = res;
          }),
      )
      .mockResolvedValueOnce(exacto(GRANOLA));
    renderBuscador();

    await escanear("064042603179");
    await escanear("064042999999");
    resolverAvena(exacto(AVENA));

    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(2));
    const nombres = useCartStore
      .getState()
      .lines.map((l) => (l.type === "concept" ? l.description : l.name));
    expect(nombres).toEqual(["Oatmeal Bars", "Granola"]);
  });

  it("un escaneo exitoso LIMPIA lo que hubiera tecleado en el campo", async () => {
    // El mock responde SEGÚN la consulta: "oat" es ambiguo (lo que teclea una
    // persona) y solo el código escaneado es exacto. Sin esta distinción el
    // test pasaba por la razón equivocada — el texto tecleado también daba
    // acierto exacto y se limpiaba solo.
    lookupMock.mockImplementation(async (q: string) =>
      q === "064042603179"
        ? exacto(AVENA)
        : { warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] },
    );
    renderBuscador();
    // El cajero tecleó media palabra y decidió escanear: el resto de la
    // búsqueda anterior no puede quedar colgando con su lista de resultados.
    await userEvent.type(screen.getByRole("textbox"), "oat");
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("oat"));

    await escanear("064042603179");

    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("un escaneo AMBIGUO cae al input para que una persona elija", async () => {
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] });
    renderBuscador();

    await escanear("0640");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("0640"));
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("con «Mostrar existencias» apagado (available null) la lista no dice cuántas hay (F4-POSVIS)", async () => {
    lookupMock.mockResolvedValue({
      warehouseId: "w1",
      exact: false,
      items: [
        { ...AVENA, available: null, expired: null },
        { ...GRANOLA, available: null, expired: null },
      ],
    });
    renderBuscador();

    await escanear("0640");

    expect(await screen.findByText("Granola")).toBeInTheDocument();
    expect(screen.queryByText(/disponibles/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vencidas/)).not.toBeInTheDocument();
  });

  it("un folio COT escaneado abre la confirmación, no una línea", async () => {
    lookupMock.mockResolvedValue(
      exacto({
        type: "quote",
        matchedBy: "quote",
        id: "q1",
        folio: "COT-000007",
        status: "open",
        total: "20.00",
        lineCount: 1,
      }),
    );
    renderBuscador();

    await escanear("COT-000007");

    expect(await screen.findByTestId("quote-panel")).toHaveTextContent("COT-000007");
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("si la consulta falla, el código cae al input — nada se pierde en silencio", async () => {
    lookupMock.mockRejectedValueOnce(new Error("red caída"));
    renderBuscador();

    await escanear("064042603179");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("064042603179"));
  });
});

/**
 * ── EL LECTOR DE MANO (Carlos, 2026-11-16) ─────────────────────────────────
 *
 * Un lector USB o Bluetooth es un TECLADO: escribe el código en el buscador,
 * un dígito por evento, y remata con un Enter. Un cliente reportó dos cosas:
 * «después de escanear se queda cargando y a veces tarda varios segundos» y
 * «cuando carga dos productos rápidamente, el segundo producto pisa al
 * anterior».
 *
 * Las dos venían de lo mismo. El buscador consultaba con CADA dígito: un
 * código de 12 eran 12 consultas, y la buena esperaba en la fila del
 * servidor detrás de las once a medias (en producción, 64 ms sola contra
 * 1.3 s de mediana y hasta 4.3 s en la ráfaga). Y el campo se limpiaba hasta
 * que llegaba la respuesta: si el segundo código llegaba antes, sus dígitos se
 * pegaban al primero y los dos se perdían.
 *
 * Las pruebas escriben como el lector —`fireEvent`, sin `userEvent`, que sí
 * espera a React— para no probar un aparato que no existe.
 */
describe("el lector de mano (teclea el código y un Enter)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    useCartStore.setState({ lines: [], pendingScans: 0 });
  });

  /** Como escribe el lector: un dígito por evento sobre lo que ya hay, y el Enter. */
  const teclearConLector = (codigo: string) => {
    const campo = screen.getByRole("textbox") as HTMLInputElement;
    let valor = campo.value;
    for (const caracter of codigo) {
      valor += caracter;
      fireEvent.change(campo, { target: { value: valor } });
    }
    fireEvent.keyDown(campo, { key: "Enter" });
  };

  it("dos códigos seguidos entran LOS DOS, en orden, aunque el primero siga en vuelo", async () => {
    let resolverAvena: (r: posApi.LookupResult) => void = () => undefined;
    lookupMock.mockImplementation((q: string) =>
      q === "064042603179"
        ? new Promise<posApi.LookupResult>((res) => {
            resolverAvena = res;
          })
        : Promise.resolve(
            q === "064042999999" ? exacto(GRANOLA) : { warehouseId: "w1", exact: false, items: [] },
          ),
    );
    renderBuscador();

    teclearConLector("064042603179");
    await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(1));
    // El segundo llega con el primero todavía buscándose: sus dígitos NO se
    // pegan al primero, porque el Enter ya dejó el campo vacío.
    teclearConLector("064042999999");
    resolverAvena(exacto(AVENA));

    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(2));
    const nombres = useCartStore
      .getState()
      .lines.map((l) => (l.type === "concept" ? l.description : l.name));
    expect(nombres).toEqual(["Oatmeal Bars", "Granola"]);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("un código del lector es UNA consulta, no una por dígito", async () => {
    lookupMock.mockResolvedValue(exacto(AVENA));
    renderBuscador();

    teclearConLector("064042603179");

    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith("064042603179", undefined);
  });

  it("mientras se agrega, el carrito lo sabe y la pantalla dice «Agregando al carrito…»", async () => {
    // El carrito lo sabe para que «Cobrar» espere: cobrar con un escaneo en
    // vuelo dejaría fuera de la venta el último producto.
    let resolverAvena: (r: posApi.LookupResult) => void = () => undefined;
    lookupMock.mockImplementation(
      () =>
        new Promise<posApi.LookupResult>((res) => {
          resolverAvena = res;
        }),
    );
    renderBuscador();

    teclearConLector("064042603179");

    expect(await screen.findByText("Agregando al carrito…")).toBeInTheDocument();
    expect(useCartStore.getState().pendingScans).toBe(1);

    resolverAvena(exacto(AVENA));

    await waitFor(() => expect(useCartStore.getState().pendingScans).toBe(0));
    expect(screen.queryByText("Agregando al carrito…")).not.toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it("un código que no se encuentra NO pisa lo que el lector ya está escribiendo: queda avisado", async () => {
    let resolverPrimero: (r: posApi.LookupResult) => void = () => undefined;
    lookupMock.mockImplementation(
      () =>
        new Promise<posApi.LookupResult>((res) => {
          resolverPrimero = res;
        }),
    );
    renderBuscador();

    teclearConLector("064042603179");
    await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(1));
    // El siguiente código va a la mitad cuando llega la respuesta del primero.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "7501" } });
    resolverPrimero({ warehouseId: "w1", exact: false, items: [] });

    expect(await screen.findByText("No se agregó: 064042603179")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("7501");
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("el aviso se cierra con su botón", async () => {
    let resolverPrimero: (r: posApi.LookupResult) => void = () => undefined;
    lookupMock.mockImplementation(
      () =>
        new Promise<posApi.LookupResult>((res) => {
          resolverPrimero = res;
        }),
    );
    renderBuscador();
    teclearConLector("064042603179");
    await waitFor(() => expect(lookupMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "7501" } });
    resolverPrimero({ warehouseId: "w1", exact: false, items: [] });
    await screen.findByText("No se agregó: 064042603179");

    await userEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));

    expect(screen.queryByText(/No se agregó/)).not.toBeInTheDocument();
  });

  it("si nada se está escribiendo, lo que no se encuentra cae al campo, como siempre", async () => {
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] });
    renderBuscador();

    teclearConLector("0640");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("0640"));
    expect(await screen.findByText("Granola")).toBeInTheDocument();
    expect(screen.queryByText(/No se agregó/)).not.toBeInTheDocument();
  });

  it("lo que no entra queda SELECCIONADO en el campo: el siguiente escaneo lo reemplaza", async () => {
    // Si quedara con el cursor al final, los dígitos del siguiente código se
    // pegarían al que no entró y se perderían los dos: el mismo «pisa al
    // anterior», con un código que no existe.
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [] });
    renderBuscador();

    teclearConLector("064042603179");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("064042603179"));
    const campo = screen.getByRole("textbox") as HTMLInputElement;
    await waitFor(() => expect(campo.selectionStart).toBe(0));
    expect(campo.selectionEnd).toBe("064042603179".length);
  });

  it("Enter sobre la lista que una persona está viendo la deja como está", async () => {
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] });
    renderBuscador();
    await userEvent.type(screen.getByRole("textbox"), "oat");
    await screen.findByText("Granola");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(screen.getByRole("textbox")).toHaveValue("oat");
    expect(screen.getByText("Granola")).toBeInTheDocument();
    expect(useCartStore.getState().pendingScans).toBe(0);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("cerrar el panel de una cotización y seguir tecleando no la vuelve a abrir", async () => {
    lookupMock.mockImplementation(async (q: string) =>
      q === "COT-000007"
        ? exacto({
            type: "quote",
            matchedBy: "quote",
            id: "q1",
            folio: "COT-000007",
            status: "open",
            total: "20.00",
            lineCount: 1,
          })
        : { warehouseId: "w1", exact: false, items: [] },
    );
    renderBuscador();
    await userEvent.type(screen.getByRole("textbox"), "COT-000007");
    await screen.findByTestId("quote-panel");

    await userEvent.click(screen.getByRole("button", { name: "cerrar-panel" }));
    // Antes de que pase la espera de la búsqueda.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a" } });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("quote-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("a");
  });

  it("un Enter con el campo vacío no consulta nada", async () => {
    renderBuscador();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(lookupMock).not.toHaveBeenCalled();
    expect(useCartStore.getState().pendingScans).toBe(0);
  });

  it("una persona que teclea media palabra sigue viendo la lista al dejar de escribir", async () => {
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] });
    renderBuscador();

    await userEvent.type(screen.getByRole("textbox"), "oat");

    expect(await screen.findByText("Granola")).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});
