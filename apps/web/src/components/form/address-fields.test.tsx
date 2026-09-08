import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import { AddressFields, type AddressValues } from "./address-fields";

/**
 * F1-ADDR-04. Un solo componente para el wizard, Mi perfil y los almacenes:
 * pinta lo que el país pide, en su orden y con su vocabulario, y NUNCA borra
 * lo escrito cuando el país cambia. Etiquetas y orden salen del catálogo de
 * Google copiado en `@sellpoint/shared` (address.ts).
 */
const VACIA: AddressValues = { line1: "", line2: "", city: "", region: "", postalCode: "" };

async function render(ui: ReactNode, lng: "es" | "en" = "es") {
  const i18n = createI18n();
  await i18n.changeLanguage(lng);
  return rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function Campo({
  country,
  inicial = VACIA,
  regionLocked,
}: {
  country: string | null;
  inicial?: AddressValues;
  regionLocked?: boolean;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <AddressFields
        country={country}
        value={valor}
        onChange={(field, next) => setValor((previo) => ({ ...previo, [field]: next }))}
        regionLocked={regionLocked}
      />
      <output data-testid="valor">{JSON.stringify(valor)}</output>
    </>
  );
}

const etiquetas = () =>
  screen.getAllByText(/./, { selector: "label" }).map((label) => label.textContent);

describe("AddressFields", () => {
  it("México: colonia, código postal ANTES de la ciudad, y el estado como lista de 32", async () => {
    await render(<Campo country="MX" />);
    expect(etiquetas()).toEqual([
      "Calle y número",
      "Colonia",
      "Código postal",
      "Ciudad o municipio",
      "Estado",
    ]);
    const estado = screen.getByRole("combobox", { name: "Estado" });
    // 32 estados más el «Elige uno».
    expect(within(estado).getAllByRole("option")).toHaveLength(33);
    expect(within(estado).getByRole("option", { name: "Jalisco" })).toHaveValue("JAL");
  });

  it("Estados Unidos: unidad opcional, ciudad, estado (los 50 y DC, los de F4-TAX) y el ZIP al final", async () => {
    await render(<Campo country="US" />, "en");
    expect(etiquetas()).toEqual([
      "Street address",
      "Apt, suite or unit (optional)",
      "City",
      "State",
      "ZIP code",
    ]);
    // 50 estados más DC, la misma lista fiscal de F4-TAX (la región es UNA
    // columna, compartida con las tasas), más el «Choose one».
    expect(
      within(screen.getByRole("combobox", { name: "State" })).getAllByRole("option"),
    ).toHaveLength(52);
  });

  it("Canadá: provincia o territorio (13) y «Postal code», no ZIP", async () => {
    await render(<Campo country="CA" />, "en");
    expect(etiquetas()).toContain("Province or territory");
    expect(etiquetas()).toContain("Postal code");
    expect(etiquetas()).not.toContain("ZIP code");
    expect(
      within(screen.getByRole("combobox", { name: "Province or territory" })).getAllByRole(
        "option",
      ),
    ).toHaveLength(14);
  });

  it("Reino Unido: sin región, pero con línea 2, ciudad y código postal", async () => {
    await render(<Campo country="GB" />, "en");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(etiquetas()).toEqual([
      "Street address",
      "Apt, suite or unit (optional)",
      "City",
      "Postal code",
    ]);
  });

  it("España trae región en el catálogo de Google, pero en esta versión no se pide: sin lista", async () => {
    // La columna admite códigos de ocho caracteres y los catálogos de
    // subdivisiones de los otros 23 países quedaron pospuestos: pedirla como
    // texto libre sería empezar la deuda.
    await render(<Campo country="ES" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(etiquetas()).toEqual([
      "Calle y número",
      "Interior, departamento o unidad (opcional)",
      "Código postal",
      "Ciudad o municipio",
    ]);
  });

  it("sin país todavía: calle, línea 2, ciudad y código postal, sin región ni regla", async () => {
    await render(<Campo country={null} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(etiquetas()).toEqual([
      "Calle y número",
      "Interior, departamento o unidad (opcional)",
      "Ciudad o municipio",
      "Código postal",
    ]);
  });

  it("cambiar de país NO borra lo escrito: solo cambian etiquetas, orden y reglas", async () => {
    const user = userEvent.setup();
    function Cambiante() {
      const [country, setCountry] = useState("MX");
      return (
        <>
          <button type="button" onClick={() => setCountry("US")}>
            a Estados Unidos
          </button>
          <Campo country={country} />
        </>
      );
    }
    await render(<Cambiante />);
    await user.type(screen.getByLabelText("Calle y número"), "Calle 5 #12");
    await user.type(screen.getByLabelText("Colonia"), "Centro");
    await user.click(screen.getByRole("button", { name: "a Estados Unidos" }));

    // Las etiquetas ya son las de Estados Unidos (en español), el texto sigue.
    expect(screen.getByLabelText("Calle y número")).toHaveValue("Calle 5 #12");
    expect(screen.getByLabelText("Interior, departamento o unidad (opcional)")).toHaveValue(
      "Centro",
    );
    expect(screen.getByTestId("valor")).toHaveTextContent('"line1":"Calle 5 #12"');
  });

  it("con la región bloqueada, la lista está deshabilitada y explica dónde se cambia", async () => {
    await render(<Campo country="CA" inicial={{ ...VACIA, region: "ON" }} regionLocked />, "en");
    const provincia = screen.getByRole("combobox", { name: "Province or territory" });
    expect(provincia).toBeDisabled();
    expect(provincia).toHaveValue("ON");
    expect(screen.getByText(/Change it under Taxes/)).toBeInTheDocument();
  });

  it("cada campo lleva el autocompletado que el navegador entiende", async () => {
    await render(<Campo country="US" />, "en");
    expect(screen.getByLabelText("Street address")).toHaveAttribute(
      "autocomplete",
      "address-line1",
    );
    expect(screen.getByLabelText("Apt, suite or unit (optional)")).toHaveAttribute(
      "autocomplete",
      "address-line2",
    );
    expect(screen.getByLabelText("City")).toHaveAttribute("autocomplete", "address-level2");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveAttribute(
      "autocomplete",
      "address-level1",
    );
    expect(screen.getByLabelText("ZIP code")).toHaveAttribute("autocomplete", "postal-code");
  });

  it("el código postal abre teclado numérico solo donde son puros dígitos", async () => {
    await render(<Campo country="MX" />);
    expect(screen.getByLabelText("Código postal")).toHaveAttribute("inputmode", "numeric");
    const { unmount } = await render(<Campo country="CA" />, "en");
    expect(screen.getByLabelText("Postal code")).not.toHaveAttribute("inputmode", "numeric");
    unmount();
  });
});
