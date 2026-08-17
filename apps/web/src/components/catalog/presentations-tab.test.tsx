import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { Presentation } from "@/lib/products/api";
import { PresentationsTab } from "./presentations-tab";

/**
 * F2-PRESENT. Lo que se fija acá es que la pantalla hable el idioma del
 * usuario y no el de la base: la tabla decía "Equivale en gr" porque pasaba el
 * CÓDIGO de la unidad a la etiqueta.
 */
vi.mock("@/lib/products/hooks", () => ({
  useCreatePresentation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePresentation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const basePresentation: Presentation = {
  id: "p1",
  name: "Unidad",
  factor: "1",
  isPurchasable: true,
  isSellable: true,
  isDefaultSale: true,
  allowFractionalInput: true,
  barcode: null,
  price: "0.02",
  cost: null,
  isActive: true,
};

function renderTab(baseUnit: string) {
  render(
    <I18nextProvider i18n={createI18n()}>
      <PresentationsTab
        productId="prod-1"
        baseUnit={baseUnit}
        presentations={[basePresentation]}
        canManage
      />
    </I18nextProvider>,
  );
}

describe("PresentationsTab — la unidad base se nombra, no se codifica", () => {
  it("la columna dice el nombre en PLURAL, no el código", () => {
    renderTab("gr");

    expect(screen.getByText("Equivale en gramos")).toBeInTheDocument();
    expect(screen.queryByText("Equivale en gr")).not.toBeInTheDocument();
  });

  it("la ayuda de arriba usa el mismo nombre", () => {
    renderTab("gr");

    expect(
      screen.getByText("Las equivalencias se expresan en la unidad base del producto: gramos."),
    ).toBeInTheDocument();
  });

  it("«Unidad» pluraliza como «unidades»: por eso el plural es un dato y no una `s`", () => {
    renderTab("unit");

    expect(screen.getByText("Equivale en unidades")).toBeInTheDocument();
  });

  it("una unidad desconocida cae al código en vez de dejar la frase coja", () => {
    // Un producto viejo con una unidad retirada del catálogo: ver el código es
    // mejor que ver "Equivale en " y no entender qué pasó.
    renderTab("xx");

    expect(screen.getByText("Equivale en xx")).toBeInTheDocument();
  });
});
