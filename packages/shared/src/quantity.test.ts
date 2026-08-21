import { describe, expect, it } from "vitest";
import { addQuantities, formatQuantity, parseQuantity, quantityDecimals } from "./quantity";

/**
 * Reportado por Carlos mirando el kardex: `+12.0000` y saldo `262.0000` para
 * un producto que se cuenta en piezas. Cuatro dígitos que no pueden ser otra
 * cosa que cero.
 */
describe("formatQuantity", () => {
  describe("lo que se cuenta en piezas no tiene decimales", () => {
    it("un saldo entero se muestra entero", () => {
      expect(formatQuantity("262.0000", "unit")).toBe("262");
    });

    it("una cantidad de movimiento también", () => {
      expect(formatQuantity("12.0000", "unit")).toBe("12");
    });

    it("el signo negativo se conserva", () => {
      expect(formatQuantity("-30.0000", "unit")).toBe("-30");
    });
  });

  describe("lo que se pesa o se mide conserva su precisión", () => {
    it("mantiene los decimales fijos aunque el valor sea redondo", () => {
      // Fijos y no recortados: la columna se lee en vertical y con decimales
      // variables el ojo no puede comparar magnitudes.
      expect(formatQuantity("2.0000", "kg")).toBe("2.000");
    });

    it("2.5 kg se muestra con la precisión de la unidad", () => {
      expect(formatQuantity("2.5000", "kg")).toBe("2.500");
    });

    it("250 gramos", () => {
      expect(formatQuantity("250.0000", "gr")).toBe("250.000");
    });

    it("un litro y cuarto", () => {
      expect(formatQuantity("1.2500", "l")).toBe("1.250");
    });
  });

  /**
   * LA PARTE QUE IMPORTA. Un dato imposible tiene que verse imposible: en un
   * libro de inventario, un formato que tapa una inconsistencia es peor que
   * uno feo.
   */
  describe("nunca esconde un decimal que no encaja", () => {
    it("media pieza se MUESTRA, no se redondea a 263", () => {
      expect(formatQuantity("262.5000", "unit")).toBe("262.5");
    });

    it("un cuarto de pieza también", () => {
      expect(formatQuantity("10.2500", "unit")).toBe("10.25");
    });

    it("un peso con más precisión que su unidad se muestra entero", () => {
      expect(formatQuantity("0.1255", "kg")).toBe("0.1255");
    });
  });

  describe("bordes", () => {
    it("una unidad desconocida se trata como continua: mostrar de más no oculta", () => {
      expect(formatQuantity("5.0000", "codigo-viejo")).toBe("5.000");
      expect(quantityDecimals("codigo-viejo")).toBe(3);
    });

    it("un valor sin punto decimal", () => {
      expect(formatQuantity("7", "unit")).toBe("7");
      expect(formatQuantity("7", "kg")).toBe("7.000");
    });

    it("acepta números además de strings", () => {
      expect(formatQuantity(12, "unit")).toBe("12");
    });

    it("cadena vacía no inventa un cero", () => {
      expect(formatQuantity("", "unit")).toBe("");
    });

    it("el cero se muestra como cero", () => {
      expect(formatQuantity("0.0000", "unit")).toBe("0");
      expect(formatQuantity("0.0000", "kg")).toBe("0.000");
    });
  });
});

/**
 * F4-CART-02 — sumar cantidades en el carrito.
 *
 * Escanear el mismo código dos veces suma sobre el renglón que ya está. Si esa
 * suma se hiciera con `Number`, `0.1 + 0.2` daría `0.30000000000000004` y el
 * carrito mostraría una cantidad imposible en un producto que se pesa.
 */
describe("addQuantities", () => {
  it("suma enteros y decimales", () => {
    expect(addQuantities("1", "1")).toBe("2");
    expect(addQuantities("2.5", "0.5")).toBe("3");
    expect(addQuantities("0.250", "0.125")).toBe("0.375");
  });

  it("no arrastra el error de la coma flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addQuantities("0.1", "0.2")).toBe("0.3");
  });

  it("conserva los cuatro decimales de la columna", () => {
    expect(addQuantities("0.0001", "0.0002")).toBe("0.0003");
  });

  it("un sumando a medio teclear vale cero, no NaN", () => {
    // El numpad produce "12." y "." mientras alguien escribe.
    expect(addQuantities("2", "")).toBe("2");
    expect(addQuantities("2", ".")).toBe("2");
    expect(addQuantities("2", "3.")).toBe("5");
  });
});

/**
 * El texto del numpad → el número que viaja en el POST. Un solo lugar donde
 * ocurre la conversión, y devuelve 0 en vez de NaN ante un estado intermedio:
 * un `NaN` en el cuerpo del cobro se vuelve `null` al serializar a JSON y el
 * API contesta un 422 que nadie sabe explicar.
 */
describe("parseQuantity", () => {
  it("convierte texto decimal a número", () => {
    expect(parseQuantity("2.5")).toBe(2.5);
    expect(parseQuantity("0.0001")).toBe(0.0001);
  });

  it("un valor a medio teclear vale cero, nunca NaN", () => {
    for (const texto of ["", ".", "12.", "abc", "-"]) {
      expect(Number.isNaN(parseQuantity(texto))).toBe(false);
    }
    expect(parseQuantity("12.")).toBe(12);
    expect(parseQuantity("abc")).toBe(0);
  });
});
