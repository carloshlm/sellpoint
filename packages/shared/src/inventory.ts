/**
 * Los tipos de documento de inventario. Coinciden con el enum
 * `InventoryDocumentType` de Prisma — hay un test de contrato que lo fija.
 *
 * **Tres y nada más** (Carlos, 2026-08-18). Un traspaso NO es un tipo: es un
 * `exit` con `reason_code='transfer'`, y su recepción un `entry` con el mismo
 * motivo. El motivo viaja dentro del documento, nunca en el folio — dos
 * salidas por motivos distintos son el mismo tipo de papel.
 */
export const INVENTORY_DOCUMENT_TYPES = ["entry", "exit", "physical_count"] as const;

export type InventoryDocumentType = (typeof INVENTORY_DOCUMENT_TYPES)[number];

/**
 * El prefijo que se ve en el papel. Una serie por tipo y por tenant: cada
 * negocio arranca sus tres cuentas en 1.
 *
 * Los tres son de tres letras y no se repiten entre sí — si dos tipos
 * compartieran prefijo llegarían al mismo `ENT-000001` desde series distintas
 * y romperían la unicidad `(tenant, folio)`.
 */
export const FOLIO_PREFIXES: Record<InventoryDocumentType, string> = {
  entry: "ENT",
  exit: "SAL",
  physical_count: "INV",
};

/**
 * Prefijos apartados para fases futuras. `VTA` es el de las ventas del POS
 * (F4): se reserva ahora para que nadie lo tome y para dejar dicho que el
 * ticket también será un documento con folio.
 */
export const RESERVED_FOLIO_PREFIXES = ["VTA"] as const;
