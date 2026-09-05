import { act, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { LookupProductItem } from "@/lib/pos/api";
import { useCartStore } from "@/stores/cart.store";
import { CartPanel } from "./cart-panel";

/**
 * F4-CART-02 — el DESTELLO de la línea que cambió (2026-08-23).
 *
 * Pedido de Carlos con el escaneo continuo ya vivo: al pasar el mismo
 * producto dos o más veces la cantidad sube, «pero no es muy claro el cambio».
 * La vibración dice que el escáner LEYÓ; el destello dice QUÉ cambió en el
 * carrito — la línea nueva o la que incrementó — y se apaga solo, porque un
 * resaltado que se queda deja de señalar.
 */

const AVENA: LookupProductItem = {
  type: "product",
  matchedBy: "sku",
  id: "prod-avena",
  sku: "064042603179",
  name: "Oatmeal Bars",
  baseUnit: "unit",
  isComposite: false,
  available: "20",
  expired: "0",
  presentations: [
    {
      id: "pres-pieza",
      name: "Pieza",
      factor: "1",
      price: "20.00",
      barcode: null,
      isDefaultSale: true,
      allowFractionalInput: false,
    },
  ],
  matchedPresentationId: null,
};

function renderPanel() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <CartPanel />
    </I18nextProvider>,
  );
}

const filaAvena = () => screen.getByTestId("cart-line-product:prod-avena:pres-pieza");

describe("destello del carrito (F4-CART-02)", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [], errorSku: null });
  });

  it("una línea nueva DESTELLA al aparecer", () => {
    renderPanel();

    act(() => {
      useCartStore.getState().add(AVENA);
    });

    expect(filaAvena().dataset.flash).toBe("true");
  });

  it("el destello se APAGA solo", async () => {
    renderPanel();
    act(() => {
      useCartStore.getState().add(AVENA);
    });

    await waitFor(() => expect(filaAvena().dataset.flash).toBeUndefined(), { timeout: 2000 });
  });

  it("el mismo producto escaneado otra vez vuelve a destellar al subir la cantidad", async () => {
    renderPanel();
    act(() => {
      useCartStore.getState().add(AVENA);
    });
    // Se deja apagar el primero: lo que se prueba es que el INCREMENTO
    // dispara uno nuevo, no que el de la aparición siga prendido.
    await waitFor(() => expect(filaAvena().dataset.flash).toBeUndefined(), { timeout: 2000 });

    act(() => {
      useCartStore.getState().add(AVENA);
    });

    expect(filaAvena().dataset.flash).toBe("true");
    expect(filaAvena().textContent).toContain("2");
  });
});

/**
 * F4-POSVIS: el aviso «Más de lo que hay en este almacén» solo existe cuando
 * el API mandó la existencia. Con «Mostrar existencias» apagado viaja en
 * null, y el carrito no tiene con qué (ni debe) avisar.
 */
describe("el aviso de faltante y «Mostrar existencias» (F4-POSVIS)", () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [], errorSku: null });
  });

  it("con existencia conocida, pedir de más avisa", () => {
    renderPanel();
    act(() => {
      useCartStore.getState().add(AVENA, { quantity: "999" });
    });
    expect(screen.getByText("Más de lo que hay en este almacén")).toBeInTheDocument();
  });

  it("sin el dato (available null) no hay aviso, aunque se pida mucho", () => {
    renderPanel();
    act(() => {
      useCartStore
        .getState()
        .add({ ...AVENA, available: null, expired: null }, { quantity: "999" });
    });
    expect(screen.queryByText("Más de lo que hay en este almacén")).not.toBeInTheDocument();
  });
});
