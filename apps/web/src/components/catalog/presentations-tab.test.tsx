import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { Presentation } from "@/lib/products/api";
import { PresentationsTab } from "./presentations-tab";

/**
 * F2-PRESENT. Lo que se fija acá es que la pantalla hable el idioma del
 * usuario y no el de la base: la tabla decía "Equivale en gr" porque pasaba el
 * CÓDIGO de la unidad a la etiqueta.
 */
const update = vi.fn();
const remove = vi.fn();

vi.mock("@/lib/products/hooks", () => ({
  useCreatePresentation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePresentation: () => ({ mutate: update, isPending: false }),
  useDeletePresentation: () => ({ mutate: remove, isPending: false }),
}));

const basePresentation: Presentation = {
  id: "p1",
  productId: "prod-1",
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

/**
 * Los tres huecos que reportó Carlos (2026-08-17): la fila se veía pero no se
 * podía tocar. "Se compra" y "Se vende" eran un ✓ pintado, no había forma de
 * corregir un factor mal cargado y tampoco de eliminar la presentación
 * equivocada.
 */
describe("PresentationsTab — la fila se puede operar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("«Se compra» y «Se vende» se cambian de un clic, sin abrir nada", async () => {
    const user = userEvent.setup();
    renderTab("gr");

    await user.click(screen.getByLabelText("Se vende en «Unidad»"));

    expect(update).toHaveBeenCalledWith(
      { presentationId: "p1", input: { isSellable: false } },
      expect.anything(),
    );
  });

  it("editar manda los cuatro datos juntos y solo al confirmar", async () => {
    const user = userEvent.setup();
    renderTab("gr");

    await user.click(screen.getByRole("button", { name: "Editar" }));
    // Mientras se edita NO se guardó nada todavía: el precio se confirma.
    expect(update).not.toHaveBeenCalled();

    const factor = screen.getByLabelText("Equivalencia");
    await user.clear(factor);
    await user.type(factor, "2000");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(update).toHaveBeenCalledWith(
      {
        presentationId: "p1",
        input: { name: "Unidad", factor: 2000, barcode: null, price: 0.02 },
      },
      expect.anything(),
    );
  });

  it("un precio con tres decimales bloquea el guardado de la fila", async () => {
    const user = userEvent.setup();
    renderTab("gr");

    await user.click(screen.getByRole("button", { name: "Editar" }));
    const price = screen.getByLabelText("Precio");
    await user.clear(price);
    await user.type(price, "15.555");

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("vaciar el código de barras lo BORRA en vez de dejarlo como estaba", async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n()}>
        <PresentationsTab
          productId="prod-1"
          baseUnit="gr"
          presentations={[{ ...basePresentation, barcode: "BOLSA1KG001" }]}
          canManage
        />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(screen.getByLabelText("Código de barras"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // `null` explícito: sin esto no habría forma de quitar un código mal puesto.
    expect(update.mock.calls[0]?.[0].input.barcode).toBeNull();
  });

  /**
   * El borrado es REAL e irreversible (a diferencia de Desactivar, que se puede
   * revertir de un clic), y los dos botones están pegados en la misma fila. Sin
   * confirmación, un clic de más borra una presentación con su código de barras
   * y su precio, y no hay «deshacer».
   */
  describe("confirmación de borrado", () => {
    it("el primer clic PREGUNTA, no borra", async () => {
      const user = userEvent.setup();
      renderTab("gr");

      await user.click(screen.getByRole("button", { name: "Eliminar" }));

      const dialog = await screen.findByTestId("remove-presentation-dialog");
      // Nombra lo que se va a borrar: en una tabla de varias filas, el usuario
      // tiene que poder ver que apuntó a la correcta.
      expect(dialog).toHaveTextContent("Unidad");
      expect(remove).not.toHaveBeenCalled();
    });

    it("recién al confirmar se borra", async () => {
      const user = userEvent.setup();
      renderTab("gr");

      await user.click(screen.getByRole("button", { name: "Eliminar" }));
      await user.click(await screen.findByRole("button", { name: "Eliminar presentación" }));

      expect(remove).toHaveBeenCalledWith("p1", expect.anything());
      expect(update).not.toHaveBeenCalled();
    });

    it("cancelar cierra el diálogo y no toca nada", async () => {
      const user = userEvent.setup();
      renderTab("gr");

      await user.click(screen.getByRole("button", { name: "Eliminar" }));
      await user.click(await screen.findByRole("button", { name: "Cancelar" }));

      expect(screen.queryByTestId("remove-presentation-dialog")).not.toBeInTheDocument();
      expect(remove).not.toHaveBeenCalled();
    });

    it("desactivar sigue siendo de un clic: es reversible", async () => {
      // La confirmación va SOLO donde no hay vuelta atrás. Pedirla para todo
      // entrena al usuario a aceptar sin leer.
      const user = userEvent.setup();
      renderTab("gr");

      await user.click(screen.getByRole("button", { name: "Desactivar" }));

      expect(update).toHaveBeenCalledWith(
        { presentationId: "p1", input: { isActive: false } },
        expect.anything(),
      );
      expect(screen.queryByTestId("remove-presentation-dialog")).not.toBeInTheDocument();
    });
  });

  it("sin permiso de gestión no aparece ninguna acción", () => {
    render(
      <I18nextProvider i18n={createI18n()}>
        <PresentationsTab
          productId="prod-1"
          baseUnit="gr"
          presentations={[basePresentation]}
          canManage={false}
        />
      </I18nextProvider>,
    );

    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Se vende en «Unidad»")).toBeDisabled();
  });
});
