import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { LookupProductItem } from "@/lib/pos/api";
import { useCartStore } from "@/stores/cart.store";
import { CartPanel } from "./cart-panel";

/**
 * La selección sigue al último producto escaneado (Carlos, 2026-11-01).
 *
 * Con el teclado abierto sobre «Agua 1L», Carlos escaneó «OLANZAPINA» y quiso
 * ponerle 3: el renglón marcado seguía siendo el Agua y el teclado le cambiaba
 * la cantidad al producto equivocado. Ahora, si el teclado está abierto, la
 * selección pasa al renglón que acaba de entrar —o que subió por escanearlo
 * otra vez—. Si está cerrado, sigue cerrado: abrirlo en cada escaneo taparía
 * media pantalla.
 */
const producto = (id: string, name: string): LookupProductItem => ({
  type: "product",
  matchedBy: "sku",
  id,
  sku: id.toUpperCase(),
  name,
  baseUnit: "unit",
  isComposite: false,
  available: "50",
  expired: "0",
  presentations: [
    {
      id: `${id}-pieza`,
      name: "Pieza",
      factor: "1",
      price: "14.00",
      barcode: null,
      isDefaultSale: true,
      allowFractionalInput: false,
    },
  ],
  matchedPresentationId: null,
});

const AGUA = producto("agua", "Agua 1L");
const OLANZAPINA = producto("olanzapina", "OLANZAPINA TABLETA 5 mg");
const claveDe = (item: LookupProductItem) => `product:${item.id}:${item.id}-pieza`;
const cantidadDe = (item: LookupProductItem) =>
  useCartStore.getState().lines.find((l) => l.key === claveDe(item))?.quantity;
const fila = (item: LookupProductItem) => screen.getByTestId(`cart-line-${claveDe(item)}`);

function renderPanel() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <CartPanel />
    </I18nextProvider>,
  );
}

describe("la selección del carrito sigue al último producto escaneado", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [], errorSku: null, lastAdded: null });
  });

  it("con el teclado abierto, un producto nuevo se lleva la selección y el teclado le cambia SU cantidad", () => {
    renderPanel();
    act(() => useCartStore.getState().add(AGUA, { quantity: "5" }));
    fireEvent.click(screen.getByTestId(`cart-qty-${claveDe(AGUA)}`));
    expect(fila(AGUA)).toHaveClass("border-primary");

    act(() => useCartStore.getState().add(OLANZAPINA));

    expect(fila(OLANZAPINA)).toHaveClass("border-primary");
    expect(fila(AGUA)).not.toHaveClass("border-primary");
    expect(screen.getByLabelText("Cantidad")).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(cantidadDe(AGUA)).toBe("5");
    expect(cantidadDe(OLANZAPINA)).not.toBe("1");
  });

  it("escanear otra vez un producto que ya estaba le devuelve la selección", () => {
    renderPanel();
    act(() => useCartStore.getState().add(AGUA));
    act(() => useCartStore.getState().add(OLANZAPINA));
    fireEvent.click(screen.getByTestId(`cart-qty-${claveDe(OLANZAPINA)}`));

    act(() => useCartStore.getState().add(AGUA));

    expect(fila(AGUA)).toHaveClass("border-primary");
    expect(screen.getByLabelText("Cantidad")).toHaveValue("2");
  });

  it("con el teclado cerrado, escanear no lo abre", () => {
    renderPanel();
    act(() => useCartStore.getState().add(AGUA));
    act(() => useCartStore.getState().add(OLANZAPINA));

    expect(screen.queryByTestId("numpad")).not.toBeInTheDocument();
    expect(fila(OLANZAPINA)).not.toHaveClass("border-primary");
  });
});
