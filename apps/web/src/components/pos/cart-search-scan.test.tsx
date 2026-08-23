import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  QuoteLoadPanel: ({ folio }: { folio: string }) => <div data-testid="quote-panel">{folio}</div>,
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
    vi.clearAllMocks();
    useCartStore.setState({ lines: [] });
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
    const nombres = useCartStore.getState().lines.map((l) => l.name);
    expect(nombres).toEqual(["Oatmeal Bars", "Granola"]);
  });

  it("un escaneo AMBIGUO cae al input para que una persona elija", async () => {
    lookupMock.mockResolvedValue({ warehouseId: "w1", exact: false, items: [AVENA, GRANOLA] });
    renderBuscador();

    await escanear("0640");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("0640"));
    expect(useCartStore.getState().lines).toHaveLength(0);
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
