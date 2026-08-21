import { describe, expect, it } from "vitest";
import {
  convertUnits,
  getUnit,
  isUnitCode,
  UNIT_CATEGORIES,
  UNIT_CODES,
  UNITS,
  unitName,
} from "./units";

/**
 * F2-UOM: el selector mostraba el CÓDIGO (`kg`, `oz`, `cm`), que es lo que se
 * guarda pero no lo que una persona reconoce. El nombre descriptivo ya vivía en
 * la tabla maestra `units`; acá se agrega al catálogo compartido para que el
 * front lo tenga sin pedirlo por red, y un test de integración en `apps/api`
 * verifica que las dos fuentes no divergan.
 */
describe("unitName", () => {
  it("devuelve el nombre descriptivo en el idioma pedido", () => {
    expect(unitName("kg", "es")).toBe("Kilogramo");
    expect(unitName("kg", "en")).toBe("Kilogram");
    expect(unitName("cm", "es")).toBe("Centímetro");
    expect(unitName("cm", "en")).toBe("Centimeter");
  });

  it("todas las unidades tienen nombre en los dos idiomas", () => {
    const incompletas = UNIT_CODES.filter(
      (code) => !UNITS[code].nameEs.trim() || !UNITS[code].nameEn.trim(),
    );
    expect(incompletas).toEqual([]);
  });

  it("un código desconocido devuelve el código: mejor eso que una etiqueta vacía", () => {
    expect(unitName("no-existe", "es")).toBe("no-existe");
    expect(unitName("no-existe", "es", { plural: true })).toBe("no-existe");
  });

  it("da el plural para las frases: «Equivale en gramos», no «en gramo»", () => {
    expect(unitName("gr", "es", { plural: true })).toBe("Gramos");
    expect(unitName("gr", "en", { plural: true })).toBe("Grams");
    expect(unitName("cm", "es", { plural: true })).toBe("Centímetros");
  });

  /**
   * **Este test perdió sus dientes el 2026-08-20 y lo digo acá para que nadie
   * se confíe.**
   *
   * Existía porque «Unidad» → «Unidades» NO se deriva con `+ "s"`: era el
   * contraejemplo que hacía imposible "simplificar" el catálogo a una regla.
   * Al renombrar esa unidad a «Pieza» —cuyo plural sí es regular— el catálogo
   * quedó con las nueve unidades pluralizando con una `s` en los dos idiomas.
   *
   * O sea: hoy una implementación que derivara el plural con `+ "s"` pasaría
   * este archivo entero en verde. Lo que sigue protegiendo la decisión es que
   * el plural viva como CAMPO —lo verifica el test de abajo, que exige uno
   * explícito por unidad— y el día que entre una irregular (un "Pie" → "Pies",
   * un "Inch" → "Inches") este test vuelve a discriminar solo.
   */
  it("el plural sale del catálogo, no de pegarle una `s` al singular", () => {
    expect(unitName("unit", "es", { plural: true })).toBe("Piezas");
    expect(unitName("unit", "en", { plural: true })).toBe("Pieces");
  });

  it("todas las unidades tienen plural en los dos idiomas", () => {
    const incompletas = UNIT_CODES.filter(
      (code) => !UNITS[code].namePluralEs.trim() || !UNITS[code].namePluralEn.trim(),
    );
    expect(incompletas).toEqual([]);
  });
});

/**
 * F2-UOM-01/02. Este catálogo es la fuente COMPARTIDA entre API y web —
 * mismo patrón que `ISO_COUNTRY_CODES` y `SUPPORTED_CURRENCIES`: una unidad
 * nueva se habilita en un solo lugar. La tabla `units` de la DB guarda la
 * identidad y la categoría; los FACTORES viven acá porque son constantes
 * físicas, no datos de negocio.
 */
