import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/i18n";
import { numberFieldError, numberFieldMessage } from "@/lib/measure";
import { NumberField } from "./number-field";

const render = (ui: ReactNode) =>
  rtlRender(<I18nextProvider i18n={createI18n()}>{ui}</I18nextProvider>);

/**
 * F9-CLINIC-HC-03 — un número con su unidad. El campo filtra lo que no puede
 * ser número al teclear y el helper dice qué está mal con lo que sí entró.
 */
function Campo({ decimals = 1, min, max }: { decimals?: number; min?: number; max?: number }) {
  const { t } = useTranslation();
  const [valor, setValor] = useState("");
  const error = numberFieldError(valor, { decimals, min, max });
  return (
    <>
      <NumberField
        label="Temperatura"
        unit="°C"
        decimals={decimals}
        value={valor}
        onChange={setValor}
        error={error ? numberFieldMessage(error, t) : undefined}
        hint="Normal: 36 a 37.5"
      />
      <output data-testid="valor">{valor}</output>
    </>
  );
}

describe("NumberField", () => {
  it("la unidad se anuncia con el campo", () => {
    render(<Campo />);
    expect(screen.getByLabelText("Temperatura")).toHaveAccessibleDescription(/°C/);
    expect(screen.getByText("°C")).toBeInTheDocument();
  });

  it("las letras no entran; el punto y la coma sí", async () => {
    render(<Campo />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Temperatura"), "3a6.5");
    expect(screen.getByTestId("valor")).toHaveTextContent("36.5");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("la coma entra y el error la explica", async () => {
    render(<Campo />);
    await userEvent.setup().type(screen.getByLabelText("Temperatura"), "36,5");
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe solo números, con punto decimal");
  });

  it("un decimal de más lo dice con su cuenta", async () => {
    render(<Campo decimals={1} />);
    await userEvent.setup().type(screen.getByLabelText("Temperatura"), "36.55");
    expect(screen.getByRole("alert")).toHaveTextContent("Este valor admite 1 decimal");
  });

  it("entero: el punto ENTRA y el error lo explica (descartarlo haría de «12.0» un «120»)", async () => {
    render(<Campo decimals={0} max={300} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Temperatura"), "12");
    expect(screen.getByText("Normal: 36 a 37.5")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Temperatura"), ".0");
    expect(screen.getByTestId("valor")).toHaveTextContent("12.0");
    expect(screen.getByRole("alert")).toHaveTextContent("Este valor no admite decimales");
  });

  it("fuera del máximo o del mínimo lo dice con el límite", async () => {
    render(<Campo decimals={0} min={30} max={300} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Temperatura"), "301");
    expect(screen.getByRole("alert")).toHaveTextContent("El valor máximo es 300");
    await user.clear(screen.getByLabelText("Temperatura"));
    await user.type(screen.getByLabelText("Temperatura"), "5");
    expect(screen.getByRole("alert")).toHaveTextContent("El valor mínimo es 30");
  });
});

describe("numberFieldError", () => {
  it("vacío no es error: lo opcional se omite", () => {
    expect(numberFieldError("", { decimals: 1 })).toBeNull();
    expect(numberFieldError("  ", { decimals: 1 })).toBeNull();
  });

  it("distingue inválido de decimales de más", () => {
    expect(numberFieldError("abc", { decimals: 1 })).toEqual({ key: "validation.number.invalid" });
    expect(numberFieldError("1.25", { decimals: 1 })).toEqual({
      key: "validation.number.tooManyDecimals",
      count: 1,
    });
    expect(numberFieldError("1.5", { decimals: 0 })).toEqual({
      key: "validation.number.tooManyDecimals",
      count: 0,
    });
  });
});
