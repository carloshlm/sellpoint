/**
 * Normaliza un CÓDIGO de catálogo (sku de producto, código de servicio, de
 * almacén, de proveedor, de registro de subcatálogo, de estudio) a
 * MAYÚSCULAS (Carlos, 2026-09-12: «todos los campos de código sean solo
 * mayúsculas»).
 *
 * **Por qué vive en `shared` y no en la pantalla**: cada uno de esos códigos
 * tiene un índice único por tenant SENSIBLE a mayúsculas, así que `abc` y
 * `ABC` serían dos productos distintos, y una planilla con `abc` crearía un
 * duplicado en vez de actualizar. La regla tiene que estar en el borde del
 * API (todo camino entra por ahí) y repetirse en el input (lo que se escribe
 * es lo que se guarda, sin sorpresas al recargar).
 *
 * **Por qué NO es `normalizeLotCode`**: el lote translitera acentos y filtra a
 * `[A-Z0-9-]` porque es un identificador de caja física. Un código de
 * catálogo lo elige el negocio con su vocabulario: `REF.1234/A` es un sku
 * válido y borrarle el punto o la barra lo convertiría en otro código. Acá
 * solo se recorta, se colapsa el espacio interno y se sube a mayúsculas.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}
