import { parseMeasure } from "@sellpoint/shared";

export interface NumberRule {
  /** 0 = entero. */
  decimals: number;
  min?: number;
  max?: number;
}

export type NumberFieldError =
  | { key: "validation.number.invalid" }
  | { key: "validation.number.tooManyDecimals"; count: number }
  | { key: "validation.number.min"; min: number }
  | { key: "validation.number.max"; max: number };

/**
 * F9-CLINIC-HC-03 — qué tiene de malo un número tecleado, o `null` si nada.
 * Vacío NO es error: casi todo en la historia clínica es opcional y lo que
 * está vacío se omite. Devuelve la clave y sus argumentos; el formulario
 * traduce. Los decimales de más se reportan aparte de «inválido» porque es
 * la equivocación más común («36.55» en una temperatura) y merece su
 * explicación.
 */
export function numberFieldError(raw: string, rule: NumberRule): NumberFieldError | null {
  const texto = raw.trim();
  if (texto === "") return null;
  const valor = parseMeasure(texto, rule.decimals);
  if (valor === null) {
    // ¿Es un número válido con más decimales de los que caben?
    const conMasDecimales = parseMeasure(texto, 10);
    if (conMasDecimales !== null) {
      return { key: "validation.number.tooManyDecimals", count: rule.decimals };
    }
    return { key: "validation.number.invalid" };
  }
  if (rule.min !== undefined && valor < rule.min)
    return { key: "validation.number.min", min: rule.min };
  if (rule.max !== undefined && valor > rule.max)
    return { key: "validation.number.max", max: rule.max };
  return null;
}

/** El texto del error, traducido; `count` va como `count` para que i18next elija el plural. */
export function numberFieldMessage(
  error: NumberFieldError,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return t(error.key, { ...error });
}
