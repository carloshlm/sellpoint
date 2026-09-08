import { mismoImporte, moneyInitialValue, moneyInputError } from "./money";

/**
 * La validación del formulario trabaja sobre el TEXTO del input, no sobre un
 * número: eso es lo que hay mientras alguien está escribiendo. Lo que se prueba
 * acá es cuándo corresponde pintar el campo en rojo y cuándo no.
 */
describe("moneyInputError", () => {
  it("no marca error mientras el campo está vacío o con un punto a medio escribir", () => {
    for (const raw of ["", "   ", "15.", ".5"]) {
      expect(moneyInputError(raw)).toBeNull();
    }
  });

  it("acepta enteros y hasta dos decimales", () => {
    for (const raw of ["0", "15", "15.5", "15.55", "0.01", " 1.15 "]) {
      expect(moneyInputError(raw)).toBeNull();
    }
  });

  it("marca error con tres decimales o más", () => {
    for (const raw of ["15.555", "0.001", "1.2345"]) {
      expect(moneyInputError(raw)).toBe("products.too_many_decimals");
    }
  });

  it("un importe demasiado grande dice ESO, no que le sobran decimales", () => {
    // Los dos límites de `DECIMAL(14,2)` fallan por motivos distintos: mandar a
    // alguien a contar decimales cuando lo que escribió es un billón lo deja
    // dando vueltas.
    expect(moneyInputError("1000000000000")).toBe("products.amount_too_large");
    expect(moneyInputError("999999999999.99")).toBeNull();
  });

  it("lo que no es un importe es error: el campo ya es de texto y nadie lo frena antes", () => {
    // La coma en particular: se rechaza con un mensaje que enseña el formato,
    // no se adivina si era de miles o decimal (ver `parseMoneyInput`).
    for (const raw of ["abc", "5,99", "1,500", "-5", "$5", "1e3", "."]) {
      expect(moneyInputError(raw)).toBe("products.invalid_amount");
    }
  });
});

describe("moneyInitialValue", () => {
  it("abre un registro guardado ya a dos decimales, aunque el API no rellene ceros", () => {
    // `Prisma.Decimal.toString()` devuelve «45», no «45.00».
    expect(moneyInitialValue("45")).toBe("45.00");
    expect(moneyInitialValue("0.5")).toBe("0.50");
    expect(moneyInitialValue("150.00")).toBe("150.00");
  });

  it("sin importe arranca vacío, no en 0.00", () => {
    expect(moneyInitialValue(null)).toBe("");
    expect(moneyInitialValue(undefined)).toBe("");
    expect(moneyInitialValue("")).toBe("");
  });
});

describe("mismoImporte", () => {
  it("el mismo número escrito de otra forma no es un cambio", () => {
    expect(mismoImporte("6.00", "6")).toBe(true);
    expect(mismoImporte("6", "6.00")).toBe(true);
    expect(mismoImporte(" 6.0 ", "6")).toBe(true);
  });

  it("un importe distinto sí lo es", () => {
    expect(mismoImporte("6.01", "6")).toBe(false);
    expect(mismoImporte("7", "6")).toBe(false);
  });

  it("vacío y cero NO son lo mismo: uno es «sin capturar» y el otro «me cuesta $0»", () => {
    expect(mismoImporte("", "0")).toBe(false);
    expect(mismoImporte("0", "")).toBe(false);
    expect(mismoImporte("", null)).toBe(true);
    expect(mismoImporte("", "")).toBe(true);
  });
});
