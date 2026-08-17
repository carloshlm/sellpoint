/**
 * Catálogo de unidades de medida — F2-UOM-01/02.
 *
 * Fuente COMPARTIDA entre el API y la web, mismo patrón que
 * `ISO_COUNTRY_CODES` y `SUPPORTED_CURRENCIES`: habilitar una unidad nueva se
 * hace en un solo lugar y ambos lados la ven.
 *
 * ── Reparto de responsabilidades con la DB ──────────────────────────────
 * La tabla maestra `units` (F2-DB-01) guarda la IDENTIDAD de cada unidad (su
 * código, sus nombres traducidos y su categoría) porque `products.base_unit`
 * es una FK contra ella. Los FACTORES viven acá y no en la DB: son constantes
 * físicas —un kilo son mil gramos en cualquier tenant y en cualquier año—, no
 * datos de negocio que alguien deba poder editar. Un test de contrato en
 * `apps/api` verifica que las dos fuentes no diverjan.
 */

import type { Locale } from "./i18n";

export const UNIT_CATEGORIES = ["count", "volume", "weight", "length"] as const;

export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export interface UnitDefinition {
  readonly category: UnitCategory;
  /**
   * Cuántas unidades BASE de su categoría vale una de esta.
   *
   * Las bases son enteras y minúsculas a propósito (`unit`, `ml`, `gr`, `cm`):
   * con ellas, las conversiones entre unidades métricas quedan en potencias de
   * 10 y dan resultados EXACTOS en coma flotante. Si la base del peso fuera el
   * kilo, `1 gr → kg` sería 0.001 y los redondeos empezarían a arrastrarse
   * movimiento tras movimiento.
   */
  readonly factor: number;
  /**
   * Nombre para MOSTRAR. El código (`kg`, `oz`) es lo que se guarda y lo que
   * viaja en la planilla de importación; nadie que no sea del oficio reconoce
   * "oz" en un desplegable. Los textos son los MISMOS que la tabla maestra
   * `units` — el test de contrato de `apps/api` falla si divergen.
   */
  readonly nameEs: string;
  readonly nameEn: string;
  /**
   * El plural es un DATO, no una regla. En español "Unidad" hace "Unidades", no
   * "Unidads": cualquier intento de derivarlo agregando una `s` se rompe en la
   * primera unidad y produce texto que se lee mal delante del cliente.
   */
  readonly namePluralEs: string;
  readonly namePluralEn: string;
}

export const UNITS = {
  // count — cosas que se cuentan de a una. No admite fracciones (de acá sale
  // el default de `allow_fractional_input` de las presentaciones).
  unit: {
    category: "count",
    factor: 1,
    nameEs: "Unidad",
    nameEn: "Unit",
    namePluralEs: "Unidades",
    namePluralEn: "Units",
  },

  // volume — base: mililitro
  ml: {
    category: "volume",
    factor: 1,
    nameEs: "Mililitro",
    nameEn: "Milliliter",
    namePluralEs: "Mililitros",
    namePluralEn: "Milliliters",
  },
  l: {
    category: "volume",
    factor: 1000,
    nameEs: "Litro",
    nameEn: "Liter",
    namePluralEs: "Litros",
    namePluralEn: "Liters",
  },

  // weight — base: gramo. Los factores imperiales son las definiciones
  // internacionales exactas (1 lb = 453.59237 gr por acuerdo de 1959).
  gr: {
    category: "weight",
    factor: 1,
    nameEs: "Gramo",
    nameEn: "Gram",
    namePluralEs: "Gramos",
    namePluralEn: "Grams",
  },
  kg: {
    category: "weight",
    factor: 1000,
    nameEs: "Kilogramo",
    nameEn: "Kilogram",
    namePluralEs: "Kilogramos",
    namePluralEn: "Kilograms",
  },
  oz: {
    category: "weight",
    factor: 28.349523125,
    nameEs: "Onza",
    nameEn: "Ounce",
    namePluralEs: "Onzas",
    namePluralEn: "Ounces",
  },
  lb: {
    category: "weight",
    factor: 453.59237,
    nameEs: "Libra",
    nameEn: "Pound",
    namePluralEs: "Libras",
    namePluralEn: "Pounds",
  },

  // length — base: centímetro
  cm: {
    category: "length",
    factor: 1,
    nameEs: "Centímetro",
    nameEn: "Centimeter",
    namePluralEs: "Centímetros",
    namePluralEn: "Centimeters",
  },
  m: {
    category: "length",
    factor: 100,
    nameEs: "Metro",
    nameEn: "Meter",
    namePluralEs: "Metros",
    namePluralEn: "Meters",
  },
} as const satisfies Record<string, UnitDefinition>;

export type UnitCode = keyof typeof UNITS;

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export function isUnitCode(code: string): code is UnitCode {
  return Object.hasOwn(UNITS, code);
}

/** `undefined` para un código desconocido — el caller decide si eso es un error. */
export function getUnit(code: string): UnitDefinition | undefined {
  return isUnitCode(code) ? UNITS[code] : undefined;
}

/**
 * Nombre de la unidad para mostrarle a una persona.
 *
 * `plural` para las frases que hablan de cantidades ("Equivale en gramos"); el
 * singular es para etiquetas sueltas, como cada opción del selector de unidad
 * base. Devuelve el nombre CAPITALIZADO en ambos casos: quien lo inserta en
 * medio de una oración lo baja a minúscula donde corresponde, que es una
 * decisión de la frase y no de la unidad.
 *
 * Un código desconocido se devuelve tal cual: si un producto viejo quedó con
 * una unidad que ya no está en el catálogo, ver `xx` es mucho mejor que ver una
 * celda vacía y no entender qué pasó.
 */
export function unitName(code: string, locale: Locale, options?: { plural?: boolean }): string {
  const unit = getUnit(code);
  if (!unit) {
    return code;
  }
  if (options?.plural) {
    return locale === "en" ? unit.namePluralEn : unit.namePluralEs;
  }
  return locale === "en" ? unit.nameEn : unit.nameEs;
}

/**
 * Convierte una cantidad entre dos unidades de la MISMA categoría.
 *
 * Cruzar categorías lanza a propósito: pasar de `ml` a `gr` exige conocer la
 * densidad del producto, que el sistema no sabe y no debe adivinar. Quien
 * necesite esa equivalencia la expresa donde corresponde — en el `factor` de
 * una presentación, que la define el TenantAdmin para SU producto
 * (ARQUITECTURA § 3.5, "Conversiones entre unidades").
 *
 * OJO con el alcance: esto sirve para DERIVAR y MOSTRAR ("4500 ml son 4.5 l").
 * La conversión que mueve stock de verdad usa el `factor` DECIMAL(14,4) de la
 * presentación, en la DB, donde no hay coma flotante.
 */
export function convertUnits(value: number, from: string, to: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`convertUnits: el valor debe ser un número finito, recibido ${value}`);
  }

  const source = getUnit(from);
  if (!source) {
    throw new RangeError(`convertUnits: unidad desconocida "${from}"`);
  }

  const target = getUnit(to);
  if (!target) {
    throw new RangeError(`convertUnits: unidad desconocida "${to}"`);
  }

  if (source.category !== target.category) {
    throw new RangeError(
      `convertUnits: no se puede convertir de "${from}" (${source.category}) a "${to}" ` +
        `(${target.category}) — son de categoría distinta y la equivalencia depende de la ` +
        "densidad del producto, que se define en el factor de una presentación",
    );
  }

  if (from === to) {
    return value;
  }

  return (value * source.factor) / target.factor;
}
