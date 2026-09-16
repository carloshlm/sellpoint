/**
 * F10-QUICKCAT-01 — la aritmética del GTIN, compartida por el API (buscar en
 * el catálogo global y aportarle códigos) y el web (validar antes de mandar).
 *
 * Es el puerto literal de `apps/api/prisma/seed/barcode-catalog/gtin.py` y de
 * `pais_de` en `gs1-prefixes.py`, que hasta hoy solo existían en Python y solo
 * corrían al sembrar. **Las dos implementaciones tienen que decidir lo mismo**:
 * si el sembrador guardó una fila bajo una clave y el API la busca bajo otra,
 * el catálogo tiene 953,969 productos que nadie encuentra.
 *
 * ── Por qué se normaliza a 14 dígitos ───────────────────────────────────
 *
 * El MISMO producto se escribe distinto según el simbolismo. Una lata
 * estadounidense trae UPC-A de 12 (`041500750903`); la misma lata en un
 * catálogo europeo viaja como EAN-13 con un cero al frente
 * (`0041500750903`). Guardadas tal cual son dos filas; rellenadas con ceros a
 * la izquierda hasta 14 —la forma canónica de GS1— son una sola clave, y la
 * comparación deja de depender de con qué lector se escaneó.
 *
 * ── Por qué el dígito verificador ───────────────────────────────────────
 *
 * Es lo único que separa un código real de un dedazo. Sin él entra basura a
 * una tabla que comparten todos los negocios, y de esa tabla NO se edita nada:
 * lo que entra mal, se queda mal.
 */

/**
 * F10-QUICKCAT — cuántas líneas admite una carga rápida.
 *
 * Vive en `shared` y no en cada lado porque el API y la pantalla **tienen que
 * decir el mismo número**: que el navegador permita más de lo que el servidor
 * acepta es una pared al final del trabajo, después de escanear. Y son dos
 * escrituras por línea en una sola transacción, así que el número también
 * protege el tiempo límite.
 */
export const QUICK_ADD_MAX_LINES = 100;

/** Las longitudes que son un GTIN: EAN-8, UPC-A, EAN-13 y GTIN-14. */
export const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** La clave canónica: `Char(14)` en `global_barcode_catalog`. */
export const GTIN_CANONICAL_LENGTH = 14;

/**
 * Módulo 10 de GS1 sobre el código SIN su último dígito.
 *
 * Se pondera 3,1,3,1… **contando desde el final**, y por eso la misma función
 * sirve para las cuatro longitudes sin ramificar. Asume dígitos: quien lo
 * llama ya validó la forma (lo hace `normalizeGtin14`).
 */
export function gtinCheckDigit(body: string): number {
  let suma = 0;
  for (let i = body.length - 1, peso = 3; i >= 0; i -= 1, peso = peso === 3 ? 1 : 3) {
    suma += Number(body[i]) * peso;
  }
  return (10 - (suma % 10)) % 10;
}

/** Sin espacios ni guiones: lo que el lector manda y lo que la persona teclea. */
export function cleanGtin(code: string): string {
  return code.trim().replace(/[\s-]/g, "");
}

/**
 * El GTIN-14 canónico, o `null` si el código no es un GTIN válido.
 *
 * Rechaza lo que no sea dígitos, las longitudes que no son de GTIN, el dígito
 * verificador que no cuadra y los códigos de puros ceros — que aparecen como
 * relleno en los volcados y pasarían el módulo 10.
 */
export function normalizeGtin14(code: string | null | undefined): string | null {
  if (code === null || code === undefined) {
    return null;
  }
  const limpio = cleanGtin(code);
  if (!/^\d+$/.test(limpio)) {
    return null;
  }
  if (!(GTIN_LENGTHS as readonly number[]).includes(limpio.length)) {
    return null;
  }
  if (gtinCheckDigit(limpio.slice(0, -1)) !== Number(limpio.at(-1))) {
    return null;
  }
  if (/^0+$/.test(limpio)) {
    return null;
  }
  return limpio.padStart(GTIN_CANONICAL_LENGTH, "0");
}

