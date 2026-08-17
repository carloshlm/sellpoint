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
      expect(moneyScaleError(raw)).toBeNull();
    }
  });

  it("acepta enteros y hasta dos decimales", () => {
    for (const raw of ["0", "15", "15.5", "15.55", "0.01", " 1.15 "]) {
      expect(moneyScaleError(raw)).toBeNull();
    }
  });

  it("marca error con tres decimales o más", () => {
    for (const raw of ["15.555", "0.001", "1.2345"]) {
      expect(moneyScaleError(raw)).toBe("products.too_many_decimals");
    }
  });

  it("un importe demasiado grande dice ESO, no que le sobran decimales", () => {
    // Los dos límites de `DECIMAL(14,2)` fallan por motivos distintos: mandar a
    // alguien a contar decimales cuando lo que escribió es un billón lo deja
    // dando vueltas.
    expect(moneyScaleError("1000000000000")).toBe("products.amount_too_large");
    expect(moneyScaleError("999999999999.99")).toBeNull();
  });

  it("no marca error con texto que no es un número: de eso se encarga el input", () => {
    expect(moneyScaleError("abc")).toBeNull();
  });
});
