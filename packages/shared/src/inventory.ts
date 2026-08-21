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
 * Las series del PUNTO DE VENTA (F4).
 *
 * Van aparte de `FOLIO_PREFIXES` y no dentro, porque aquella está tipada por
 * `InventoryDocumentType` y **una venta no es un documento de inventario**:
 * vive en `sales`, no en `inventory_documents`. Meterlas ahí obligaría a
 * ensanchar ese tipo con dos miembros que ninguna de sus funciones sabe
 * manejar.
 *
 * Lo que SÍ comparten es el mecanismo: `nextFolio(tx, tenantId, key, prefix)`
 * toma cualquier clave sobre `tenant_sequences`, así que una serie es un par
 * (clave, prefijo) y nada más.
 *
 * `COT` es la cotización, que **sí** tiene documento propio y toma su folio al
 * crearse. `VTA` es la venta, que lo toma dentro de la transacción del cobro:
 * el carrito vive en el cliente y un carrito abandonado no debe gastar un
 * número de la serie.
 */
export const POS_FOLIO_PREFIXES = {
  sale: "VTA",
  quote: "COT",
} as const satisfies Record<string, string>;

/** Todas las series del sistema. Ninguna puede repetir prefijo con otra. */
export const ALL_FOLIO_PREFIXES = [
  ...Object.values(FOLIO_PREFIXES),
  ...Object.values(POS_FOLIO_PREFIXES),
] as const;

/**
 * Prefijos apartados para fases futuras.
 *
 * Quedó **vacío** el 2026-08-21: `VTA` era su único habitante y F4-DB-03 lo
 * puso en uso. La constante se conserva —con su test— porque la próxima fase
 * que necesite apartar una serie ya tiene dónde, y porque el test de
 * no-colisión la incluye: una serie reservada tampoco puede chocar con una
 * viva.
 */
export const RESERVED_FOLIO_PREFIXES = [] as const;

// ─────────────────────────────────────────────────────────────────────────
// Motivos de movimiento — la fuente ÚNICA
// ─────────────────────────────────────────────────────────────────────────
//
// Esta tabla alimenta cuatro lugares que tienen que decir lo mismo: el enum
// `MovementReason` de Prisma, el CHECK dirección×motivo de la migración de
// F3-DB-01, el `superRefine` de los DTOs y los formularios del front. Un test
// de contrato en el API fija que no diverjan — el mismo molde que `UNITS`
// contra la tabla `units`.

export const MOVEMENT_DIRECTIONS = ["entry", "exit"] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

