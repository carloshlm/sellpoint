import { z } from "zod";

/**
 * F9-RECEP-17 — la configuración de Recepción, compartida entre el API y el
 * web.
 *
 * El negocio decide cómo llama a su «cliente» (paciente, alumno, huésped…) y
 * qué entradas del menú del módulo muestra. La palabra es UNA, sin espacios,
 * y se guarda ya Capitalizada: el API la normaliza con la misma función con
 * la que el web la previsualiza, y los dos derivan el plural igual — si
 * divergieran, la pantalla prometería una cosa y la base guardaría otra.
 */

/** Las dos entradas del menú de Recepción que el negocio puede apagar. */
export const RECEPTION_MENU_ITEMS = ["customers", "turns"] as const;
export type ReceptionMenuItem = (typeof RECEPTION_MENU_ITEMS)[number];

export const CUSTOMER_LABEL_MAX = 40;

export interface ReceptionSettings {
  /** La palabra propia, Capitalizada; `null` = la de fábrica del idioma. */
  customerLabel: string | null;
  showCustomers: boolean;
  showTurns: boolean;
}

/**
 * Sin fila, todo visible y sin palabra propia: los MISMOS defaults que las
 * columnas, para que «nunca configuré» y «configuré y no toqué nada» sean lo
 * mismo.
 */
export const DEFAULT_RECEPTION_SETTINGS: ReceptionSettings = {
  customerLabel: null,
  showCustomers: true,
  showTurns: true,
};

/** Una palabra: sin espacio de ninguna clase (tab, salto, nbsp incluidos). */
const UNA_PALABRA = /^\S+$/u;

export const customerLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(CUSTOMER_LABEL_MAX)
  .regex(UNA_PALABRA);

/**
 * «Camel» para Carlos (2026-09-04) es esto: primera letra mayúscula y el
 * resto minúscula. Se aplica con reglas de idioma para que «árbitro» dé
 * «Árbitro» y no se pierda el acento.
 */
export function normalizeCustomerLabel(raw: string, locale = "es"): string {
  const palabra = raw.trim();
  if (palabra.length === 0) {
    return "";
  }
  const [primera, ...resto] = Array.from(palabra);
  return `${(primera ?? "").toLocaleUpperCase(locale)}${resto.join("").toLocaleLowerCase(locale)}`;
}

/**
 * El plural de la palabra, por idioma. Reglas de bolsillo, no una gramática:
 * cubren «paciente», «alumno», «huésped», «aprendiz», «guest», «class»,
 * «family». Quien necesite un plural irregular escribe en singular y acepta
 * el resultado — el copy del módulo evita el plural donde puede.
 */
export function pluralizeLabel(word: string, locale: "es" | "en"): string {
  if (word.length === 0) {
    return word;
  }
  const ultima = word.at(-1)?.toLowerCase() ?? "";
  if (locale === "es") {
    if (ultima === "z") {
      return `${word.slice(0, -1)}ces`;
    }
    return /[aeiouáéíóú]/.test(ultima) ? `${word}s` : `${word}es`;
  }
  const finales = word.toLowerCase();
  if (/(s|x|ch|sh)$/.test(finales)) {
    return `${word}es`;
  }
  if (ultima === "y" && !/[aeiou]y$/.test(finales)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}
