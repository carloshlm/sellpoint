import { describe, expect, it } from "vitest";
import {
  captureHint,
  captureUnitsFor,
  fromBaseQuantity,
  minimumCaptureQuantity,
  toBaseQuantity,
} from "./capture-units";
import { addQuantities } from "./quantity";
import { convertUnits, UNITS } from "./units";

/**
 * F10-BULK-03 — escribir una cantidad en la unidad hermana de la base
 * (600 g en un producto en kilogramos) y convertirla SIN coma flotante, porque
 * esa cantidad mueve existencias. Solo se ofrece la dirección cuyo resultado
 * cabe en los 4 decimales de la columna: de pies a pulgadas sí, de pulgadas a
 * pies no.
 */
describe("captureUnitsFor", () => {
  it.each([
    ["kg", ["kg", "gr"]],
    ["gr", ["gr", "kg"]],
    ["l", ["l", "ml"]],
    ["ml", ["ml", "l"]],
    ["m", ["m", "cm"]],
    ["cm", ["cm", "m"]],
    ["lb", ["lb", "oz"]],
    ["oz", ["oz", "lb"]],
    ["in", ["in", "ft"]],
  ])("la base %s ofrece %j, con la base primero", (base, units) => {
    expect(captureUnitsFor(base)).toEqual(units);
  });

  it("los pies no ofrecen pulgadas: 1 in = 0.08333… ft no cabe en 4 decimales", () => {
    expect(captureUnitsFor("ft")).toEqual(["ft"]);
  });

  it("una unidad sin hermana devuelve solo la base", () => {
    expect(captureUnitsFor("unit")).toEqual(["unit"]);
  });

  it("un código desconocido no ofrece nada", () => {
    expect(captureUnitsFor("xx")).toEqual([]);
  });

  it("las hermanas son siempre de la misma familia", () => {
    for (const base of Object.keys(UNITS) as (keyof typeof UNITS)[]) {
      for (const unit of captureUnitsFor(base)) {
        expect(UNITS[unit].category).toBe(UNITS[base].category);
      }
    }
  });
});

describe("toBaseQuantity", () => {
  it.each([
    ["600", "gr", "kg", "0.6"],
    ["250", "gr", "kg", "0.25"],
    ["0.6", "kg", "gr", "600"],
    ["750", "ml", "l", "0.75"],
    ["1.5", "l", "ml", "1500"],
    ["35", "cm", "m", "0.35"],
    ["2.4", "m", "cm", "240"],
    ["8", "oz", "lb", "0.5"],
    ["0.25", "lb", "oz", "4"],
    ["1.5", "ft", "in", "18"],
  ])("%s %s en base %s son %s", (typed, from, base, expected) => {
    expect(toBaseQuantity(typed, from, base)).toBe(expected);
  });

  it("la base en la base es la misma cantidad, sin ceros de relleno", () => {
    expect(toBaseQuantity("2.5000", "kg", "kg")).toBe("2.5");
    expect(toBaseQuantity("3", "unit", "unit")).toBe("3");
  });

  it("ida y vuelta exacta en cada par", () => {
    // Los casos van sin ceros de relleno: la vuelta devuelve el mismo texto.
    const casos: [string, string, string][] = [
      ["123.4", "gr", "kg"],
      ["0.1234", "kg", "gr"],
      ["987.6", "ml", "l"],
      ["0.0007", "l", "ml"],
      ["45", "cm", "m"],
      ["0.12", "m", "cm"],
      ["4.8", "oz", "lb"],
      ["0.0625", "lb", "oz"],
      ["2.25", "ft", "in"],
    ];
    for (const [typed, from, base] of casos) {
      const enBase = toBaseQuantity(typed, from, base);
      expect(enBase).not.toBeNull();
      expect(fromBaseQuantity(enBase as string, from, base)).toBe(typed);
    }
  });

  it("0.1 + 0.2 sin error de coma flotante", () => {
    // Con coma flotante, 1.005 kg dan 1004.9999999999999 g y 8.2 g dan
    // 0.008199999999999999 kg: números que no pueden imprimirse en un ticket.
    expect(convertUnits(1.005, "kg", "gr")).not.toBe(1005);
    expect(toBaseQuantity("1.005", "kg", "gr")).toBe("1005");
    expect(convertUnits(8.2, "gr", "kg")).not.toBe(0.0082);
    expect(toBaseQuantity("8.2", "gr", "kg")).toBe("0.0082");
    expect(toBaseQuantity("0.3", "kg", "gr")).toBe("300");

    const cien = toBaseQuantity("100", "gr", "kg") as string;
    const doscientos = toBaseQuantity("200", "gr", "kg") as string;
    expect(addQuantities(cien, doscientos)).toBe("0.3");
  });

  it("devuelve null si el resultado no cabe en 4 decimales", () => {
    expect(toBaseQuantity("0.05", "gr", "kg")).toBeNull();
    expect(toBaseQuantity("0.1", "gr", "kg")).toBe("0.0001");
    expect(toBaseQuantity("0.00001", "kg", "kg")).toBeNull();
    // 1 oz = 0.0625 lb cabe; 0.01 oz = 0.000625 lb, no.
    expect(toBaseQuantity("0.01", "oz", "lb")).toBeNull();
  });

  it("una entrada con más de 4 decimales vale si el resultado cabe", () => {
    expect(toBaseQuantity("0.12345", "kg", "gr")).toBe("123.45");
  });

  it("un par que no existe devuelve null", () => {
    // Pulgadas a pies no cabe; kilogramos a libras no es un par; litros a
    // kilogramos ni siquiera es la misma familia.
    expect(toBaseQuantity("12", "in", "ft")).toBeNull();
    expect(toBaseQuantity("1", "kg", "lb")).toBeNull();
    expect(toBaseQuantity("1", "l", "kg")).toBeNull();
    expect(toBaseQuantity("1", "gr", "unit")).toBeNull();
    expect(toBaseQuantity("1", "xx", "kg")).toBeNull();
  });

  it("una entrada que no es número devuelve null", () => {
    for (const typed of ["", " ", ".", "-", "abc", "1,5", "1.2.3", "1e3"]) {
      expect(toBaseQuantity(typed, "gr", "kg")).toBeNull();
    }
  });

  it("acepta el punto al final mientras se escribe", () => {
    expect(toBaseQuantity("600.", "gr", "kg")).toBe("0.6");
    expect(toBaseQuantity(".5", "kg", "gr")).toBe("500");
  });
});

