import type { ApiError } from "@/lib/api";

/**
 * Errores POR CAMPO de una respuesta 400.
 *
 * El API los devuelve como `errors: [{ key, message, code }]`, donde `key` es
 * la RUTA del campo dentro del body — `sku` para uno suelto,
 * `lines.0.wastePercentage` para el de una fila. Ya vienen traducidos (los
 * traduce `AllExceptionsFilter`), así que acá no se toca el texto.
 *
 * Se devuelve un `Map` indexado por esa ruta y no un objeto anidado: el
 * formulario ya sabe qué ruta le corresponde a cada input y la consulta
 * directo (`errors.get(\`lines.${index}.quantity\`)`). Reconstruir un árbol
 * sería trabajo para volver a aplanarlo al pintar.
 *
 * Tolerante a propósito: un 409 de negocio no trae `errors`, y el reporte de
 * importación usa ese mismo nombre con otra forma (`row`/`field`). Nada de eso
 * debe tumbar un formulario — devuelve vacío y el mensaje general se muestra
 * como siempre.
 */
export function fieldErrorsOf(error: ApiError): Map<string, string> {
  const raw = (error as unknown as { errors?: unknown }).errors;
  const found = new Map<string, string>();

  if (!Array.isArray(raw)) {
    return found;
  }

  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const { key, message } = entry as { key?: unknown; message?: unknown };
    if (typeof key === "string" && key && typeof message === "string" && message) {
      found.set(key, message);
    }
  }

  return found;
}