export const MOVEMENT_REASONS = [
  "invoice",
  "adjustment",
  "transfer",
  "customer_return",
  "sale",
  "sale_return",
  "loss",
  "consumption",
  "expired",
  "physical_count",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/**
 * Qué motivo vale en qué dirección. La mitad de las 20 combinaciones posibles
 * son imposibles en el negocio: una "entrada por merma" o una "salida por
 * factura de compra" son errores de programación, no estados del inventario.
 *
 * `transfer` y `physical_count` van en las DOS: el traspaso sale del origen y
 * entra al destino; el conteo saca el teórico y mete lo contado.
 */
export const REASONS_BY_DIRECTION: Record<MovementDirection, readonly MovementReason[]> = {
  entry: ["invoice", "adjustment", "transfer", "customer_return", "sale_return", "physical_count"],
  exit: ["adjustment", "transfer", "sale", "loss", "consumption", "expired", "physical_count"],
};

/**
 * Los motivos que un usuario puede ELEGIR en un formulario. Subconjunto
 * estricto de los válidos: `sale`/`sale_return` los emite solo el POS de F4,
 * `physical_count` solo la aprobación del conteo, y `transfer` en ENTRADA solo
 * la recepción de un traspaso (que se llega desde la vista de tránsito, no
 * eligiendo el motivo).
 *
 * Ofrecer cualquiera de esos en un desplegable dejaría al usuario armar un
 * movimiento que el API rechaza con 422 — el formulario mentiría.
 */
export const SELECTABLE_ENTRY_REASONS = ["invoice", "adjustment", "customer_return"] as const;
export const SELECTABLE_EXIT_REASONS = [
  "adjustment",
  "transfer",
  "loss",
  "consumption",
  "expired",
] as const;

/**
 * Los motivos que NO pueden mover un lote **vencido**.
 *
 * "No puedes vender un producto vencido" (Carlos, 2026-08-20). La lista es
 * corta a propósito, y lo que NO está en ella importa tanto como lo que está:
 *
 *  · `expired` existe justamente para desechar lo caducado — bloquearlo dejaría
 *    la mercancía vencida encerrada en el sistema para siempre;
 *  · `adjustment` y `physical_count` tienen que poder tocar cualquier lote, o
 *    un conteo físico no podría cuadrar nunca contra lo que hay en el anaquel;
 *  · `loss` es la merma, que es a dónde va lo caducado cuando no se usó el
 *    motivo específico;
 *  · `transfer` queda FUERA por decisión de Carlos: concentrar lo vencido en el
 *    CEDIS para devolverlo al proveedor o destruirlo es un flujo legítimo.
 *
 * La COTIZACIÓN de F4 también tiene que respetar esta regla, pero no entra acá:
 * una cotización no genera movimiento de inventario, así que su bloqueo va en
 * el lookup de disponibilidad (`F4-QUOTE`), no en un motivo.
 */
export const REASONS_REJECTING_EXPIRED_LOTS = ["sale"] as const;

/** ¿Este motivo tiene prohibido tocar un lote vencido? */
export function rejectsExpiredLots(reason: MovementReason | null | undefined): boolean {
  return (
    reason !== null &&
    reason !== undefined &&
    (REASONS_REJECTING_EXPIRED_LOTS as readonly string[]).includes(reason)
  );
}

export interface ReasonRules {
  /** Nº de documento, orden, área o concepto — según el motivo. */
  requiresReference: boolean;
  /** Explicación en texto libre: por qué se ajustó, qué se perdió. */
  requiresNote: boolean;
  /** Costo unitario por línea (solo la compra lo tiene). */
  requiresUnitCost: boolean;
  /** El OTRO almacén del traspaso. */
  requiresLinkedWarehouse: boolean;
}

const NADA: ReasonRules = {
  requiresReference: false,
  requiresNote: false,
  requiresUnitCost: false,
  requiresLinkedWarehouse: false,
};

/**
 * Qué campos exige cada motivo. Es lo que hace reactivo al formulario y lo que
 * valida el DTO: una sola definición para los dos lados.
 *
 * Los motivos que emite el SISTEMA (`sale`, `sale_return`, `physical_count`)
 * no piden nada porque no hay una persona llenando un formulario detrás.
 */
export const REASON_RULES: Record<MovementReason, ReasonRules> = {
  // La compra: el número de factura y el costo son el dato que F5 va a
  // necesitar para el promedio ponderado.
  invoice: { ...NADA, requiresReference: true, requiresUnitCost: true },
  // Ajustar el saldo sin comprobante exige explicar por qué.
  adjustment: { ...NADA, requiresNote: true },
  transfer: { ...NADA, requiresLinkedWarehouse: true },
  customer_return: { ...NADA, requiresNote: true },
  loss: { ...NADA, requiresNote: true },
  // El área o el concepto al que se consumió: "limpieza", "producción".
  consumption: { ...NADA, requiresReference: true },
  expired: { ...NADA, requiresNote: true },
  sale: NADA,
  sale_return: NADA,
  physical_count: NADA,
};

export const TRANSFER_STATUSES = ["in_transit", "completed", "canceled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Un traspaso que lleva más de una semana en tránsito se marca en el listado. */
export const TRANSFER_STALE_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────────
// Cantidades
// ─────────────────────────────────────────────────────────────────────────

export const QUANTITY_DECIMALS = 4;
/** Lo que entra en `DECIMAL(14,4)`: 10 enteros + 4 decimales. */
export const QUANTITY_MAX = 9_999_999_999.9999;

/**
 * Misma forma que `hasValidMoneyScale`: se compara contra el `toFixed` en vez
 * de multiplicar por 10^4, porque `1.15 * 100` da `114.99999999999999` y una
 * cantidad legítima quedaría rechazada.
 *
 * Se valida acá y no solo en la base porque un quinto decimal no explota: la
 * columna lo REDONDEA en silencio, y el usuario vería un saldo que no es el
 * que escribió.
 */
export function hasValidQuantityScale(quantity: number): boolean {
  if (!Number.isFinite(quantity)) {
    return false;
  }
  if (Math.abs(quantity) > QUANTITY_MAX) {
    return false;
  }
  return Number(quantity.toFixed(QUANTITY_DECIMALS)) === quantity;
}
