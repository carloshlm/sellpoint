import { QUANTITY_SCALE } from "@sellpoint/shared";

/**
 * F4-CART-03 — la lógica del numpad, sin DOM.
 *
 * ── Qué gobierna todo esto ──────────────────────────────────────────────
 *
 * `allow_fractional_input` de la presentación. El server lo deriva de la
 * categoría de la unidad base (`count` → false, resto → true) y el TenantAdmin
 * puede sobrescribirlo. **No es cosmético**: F3 y F4 rechazan una cantidad con
 * decimales cuando está en false, así que un numpad que deja escribirla no está
 * siendo permisivo — está preparando un 422 que el cajero va a ver con el
 * cliente enfrente.
 *
 * ── Esconder el punto no alcanza ────────────────────────────────────────
 *
 * El botón se puede ocultar; el `Ctrl+V` y el teclado físico, no. Por eso hay
 * dos funciones: `pulsarTecla` para lo que entra por el numpad y
 * `sanearCantidad` para lo que entra por cualquier otro lado. Y por eso el
 * backend revalida igual: esto es defensa en profundidad, no la única red.
 */

interface ReglasDeCantidad {
  /** ¿La presentación admite decimales? */
  allowFractional: boolean;
}

/** Los enteros que caben en `DECIMAL(14,4)`: 14 dígitos menos los 4 decimales. */
const MAX_ENTEROS = 10;

/** Las teclas que no son dígitos ni punto. */
export type TeclaEspecial = "borrar" | "limpiar";

/**
 * Una pulsación → el texto que queda en pantalla.
 *
 * Pura y sobre TEXTO, no sobre `number`: `"12."` es un estado legítimo de
 * alguien a medio escribir y ningún número puede representarlo — `Number("12.")`
 * es `12`, así que el punto recién tocado desaparecería en el mismo render.
 */
export function pulsarTecla(
  actual: string,
  tecla: string | TeclaEspecial,
  reglas: ReglasDeCantidad,
): string {
  if (tecla === "limpiar") {
    return "";
  }
  if (tecla === "borrar") {
    return actual.slice(0, -1);
  }

  if (tecla === ".") {
    // La regla de la tarea: en una presentación entera el punto no existe. El
    // botón ni siquiera se pinta, pero la función también lo ignora — quien la
    // llame desde otro lado obtiene la misma respuesta.
    if (!reglas.allowFractional || actual.includes(".")) {
      return actual;
    }
    // `".5"` es un decimal válido para una máquina y feo para una persona.
    return actual === "" ? "0." : `${actual}.`;
  }

  if (!/^\d$/.test(tecla)) {
    return actual;
  }

  const [entero = "", fraccion] = actual.split(".");

  if (fraccion !== undefined) {
    // El quinto decimal lo REDONDEARÍA Postgres en silencio, y el usuario vería
    // guardado un número que no escribió.
    return fraccion.length >= QUANTITY_SCALE ? actual : `${actual}${tecla}`;
  }

  // El cero inicial se REEMPLAZA: sin esto, tocar 5 sobre una línea que nace en
  // 0 dejaría "05".
  if (entero === "0") {
    return tecla;
  }
  return entero.length >= MAX_ENTEROS ? actual : `${actual}${tecla}`;
}

/** Lo que quedó del texto pegado, y si hubo que recortarlo. */
export interface CantidadSaneada {
  value: string;
  /**
   * `true` cuando se descartó algo. La pantalla lo usa para explicar por qué
   * el número que quedó no es el que se pegó — recortar en silencio dejaría al
   * usuario mirando un campo que "no le hizo caso".
   */
  truncated: boolean;
}

/**
 * Texto de cualquier origen → una cantidad que la columna admite.
 *
 * **Trunca, no redondea, y avisa.** Redondear `12.7` a `13` en una presentación
 * entera cobraría una pieza que nadie pidió; rechazar en silencio dejaría el
 * campo sin explicación. Se corta lo que no cabe y se devuelve la marca para
 * que la pantalla lo diga.
 */
export function sanearCantidad(texto: string, reglas: ReglasDeCantidad): CantidadSaneada {
  const original = texto.trim();
  if (original === "") {
    return { value: "", truncated: false };
  }

  // Se conservan dígitos y puntos y se descarta todo lo demás — signos, letras,
  // separadores de miles. Un "-5" en una venta no es una cantidad negativa: es
  // un pegado torcido.
  let limpio = "";
  let vioPunto = false;
  for (const char of original) {
    if (char === "." && !reglas.allowFractional) {
      // En una presentación entera el punto CORTA, no se salta: pegar "12.7" y
      // quedarse con "127" cobraría ciento veintisiete piezas de un número que
      // decía doce. Lo que sigue al punto es la parte que no cabe.
      break;
    }
    if (/\d/.test(char)) {
      limpio += char;
      continue;
    }
    // Los demás caracteres se DESCARTAN y la lectura sigue: pegar "1,234.5"
    // desde una hoja de cálculo tiene que dar 1234.5, no 1.
    if (char === "." && !vioPunto) {
      limpio += char;
      vioPunto = true;
    }
  }

  const [entero = "", fraccion] = limpio.split(".");
  const enteroCortado = entero.slice(0, MAX_ENTEROS);
  const fraccionCortada = fraccion?.slice(0, QUANTITY_SCALE);

  const value =
    fraccionCortada === undefined ? enteroCortado : `${enteroCortado}.${fraccionCortada}`;

  // El punto a medio escribir (`"12."`) NO cuenta como recorte: es un estado
  // legítimo de alguien tecleando, no un error que haya que explicar.
  return { value, truncated: value !== original };
}
