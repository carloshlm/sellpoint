import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { CompositionLine } from "@/lib/products/api";
import { CompositionTab } from "./composition-tab";

/**
 * F2-BOM. El API devuelve la RUTA del campo que falló
 * (`lines.0.wastePercentage`), pero el formulario solo pintaba el mensaje
 * general arriba: con cinco componentes, el usuario leía "Debe ser 100 o menos"
 * y tenía que adivinar en cuál de las cinco filas estaba el 1000.
 */
const replace = vi.fn();

vi.mock("@/lib/products/hooks", () => ({
  useComposition: () => ({ data: SAVED }),
  useAvailability: () => ({ data: { units: 0, limitedBy: null } }),
  useCostEstimate: () => ({ data: { total: "0", lines: [] } }),
  useReplaceComposition: () => ({ mutate: replace, isPending: false }),
  useProducts: () => ({ data: { total: 0, page: 1, pageSize: 10, items: [] } }),
}));

const line = (id: string, sku: string, name: string): CompositionLine => ({
  id,
  componentProductId: id,
  quantity: "20",
  wastePercentage: "0",
  notes: null,
  component: { id, sku, name, baseUnit: "gr" },
});

const SAVED: CompositionLine[] = [
  line("c1", "AZU", "Azucar"),
  line("c2", "LECHE", "Leche"),
  line("c3", "CAFE", "Cafe en Grano"),
];

/**
 * Renderiza y deja la tabla con cambios pendientes: el botón de guardar solo
 * aparece cuando hay un borrador, así que primero se toca un campo.
 */
async function renderTabAndSave() {
  render(
    <I18nextProvider i18n={createI18n()}>
      <CompositionTab productId="prod-1" canManage />
    </I18nextProvider>,
  );
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Cantidad de «Cafe en Grano»"), "5");
  await user.click(await screen.findByRole("button", { name: "Guardar composición" }));
  return user;
}

/** Dispara el `onError` que el componente le pasó a la mutación. */
function failWith(errors: unknown) {
  const options = replace.mock.calls[0]?.[1];
  options.onError({
    statusCode: 400,
    message: "Los datos enviados no son válidos.",
    error: "Bad Request",
    errors,
  });
}

describe("CompositionTab — el error se pinta sobre la fila", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("el mensaje aparece bajo el campo de LA fila que falló, no arriba de todo", async () => {
    await renderTabAndSave();
    failWith([
      { key: "lines.1.wastePercentage", message: "Debe ser 100 o menos.", code: "validation.max" },
    ]);

    // La fila de Leche (índice 1) es la que se pinta.
    const fila = await screen.findByTestId("composition-LECHE");
    expect(within(fila).getByText("Debe ser 100 o menos.")).toBeInTheDocument();
    expect(within(fila).getByLabelText("Merma de «Leche»")).toBeInvalid();

    // Y las otras NO: si se pintaran todas, señalar la fila no serviría de nada.
    expect(within(screen.getByTestId("composition-AZU")).queryByRole("alert")).toBeNull();
    expect(within(screen.getByTestId("composition-CAFE")).queryByRole("alert")).toBeNull();
  });

  it("distingue el campo dentro de la misma fila: cantidad y merma no son lo mismo", async () => {
    await renderTabAndSave();
    failWith([
      {
        key: "lines.0.quantity",
        message: "Debe ser mayor que 0.",
        code: "validation.greater_than",
      },
    ]);

    const fila = await screen.findByTestId("composition-AZU");
    expect(within(fila).getByLabelText("Cantidad de «Azucar»")).toBeInvalid();
    expect(within(fila).getByLabelText("Merma de «Azucar»")).toBeValid();
  });

  it("corregir el campo borra su error: no se queda en rojo con el valor ya arreglado", async () => {
    const user = await renderTabAndSave();
    failWith([{ key: "lines.1.wastePercentage", message: "Debe ser 100 o menos." }]);

    const fila = await screen.findByTestId("composition-LECHE");
    await user.clear(within(fila).getByLabelText("Merma de «Leche»"));

    await waitFor(() =>
      expect(within(fila).queryByText("Debe ser 100 o menos.")).not.toBeInTheDocument(),
    );
  });

  it("un error SIN campos (409 de negocio) se sigue mostrando arriba", async () => {
    // El ciclo de composición no señala una fila: habla de la relación entera.
    await renderTabAndSave();
    failWith(undefined);

    expect(await screen.findByTestId("composition-error")).toBeInTheDocument();
  });
});
