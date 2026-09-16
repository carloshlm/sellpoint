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

/** Un problema de UNA fila de un documento: número de línea (desde 1), campo y motivo ya traducido. */
export interface LineIssue {
  line: number;
  field: string;
  message: string;
}

const RUTA_DE_LINEA = /^lines\.(\d+)\.([A-Za-z]+)$/;

/**
 * Los errores del 400 que caen en una FILA (`lines.0.quantity`), con la línea
 * contada desde 1 como la ve la persona.
 *
 * Carlos (2026-09-15): la orden de compra respondía «Revisa los datos de la
 * orden de compra.» y había que adivinar qué fila tenía la cantidad vacía. El
 * API ya mandaba la ruta; faltaba que la pantalla la leyera.
 */
export function lineIssuesOf(error: ApiError): LineIssue[] {
  return [...fieldErrorsOf(error)]
    .flatMap(([key, message]) => {
      const ruta = RUTA_DE_LINEA.exec(key);
      return ruta ? [{ line: Number(ruta[1]) + 1, field: ruta[2] as string, message }] : [];
    })
    .sort((a, b) => a.line - b.line);
}

/**
 * «Línea 2 · Cantidad: Falta la cantidad.», una por renglón. `labels` traduce
 * el nombre del campo con las MISMAS etiquetas de las columnas de la tabla;
 * un campo sin etiqueta se nombra por su clave antes que desaparecer.
 * Sin problemas, `null`: el que llama decide su mensaje de respaldo.
 */
export function describeLineIssues(
  issues: readonly LineIssue[],
  t: (key: string, options?: Record<string, unknown>) => string,
  labels: Readonly<Record<string, string>>,
): string | null {
  if (issues.length === 0) return null;
  return issues
    .map((issue) =>
      t("common.form.lineIssue", {
        line: issue.line,
        field: labels[issue.field] ?? issue.field,
        message: issue.message,
      }),
    )
    .join("\n");
}

/**
 * Los errores del 422 de la carga rápida, indexados por CÓDIGO DE BARRAS.
 *
 * Por código y no por número de línea a propósito: en esa pantalla la fila
 * nueva se pinta ARRIBA, así que el índice visual no coincide con el del
 * envío. El código de barras sí es la identidad de la fila, y no cambia
 * porque alguien quite un renglón de en medio.
 *
 * Mismo molde tolerante que `fieldErrorsOf`: una respuesta sin `errors`
 * —un 500, un 409 de negocio— devuelve vacío y el mensaje general basta.
 */
export function quickLineErrorsOf(error: ApiError): Map<string, string> {
  const crudo = (error as unknown as { errors?: unknown }).errors;
  const encontrados = new Map<string, string>();
  if (!Array.isArray(crudo)) {
    return encontrados;
  }
  for (const entrada of crudo) {
    if (entrada === null || typeof entrada !== "object") {
      continue;
    }
    const { itemCode, message } = entrada as { itemCode?: unknown; message?: unknown };
    if (typeof itemCode === "string" && itemCode && typeof message === "string" && message) {
      encontrados.set(itemCode, message);
    }
  }
  return encontrados;
}
