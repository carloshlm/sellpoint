import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { LookupProductItem } from "@/lib/pos/api";
import { useCartStore } from "@/stores/cart.store";
import { CartPanel } from "./cart-panel";

/**
 * «Vaciar carrito» (Carlos, 2026-11-01). El carrito ahora sobrevive a una
 * recarga y se queda durante el turno: tiene que haber una forma explícita de
 * limpiarlo completo. Pide confirmación, porque quitar veinte productos por un
 * clic de más obliga a escanearlos otra vez con el cliente enfrente.
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

function renderPanel() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <CartPanel />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe("vaciar el carrito", () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it("pide confirmación y, al confirmar, quita todos los productos y la cotización", async () => {
    const user = renderPanel();
    act(() => {
      useCartStore.getState().add(producto("agua", "Agua 1L"));
      useCartStore.getState().add(producto("jarritos", "Jarritos"));
      useCartStore.getState().setQuoteId("q1");
    });

    await user.click(screen.getByRole("button", { name: "Vaciar carrito" }));
    const dialogo = screen.getByRole("alertdialog", { name: "¿Vaciar el carrito?" });
    expect(dialogo).toHaveTextContent("Se quitan los 2 productos del carrito.");
    expect(useCartStore.getState().lines).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Vaciar" }));

    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().quoteId).toBeNull();
  });

  it("cancelar deja el carrito como estaba", async () => {
    const user = renderPanel();
    act(() => useCartStore.getState().add(producto("agua", "Agua 1L")));

    await user.click(screen.getByRole("button", { name: "Vaciar carrito" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Se quita 1 producto del carrito.");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("con el carrito vacío no hay botón para vaciarlo", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Vaciar carrito" })).not.toBeInTheDocument();
  });
});
