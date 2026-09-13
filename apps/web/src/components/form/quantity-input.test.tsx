import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { quantityInputError } from "@/lib/quantity";
import { QuantityInput } from "./quantity-input";

/**
 * Carlos (2026-09-13) mandó capturas de órdenes de compra y recepciones con
 * `sst2`, `91dsad` y `dsdd10` tecleados donde va una cantidad: el campo era un
 * `<input>` suelto que aceptaba cualquier texto.
 */
function Campo({ allowsDecimals }: { allowsDecimals: boolean }) {
  const [valor, setValor] = useState("");
  return (
    <QuantityInput
      aria-label="Cantidad"
      allowsDecimals={allowsDecimals}
      value={valor}
      onChange={setValor}
    />
  );
}

describe("QuantityInput", () => {
  it("las LETRAS no entran: descartarlas no puede cambiar el número que se quiso escribir", async () => {
    render(<Campo allowsDecimals={false} />);
    const user = userEvent.setup();
    const campo = screen.getByLabelText("Cantidad");

    await user.type(campo, "sst2");
    expect(campo).toHaveValue("2");
    await user.clear(campo);
    await user.type(campo, "91dsad");
    expect(campo).toHaveValue("91");
  });

  /**
   * El punto SÍ entra aunque la presentación no se parta, y es el error quien
   * lo explica: filtrarlo en silencio convertiría «2.5» en «25» mientras la
   * persona mira la pantalla.
   */
  it("el punto entra aunque no admita decimales, y el error lo explica", async () => {
    render(<Campo allowsDecimals={false} />);
    const user = userEvent.setup();
    const campo = screen.getByLabelText("Cantidad");

    await user.type(campo, "2.5");
    expect(campo).toHaveValue("2.5");
    expect(quantityInputError("2.5", { allowsDecimals: false })).toBe(
      "purchaseOrders.lines.errors.quantityInteger",
    );
    expect(quantityInputError("2.5", { allowsDecimals: true })).toBeNull();
  });

  it("el teclado del móvil sale sin punto cuando la presentación no se parte", () => {
    const { rerender } = render(<Campo allowsDecimals={false} />);
    expect(screen.getByLabelText("Cantidad")).toHaveAttribute("inputmode", "numeric");
    rerender(<Campo allowsDecimals={true} />);
    expect(screen.getByLabelText("Cantidad")).toHaveAttribute("inputmode", "decimal");
  });

  it("no es type=number: ni flechitas, ni rueda, ni la «e» de notación científica", () => {
    render(<Campo allowsDecimals={true} />);
    expect(screen.getByLabelText("Cantidad")).toHaveAttribute("type", "text");
  });
});

describe("quantityInputError", () => {
  it("el vacío no es error: cada pantalla decide si su campo es obligatorio", () => {
    expect(quantityInputError("", { allowsDecimals: false })).toBeNull();
    expect(quantityInputError("   ", { allowsDecimals: false })).toBeNull();
  });

  it("la coma tiene su propio mensaje, o «3,5» parecería un problema de decimales", () => {
    expect(quantityInputError("3,5", { allowsDecimals: true })).toBe(
      "purchaseOrders.lines.errors.quantityComma",
    );
  });

  it("la escala de la columna son 4 decimales: el quinto lo redondearía Postgres", () => {
    expect(quantityInputError("1.2345", { allowsDecimals: true })).toBeNull();
    expect(quantityInputError("1.23456", { allowsDecimals: true })).toBe(
      "purchaseOrders.lines.errors.quantityDecimals",
    );
  });
});
