import { Prisma } from "../../generated/prisma/client";

/**
 * El nombre de la restricción que se violó, o `null` si el error no es una
 * violación de unicidad.
 *
 * ── Por qué existe esta función (2026-08-24) ──────────────────────────────
 *
 * Dos services leían `error.meta.target` para decidir QUÉ se repitió. Con
 * Prisma 7 y driver adapter **ese campo no existe**: el nombre viaja enterrado
 * en `meta.driverAdapterError.cause.originalMessage`, dentro del texto que
 * devuelve Postgres. Medido con una sonda contra la base real.
 *
 * El fallo era silencioso, que es lo que lo hacía caro: `products.service`
 * acusaba al SKU cuando el repetido era el código de barras, y
 * `presentations.service` decía «nombre repetido» ante un código duplicado.
 * Los dos caminos devolvían 409, así que ningún test se ponía rojo — solo el
 * usuario, buscando el problema donde no estaba.
 *
 * Se aceptan las DOS formas a propósito: si una versión futura de Prisma
 * vuelve a poblar `target`, esto sigue funcionando sin que nadie lo toque.
 */
export function restriccionViolada(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }

  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { originalMessage?: unknown } };
      }
    | undefined;

  const target = meta?.target;
  if (target !== undefined) {
    return Array.isArray(target) ? target.join(",") : String(target);
  }

  const original = meta?.driverAdapterError?.cause?.originalMessage;
  if (typeof original !== "string") {
    // Un P2002 sin pistas: se devuelve vacío para que el llamador caiga en su
    // mensaje genérico. Peor que no saber qué se repitió es tirar un 500
    // encima del 409.
    return "";
  }

  // Postgres lo entrecomilla: `... unique constraint "nombre_del_indice"`.
  return /"([^"]+)"/.exec(original)?.[1] ?? original;
}