/**
 * El prefijo GS1 de tres dígitos, o `null` si el código es de circulación
 * restringida y NUNCA puede aportarse al catálogo compartido.
 *
 * ── La trampa del EAN-8 ─────────────────────────────────────────────────
 *
 * El EAN-8 lleva su prefijo en sus PROPIOS tres primeros dígitos, no en los
 * del GTIN-14 relleno. El EAN-8 mexicano `75000011` rellenado es
 * `00000075000011`: leerle el prefijo al relleno daría `000` —Estados
 * Unidos— en vez de `750`. Por eso hace falta la longitud original, y por eso
 * `classifyGtin` existe: para que nadie tenga que acordarse de pasarla.
 *
 * Un EAN-8 que empieza con 0 o 2 es un RCN-8: el número lo asigna la propia
 * tienda para su marca blanca. El `00000390` es un producto en un supermercado
 * y otro distinto en el de enfrente — vale en su negocio, jamás en la tabla de
 * todos.
 *
 * Para las demás longitudes el prefijo se lee sobre la forma de 13, salteando
 * el indicador de empaque (el primer dígito del GTIN-14).
 */
export function gs1Prefix(gtin14: string, originalLength: number): string | null {
  if (originalLength === 8) {
    const ean8 = gtin14.slice(-8);
    return ean8[0] === "0" || ean8[0] === "2" ? null : ean8.slice(0, 3);
  }
  return gtin14.slice(1, 4);
}

/**
 * Las formas EQUIVALENTES del mismo código, la canónica primero.
 *
 * Hace falta porque los productos ya dados de alta guardan el código **tal
 * como se escaneó** (`product_presentations.barcode`), no normalizado: el
 * mostrador lo compara literal y esta función no migra datos vivos de nadie.
 * Así que para saber si el negocio YA tiene un código hay que buscar todas sus
 * escrituras posibles: `07501055300013` y `7501055300013` son el mismo
 * producto.
 *
 * Una longitud entra solo si lo que se le quita adelante son puros ceros —
 * recortar un dígito significativo daría otro código, no otra escritura del
 * mismo.
 */
export function gtinVariants(gtin14: string): string[] {
  return GTIN_LENGTHS.filter((largo) => largo <= gtin14.length)
    .map((largo) => gtin14.slice(-largo))
    .filter((forma) => /^0*$/.test(gtin14.slice(0, gtin14.length - forma.length)))
    .sort((a, b) => b.length - a.length);
}

/** Un código de barras ya entendido: la clave, su prefijo y sus escrituras. */
export interface GtinInfo {
  /** La clave canónica de 14 dígitos. */
  gtin14: string;
  /**
   * El prefijo GS1, o `null` cuando es de circulación restringida. `null` NO
   * es un error: la etiqueta de báscula del negocio es un código legítimo para
   * él. Lo único que significa es que ese código no se aporta al catálogo
   * global.
   */
  prefix: string | null;
  /** Las escrituras equivalentes, para buscar en el catálogo del negocio. */
  variants: string[];
}

/**
 * Normaliza y ubica un código en un solo paso, o `null` si no es un GTIN.
 *
 * Es la puerta de entrada que deberían usar los servicios: llamar a
 * `gs1Prefix` por separado obliga a arrastrar la longitud original y ahí es
 * donde se pierde el prefijo del EAN-8.
 */
export function classifyGtin(code: string | null | undefined): GtinInfo | null {
  const gtin14 = normalizeGtin14(code);
  if (gtin14 === null) {
    return null;
  }
  return {
    gtin14,
    prefix: gs1Prefix(gtin14, cleanGtin(code as string).length),
    variants: gtinVariants(gtin14),
  };
}