describe("fromBaseQuantity", () => {
  it("convierte de la base a la unidad elegida, para mostrar", () => {
    expect(fromBaseQuantity("0.6000", "gr", "kg")).toBe("600");
    expect(fromBaseQuantity("600.0000", "kg", "gr")).toBe("0.6");
    expect(fromBaseQuantity("0.0001", "kg", "gr")).toBe("0.0000001");
    expect(fromBaseQuantity(0.5, "oz", "lb")).toBe("8");
  });

  it("devuelve null si el resultado no es un decimal exacto", () => {
    // 7 in = 0.58333… ft.
    expect(fromBaseQuantity("7", "ft", "in")).toBeNull();
    expect(fromBaseQuantity("6", "ft", "in")).toBe("0.5");
  });

  it("un par que no existe devuelve null", () => {
    expect(fromBaseQuantity("1", "lb", "kg")).toBeNull();
    expect(fromBaseQuantity("abc", "gr", "kg")).toBeNull();
  });
});

describe("captureHint", () => {
  it("pinta la cantidad en la unidad menor cuando es menor que 1", () => {
    expect(captureHint("0.6", "kg", "es")).toBe("(600 g)");
    expect(captureHint("0.6000", "kg", "en")).toBe("(600 g)");
    expect(captureHint("0.25", "l", "es")).toBe("(250 ml)");
    expect(captureHint("0.35", "m", "es")).toBe("(35 cm)");
    expect(captureHint("0.5", "lb", "es")).toBe("(8 oz)");
    expect(captureHint(0.2505, "kg", "es")).toBe("(250.5 g)");
  });

  it("no aplica con 1 o más, con cero ni con negativos", () => {
    expect(captureHint("1", "kg", "es")).toBeNull();
    expect(captureHint("2.5", "kg", "es")).toBeNull();
    expect(captureHint("0", "kg", "es")).toBeNull();
    expect(captureHint("-0.5", "kg", "es")).toBeNull();
  });

  it("no aplica sin una unidad menor en su familia", () => {
    expect(captureHint("0.5", "gr", "es")).toBeNull();
    expect(captureHint("0.5", "in", "es")).toBeNull();
    expect(captureHint("0.5", "unit", "es")).toBeNull();
    expect(captureHint("abc", "kg", "es")).toBeNull();
  });
});

describe("minimumCaptureQuantity", () => {
  it.each([
    ["gr", "kg", "0.1"],
    ["kg", "kg", "0.0001"],
    ["kg", "gr", "0.0000001"],
    ["ml", "l", "0.1"],
    ["cm", "m", "0.01"],
    ["oz", "lb", "0.0016"],
    ["ft", "in", "0.000025"],
  ])("en %s con base %s la mínima es %s", (from, base, min) => {
    expect(minimumCaptureQuantity(from, base)).toBe(min);
    // La mínima cabe, y es la más chica que cabe.
    expect(toBaseQuantity(min, from, base)).not.toBeNull();
  });

  it("la mitad de la mínima ya no cabe", () => {
    expect(toBaseQuantity("0.05", "gr", "kg")).toBeNull();
    expect(toBaseQuantity("0.0008", "oz", "lb")).toBeNull();
    expect(toBaseQuantity("0.0000125", "ft", "in")).toBeNull();
  });

  it("un par que no existe devuelve null", () => {
    expect(minimumCaptureQuantity("in", "ft")).toBeNull();
    expect(minimumCaptureQuantity("kg", "l")).toBeNull();
  });
});
