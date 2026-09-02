/**
 * La fecha de un documento de inventario es la de su ESTADO ACTUAL.
 *
 * ── Por qué existe (Carlos, 2026-09-02) ───────────────────────────────────
 *
 * Un documento tiene tres momentos: cuándo se abrió el folio (`createdAt`),
 * cuándo se asentó (`confirmedAt`) y cuándo se canceló (`canceledAt`). El
 * listado, el filtro Desde/Hasta y el PDF mostraban siempre el primero, y la
 * pregunta que alguien se hace frente a Entradas es «¿qué entró esta
 * semana?» — la del asiento. Un borrador abierto el 1 y asentado el 3 ES del
 * 3: ese día movió el stock.
 *
 * La regla vive en UNA función, genérica sobre `Date` (API) y `string` ISO
 * (web), para que la columna que se ve y el rango que filtra no puedan
 * divergir. `effectiveDocumentDateField` es la misma regla dicha como
 * columna: el `where` de Prisma no puede llamar a una función sobre filas que
 * todavía no leyó, pero sí puede preguntar qué campo aplica a cada estado.
 */
export const INVENTORY_DOCUMENT_STATUSES = ["draft", "confirmed", "canceled"] as const;
export type InventoryDocumentStatus = (typeof INVENTORY_DOCUMENT_STATUSES)[number];

export type EffectiveDateField = "createdAt" | "confirmedAt" | "canceledAt";

export interface DocumentDateFields<D> {
  status: InventoryDocumentStatus;
  createdAt: D;
  confirmedAt: D | null;
  canceledAt: D | null;
}

/** Qué columna es «la fecha» de un documento según su estado. */
export function effectiveDocumentDateField(status: InventoryDocumentStatus): EffectiveDateField {
  switch (status) {
    case "confirmed":
      return "confirmedAt";
    case "canceled":
      return "canceledAt";
    default:
      return "createdAt";
  }
}

/**
 * La fecha del estado actual. Si la columna del estado viene vacía —un dato
 * legado, que el `confirm` de hoy no produce— cae a la apertura antes que a
 * nada: una fecha aproximada se puede leer, un «—» en un listado no.
 */
export function effectiveDocumentDate<D>(doc: DocumentDateFields<D>): D {
  const campo = effectiveDocumentDateField(doc.status);
  return doc[campo] ?? doc.createdAt;
}
