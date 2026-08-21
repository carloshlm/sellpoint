import { pulsarTecla, sanearCantidad } from "./numpad";

/**
 * F4-CART-03 — el numpad inteligente.
 *
 * La lógica de teclas es PURA y vive aparte del componente por lo mismo que
 * los reconocedores del buscador: lo que hay que fijar no es cómo se ven los
 * botones sino qué texto queda en pantalla, y eso no necesita un DOM.
 *
 * La regla que gobierna todo: **una presentación entera no admite decimales.**
 * No es cosmética — el API rechaza esa cantidad, así que un numpad que deja
 * escribirla está preparando un 422.
 */
describe("pulsarTecla (F4-CART-03)", () => {
  const entera = { allowFractional: false };
  const fraccionaria = { allowFractional: true };

  describe("dígitos", () => {
    it("los concatena", () => {
      expect(pulsarTecla("1", "2", entera)).toBe("12");
    });

    it("un dígito sobre el cero inicial lo REEMPLAZA", () => {
      // Sin esto, tocar 5 después de que la línea nace en 0 daría "05".
      expect(pulsarTecla("0", "5", entera)).toBe("5");
    });

    it("pero no reemplaza el cero de un decimal a medio escribir", () => {
      expect(pulsarTecla("0.", "5", fraccionaria)).toBe("0.5");
      expect(pulsarTecla("0.0", "5", fraccionaria)).toBe("0.05");
    });
  });

  describe("el punto", () => {
    /**
     * ⚠ LA INVARIANTE DE LA TAREA. `allow_fractional_input = false` lo deriva
     * el server de la categoría de la unidad: media pieza no existe.
     */
    it("se IGNORA en una presentación entera", () => {
      expect(pulsarTecla("12", ".", entera)).toBe("12");
    });

    it("en una fraccionaria lo agrega", () => {
      expect(pulsarTecla("12", ".", fraccionaria)).toBe("12.");
    });

    it("un punto sobre el vacío arranca en cero", () => {
      // ".5" es un decimal válido para una máquina y feo para una persona.
      expect(pulsarTecla("", ".", fraccionaria)).toBe("0.");
    });

    it("un segundo punto no hace nada", () => {
      expect(pulsarTecla("1.5", ".", fraccionaria)).toBe("1.5");
    });
  });

  describe("los límites de la columna", () => {
    it("no admite un quinto decimal", () => {
      // `DECIMAL(14,4)`: el quinto lo redondearía Postgres en silencio, y el
      // usuario vería guardado un número que no escribió.
      expect(pulsarTecla("1.2345", "6", fraccionaria)).toBe("1.2345");
    });

    it("no admite más de diez enteros", () => {
      expect(pulsarTecla("1234567890", "1", entera)).toBe("1234567890");
    });
  });

  describe("borrar y limpiar", () => {
    it("borrar quita el último carácter", () => {
      expect(pulsarTecla("12.5", "borrar", fraccionaria)).toBe("12.");
      expect(pulsarTecla("1", "borrar", entera)).toBe("");
    });

    it("borrar sobre el vacío no rompe", () => {
      expect(pulsarTecla("", "borrar", entera)).toBe("");
    });

    it("limpiar deja el campo vacío", () => {
      expect(pulsarTecla("123.45", "limpiar", fraccionaria)).toBe("");
    });
  });
});

/**
 * El pegado y el teclado físico: el otro camino por el que un decimal puede
 * llegar a una presentación entera. El numpad puede esconder el punto, pero no
 * puede esconder el `Ctrl+V`.
 */
describe("sanearCantidad (F4-CART-03)", () => {
  const entera = { allowFractional: false };
  const fraccionaria = { allowFractional: true };

  it("deja pasar lo que ya es válido", () => {
    expect(sanearCantidad("12.5", fraccionaria)).toEqual({ value: "12.5", truncated: false });
    expect(sanearCantidad("12", entera)).toEqual({ value: "12", truncated: false });
  });

  /**
   * TRUNCA y AVISA. Redondear a 13 cobraría algo que nadie pidió; rechazar en
   * silencio dejaría el campo sin explicación. Se corta y se dice por qué.
   */
  it("trunca los decimales en una presentación entera, y lo dice", () => {
    expect(sanearCantidad("12.7", entera)).toEqual({ value: "12", truncated: true });
  });

  it("corta el quinto decimal en una fraccionaria, y lo dice", () => {
    expect(sanearCantidad("1.23456", fraccionaria)).toEqual({ value: "1.2345", truncated: true });
  });

  it("descarta lo que no son dígitos", () => {
    expect(sanearCantidad("1a2b", entera)).toEqual({ value: "12", truncated: true });
    expect(sanearCantidad("-5", entera)).toEqual({ value: "5", truncated: true });
  });

  it("conserva el punto a medio escribir en una fraccionaria", () => {
    // Es un estado legítimo de alguien tecleando: no es un error que avisar.
    expect(sanearCantidad("12.", fraccionaria)).toEqual({ value: "12.", truncated: false });
  });

  it("un segundo punto se descarta", () => {
    expect(sanearCantidad("1.2.3", fraccionaria)).toEqual({ value: "1.23", truncated: true });
  });

  it("el vacío sigue vacío, sin aviso", () => {
    expect(sanearCantidad("", entera)).toEqual({ value: "", truncated: false });
  });
});
