import { BadRequestException } from "@nestjs/common";

/**
 * Largo máximo de una `key`. 63 es el límite de un identificador de Postgres:
 * la key no es un nombre de columna hoy (vive dentro del JSONB), pero mantenerla
 * dentro de ese límite deja abierta la puerta a promoverla a columna si algún
 * campo se vuelve lo bastante importante, sin migrar nombres.
 */
const MAX_KEY_LENGTH = 63;

/**
 * F2-CAT-03 — deriva la `key` estable de un campo desde su etiqueta.
 *
 * El usuario escribe "Sustancia Activa" y nunca ve `sustancia_activa`. Esa
 * separación es la que permite RENOMBRAR un campo sin tocar un solo dato: la
 * etiqueta es presentación, la key es dónde vive el valor dentro de
 * `attributes`.
 *
 * Se normaliza a ASCII (`NFD` + quitar diacríticos) por una razón concreta:
 * sin eso, "Código" y "Codigo" darían keys distintas y el Admin
 * terminaría con dos campos que para él son el mismo. Que ambas colapsen a la
 * misma key es lo que hace que el 409 de duplicado sea correcto y no molesto.
 *
 * LEY de genericidad: acá no hay nada de ningún rubro. La etiqueta la pone el
 * cliente, en su idioma y con su vocabulario.
 */
export function deriveFieldKey(label: string): string {
  const ascii = label
    .normalize("NFD")
    // Bloque de diacríticos combinantes: la `ñ` normalizada es `n` + U+0303.
    .replace(/[̀-ͯ]/g, "");

  let key = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (key.length === 0) {
    throw new BadRequestException({ message: "catalogs.field_label_not_usable" });
  }

  // Un identificador no puede arrancar con dígito. Se prefija en vez de
  // recortar para no perder el "2da" de "2da presentación", que es
  // justamente lo que distingue esa etiqueta de otra.
  if (/^[0-9]/.test(key)) {
    key = `f_${key}`;
  }

  if (key.length > MAX_KEY_LENGTH) {
    key = key.slice(0, MAX_KEY_LENGTH).replace(/_+$/g, "");
  }

  return key;
}