describe("catálogo de unidades (F2-UOM-01)", () => {
  it("cada unidad pertenece a una categoría conocida y tiene factor positivo", () => {
    const violations = UNIT_CODES.filter((code) => {
      const unit = UNITS[code];
      return !UNIT_CATEGORIES.includes(unit.category) || !(unit.factor > 0);
    });

    expect(violations).toEqual([]);
  });

  it("cada categoría tiene exactamente UNA unidad base (factor 1)", () => {
    // Sin esta invariante, `convertUnits` no tendría un pivote y dos unidades
    // de la misma categoría podrían no ser convertibles entre sí.
    const violations = UNIT_CATEGORIES.map((category) => {
      const bases = UNIT_CODES.filter(
        (code) => UNITS[code].category === category && UNITS[code].factor === 1,
      );
      return bases.length === 1 ? null : `${category}: ${bases.length} unidades base (${bases})`;
    }).filter(Boolean);

    expect(violations).toEqual([]);
  });

  it("isUnitCode discrimina códigos del catálogo de cualquier string", () => {
    expect(isUnitCode("kg")).toBe(true);
    expect(isUnitCode("KG")).toBe(false);
    expect(isUnitCode("xyz")).toBe(false);
    expect(isUnitCode("")).toBe(false);
  });

  it("getUnit devuelve undefined en vez de romper con un código desconocido", () => {
    expect(getUnit("kg")?.category).toBe("weight");
    expect(getUnit("xyz")).toBeUndefined();
  });
});

describe("convertUnits (F2-UOM-02)", () => {
  it("convierte dentro de la misma categoría, en ambas direcciones", () => {
    expect(convertUnits(1, "l", "ml")).toBe(1000);
    expect(convertUnits(1500, "ml", "l")).toBe(1.5);
    expect(convertUnits(2, "kg", "gr")).toBe(2000);
    expect(convertUnits(500, "gr", "kg")).toBe(0.5);
    expect(convertUnits(1, "m", "cm")).toBe(100);
    expect(convertUnits(250, "cm", "m")).toBe(2.5);
  });

  it("convertir a la misma unidad devuelve el valor intacto", () => {
    expect(convertUnits(7.25, "gr", "gr")).toBe(7.25);
  });

  it("las conversiones por potencias de 10 son EXACTAS, sin ruido de coma flotante", () => {
    // Si esto diera 1000.0000000000001, el stock convertido arrastraría el
    // error en cada movimiento. Es la razón por la que los factores se
    // expresan sobre una base entera (ml, gr, cm, unit) y no unos sobre otros.
    expect(convertUnits(1, "l", "ml")).toBe(1000);
    expect(convertUnits(3, "kg", "gr")).toBe(3000);
    expect(convertUnits(0.001, "l", "ml")).toBe(1);
  });

  it("las unidades imperiales conviven con las métricas dentro de su categoría", () => {
    expect(convertUnits(1, "kg", "lb")).toBeCloseTo(2.20462, 4);
    expect(convertUnits(1, "lb", "gr")).toBeCloseTo(453.59237, 4);
    expect(convertUnits(16, "oz", "lb")).toBeCloseTo(1, 6);
  });

  it("cruzar categorías LANZA: la densidad no es asunto del sistema", () => {
    // Convertir ml a gr exige saber la densidad del producto. Adivinarla
    // corrompería el inventario en silencio; que explote es lo correcto
    // (ARQUITECTURA § 3.5, "Conversiones entre unidades").
    expect(() => convertUnits(1, "ml", "gr")).toThrow(/categoría/i);
    expect(() => convertUnits(1, "unit", "kg")).toThrow(/categoría/i);
  });

  it("un código desconocido LANZA en vez de devolver un número inventado", () => {
    expect(() => convertUnits(1, "xyz", "kg")).toThrow(/xyz/);
    expect(() => convertUnits(1, "kg", "xyz")).toThrow(/xyz/);
  });

  it("un valor no finito LANZA (mismo criterio que formatMoney)", () => {
    expect(() => convertUnits(Number.NaN, "kg", "gr")).toThrow();
    expect(() => convertUnits(Number.POSITIVE_INFINITY, "kg", "gr")).toThrow();
  });
});
