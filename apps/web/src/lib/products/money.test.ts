import { moneyScaleError } from "./money";

/**
 * La validación del formulario trabaja sobre el TEXTO del input, no sobre un
 * número: eso es lo que hay mientras alguien está escribiendo. Lo que se prueba
 * acá es cuándo corresponde pintar el campo en rojo y cuándo no — marcar a
 * alguien que todavía está tipeando es ruido, no ayuda.
 */
describe("moneyScaleError", () => {
  it("no marca error mientras el campo está vacío o a medio escribir", () => {
    for (const raw of ["", "   ", "15.", "-", "."]) {
      expect(moneyScaleError(raw)).toBe(false);
    }
  });

  it("acepta enteros y hasta dos decimales", () => {
    for (const raw of ["0", "15", "15.5", "15.55", "0.01", " 1.15 "]) {
      expect(moneyScaleError(raw)).toBe(false);
    }
  });

  it("marca error con tres decimales o más", () => {
    for (const raw of ["15.555", "0.001", "1.2345"]) {
      expect(moneyScaleError(raw)).toBe(true);
    }
  });

  it("no marca error con texto que no es un número: de eso se encarga el input", () => {
    expect(moneyScaleError("abc")).toBe(false);
  });
});
