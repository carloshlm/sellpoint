/**
 * F9-CLINIC-HC-22 — la aritmética del CIE-10, compartida por el API (buscar)
 * y el web (pintar y validar).
 *
 * México codifica con la CIE-10 (NOM-024; la CIE-11 sigue en capacitación
 * en 2026). La DGIS publica el catálogo con clave COMPACTA (`J069`, y `A33X`
 * para las categorías sin subcategoría); el médico ve el código con punto
 * (`J06.9`), que es el de la OMS y el que valida `ICD10_CODE`.
 */

/** Minúsculas y sin acentos, con espacios colapsados: lo que se compara al buscar. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `J069` → `J06.9`; `A33X` y `A33` → `A33`. Devuelve `null` si no tiene forma de clave. */
export function icd10CodeFromDgisKey(key: string): string | null {
  const clave = key.trim().toUpperCase();
  if (!/^[A-Z]\d{2}[0-9X]?[0-9]?$/.test(clave)) return null;
  if (clave.length === 3) return clave;
  if (clave[3] === "X") return clave.slice(0, 3);
  return `${clave.slice(0, 3)}.${clave.slice(3)}`;
}

/**
 * Lo que tecleó el médico, si parece un código: en mayúsculas y con el punto
 * puesto (`j069` y `J06.9` → `J06.9`; `j0` → `J0`). `null` si es texto libre.
 */
export function icd10CodePrefix(query: string): string | null {
  const q = query.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]\d{0,2}(\.?\d{0,2})?$/.test(q)) return null;
  const sinPunto = q.replace(".", "");
  return sinPunto.length > 3 ? `${sinPunto.slice(0, 3)}.${sinPunto.slice(3)}` : sinPunto;
}
