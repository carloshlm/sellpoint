import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { useCaptureUnit } from "@/lib/use-capture-unit";
import { CaptureUnitToggle } from "./capture-unit-toggle";

/**
 * F10-BULK-04 — el botón de unidad junto a la cantidad (kg | g, L | ml…), una
 * sola pieza para la caja, el inventario y las compras. Lo tecleado se
 * convierte a la unidad base antes de guardarse; en un empaque no aparece,
 * porque ahí la cantidad son empaques.
 */
function Harness({
  baseUnit,
  atBasePresentation = true,
  typed = "",
}: {
  baseUnit: string;
  atBasePresentation?: boolean;
  typed?: string;
}) {
  const capture = useCaptureUnit(baseUnit, atBasePresentation);
  const result = capture.toBase(typed);
  return (
    <>
      <CaptureUnitToggle
        baseUnit={baseUnit}
        atBasePresentation={atBasePresentation}
        value={capture.unit}
        onChange={capture.setUnit}
      />
      <output data-testid="quantity">{result.quantity ?? ""}</output>
      <output data-testid="error">{result.error ?? ""}</output>
    </>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0], language: "es" | "en" = "es") {
  const i18n = createI18n();
  void i18n.changeLanguage(language);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness {...props} />
    </I18nextProvider>,
  );
  return { ...view, i18n };
}

const KILOS = "Escribir la cantidad en kilogramos";
const GRAMOS = "Escribir la cantidad en gramos";

describe("CaptureUnitToggle", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("muestra los símbolos como un grupo, con la base primero y aria-pressed", () => {
    renderHarness({ baseUnit: "kg" });

    const grupo = screen.getByRole("group");
    const botones = Array.from(grupo.querySelectorAll("button")).map((b) => b.textContent);
    expect(botones).toEqual(["kg", "g"]);
    expect(screen.getByRole("button", { name: KILOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: GRAMOS })).toHaveAttribute("aria-pressed", "false");
  });

  it("el nombre accesible sale del texto aprobado, también en inglés", () => {
    renderHarness({ baseUnit: "l" }, "en");

    expect(screen.getByRole("button", { name: "Enter the quantity in liters" })).toHaveTextContent(
      "L",
    );
    expect(
      screen.getByRole("button", { name: "Enter the quantity in milliliters" }),
    ).toHaveTextContent("ml");
  });

  it("en la base la cantidad pasa tal cual; en gramos se convierte a kilogramos", async () => {
    const { rerender, i18n } = renderHarness({ baseUnit: "kg", typed: "600" });
    expect(screen.getByTestId("quantity")).toHaveTextContent("600");

    await userEvent.click(screen.getByRole("button", { name: GRAMOS }));

    expect(screen.getByRole("button", { name: GRAMOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: KILOS })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("quantity")).toHaveTextContent("0.6");
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();

    rerender(
      <I18nextProvider i18n={i18n}>
        <Harness baseUnit="kg" typed="250.5" />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("quantity")).toHaveTextContent("0.2505");
  });

  it("también sirve al revés: un producto en gramos captura en kilogramos", async () => {
    renderHarness({ baseUnit: "gr", typed: "1.25" });

    await userEvent.click(screen.getByRole("button", { name: KILOS }));

    expect(screen.getByTestId("quantity")).toHaveTextContent("1250");
  });

  it("se opera con el teclado", async () => {
    renderHarness({ baseUnit: "kg", typed: "250" });

    await userEvent.tab();
    expect(screen.getByRole("button", { name: KILOS })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: GRAMOS })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: GRAMOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("quantity")).toHaveTextContent("0.25");

    await userEvent.tab({ shift: true });
    await userEvent.keyboard(" ");
    expect(screen.getByRole("button", { name: KILOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("quantity")).toHaveTextContent("250");
  });

  it("recuerda la última unidad de cada unidad base entre montajes", async () => {
    const primero = renderHarness({ baseUnit: "kg", typed: "600" });
    await userEvent.click(screen.getByRole("button", { name: GRAMOS }));
    primero.unmount();

    const segundo = renderHarness({ baseUnit: "kg", typed: "600" });
    expect(screen.getByRole("button", { name: GRAMOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("quantity")).toHaveTextContent("0.6");
    segundo.unmount();

    // Otra unidad base no hereda la elección de los kilogramos.
    renderHarness({ baseUnit: "l" });
    expect(screen.getByRole("button", { name: "Escribir la cantidad en litros" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("un valor guardado que no es hermana de la base se ignora", () => {
    localStorage.setItem("sellpoint.captureUnit.kg", "lb");
    renderHarness({ baseUnit: "kg", typed: "2" });

    expect(screen.getByRole("button", { name: KILOS })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("quantity")).toHaveTextContent("2");
  });

  it("si el navegador no deja guardar, funciona igual sin recordar", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "QuotaExceededError");
    });
    renderHarness({ baseUnit: "kg", typed: "600" });

    expect(screen.getByRole("button", { name: KILOS })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: GRAMOS }));
    expect(screen.getByTestId("quantity")).toHaveTextContent("0.6");
  });

  it("no aparece en un empaque, y ahí la cantidad son empaques aunque haya recuerdo", () => {
    localStorage.setItem("sellpoint.captureUnit.kg", "gr");
    renderHarness({ baseUnit: "kg", atBasePresentation: false, typed: "2" });

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("quantity")).toHaveTextContent("2");
  });

  it.each(["unit", "ft"])("no aparece en una base sin hermana que quepa (%s)", (baseUnit) => {
    renderHarness({ baseUnit, typed: "3" });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("quantity")).toHaveTextContent("3");
  });

  it("lo que no cabe en 4 decimales da el error de la cantidad mínima", async () => {
    const { unmount } = renderHarness({ baseUnit: "kg", typed: "0.05" });
    await userEvent.click(screen.getByRole("button", { name: GRAMOS }));

    expect(screen.getByTestId("quantity")).toBeEmptyDOMElement();
    expect(screen.getByTestId("error")).toHaveTextContent("La cantidad mínima es 0.1 g.");
    unmount();

    // El segundo montaje ya arranca en gramos: es el recuerdo del primero.
    renderHarness({ baseUnit: "kg", typed: "0.05" }, "en");
    expect(screen.getByTestId("error")).toHaveTextContent("The minimum quantity is 0.1 g.");
  });

  it("lo que no es un número no se convierte", async () => {
    renderHarness({ baseUnit: "kg", typed: "abc" });
    await userEvent.click(screen.getByRole("button", { name: GRAMOS }));

    expect(screen.getByTestId("quantity")).toBeEmptyDOMElement();
    expect(screen.getByTestId("error")).toHaveTextContent("Escribe una cantidad.");
  });
});
