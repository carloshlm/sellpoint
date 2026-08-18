/**
 * Espejo de los DTO de `apps/api/src/modules/inventory`. Se mantiene a mano y
 * no se genera: el front consume un subconjunto y verlo escrito es lo que
 * permite notar cuándo el API devuelve algo que la pantalla no usa.
 */
export type InventoryDocumentType = "entry" | "exit" | "physical_count";
export type DocumentStatus = "draft" | "confirmed" | "canceled";

export type MovementReason =
  | "invoice"
  | "adjustment"
  | "transfer"
  | "customer_return"
  | "sale"
  | "sale_return"
  | "loss"
  | "consumption"
  | "expired"
  | "physical_count";

export interface DocumentSummary {
  id: string;
  folio: string;
  type: InventoryDocumentType;
  status: DocumentStatus;
  warehouse: { id: string; name: string };
  reasonCode: MovementReason | null;
  reference: string | null;
  lineCount: number;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastNamePaternal: string } | null;
  confirmedAt: string | null;
}

/** Un problema de una línea, en la forma que el formulario pinta sobre la fila. */
export interface DocumentRowError {
  field: string;
  code: string;
  args?: Record<string, unknown>;
}

/**
 * Una fila de la VISTA PREVIA. `stockBefore`/`stockAfter` son lo que el
 * usuario mira antes de confirmar: qué hay y en qué queda.
 */
export interface DocumentRow {
  lineNo: number;
  productId: string;
  sku: string;
  presentationId: string | null;
  quantityInput: string | null;
  quantityBase: string | null;
  unitCost: string | null;
  lotCode: string | null;
  expiresAt: string | null;
  location: string | null;
  newLot: boolean;
  available: string;
  stockBefore: string;
  stockAfter: string;
  /**
   * El reparto FEFO que se APLICARÍA. Sale del mismo `allocateFefo` que usa el
   * confirm, así que es de donde realmente va a salir la mercancía. `null` en
   * entradas, en líneas con lote forzado y en productos sin lotes.
   */
  lotPlan: LotPlanTake[] | null;
  errors: DocumentRowError[];
}

/**
 * Una presentación del producto, con su factor a la unidad base. `factor` es
 * un string decimal como toda cantidad del API: mandarlo como number lo
 * redondearía en el JSON.
 */
export interface DocumentPresentation {
  id: string;
  name: string;
  factor: string;
  allowFractionalInput: boolean;
  isPurchasable: boolean;
  isSellable: boolean;
}

/**
 * El catálogo de lo que YA está en el documento. Viaja con el detalle y no se
 * pide por fila: un documento de 80 líneas haría 80 viajes desde el navegador
 * solo para pintar la equivalencia "3 Caja = 36 unidades".
 */
/** De qué lote saldría una línea, y cuánto de cada uno (F3-EXIT-02). */
export interface LotPlanTake {
  lotCode: string;
  expiresAt: string | null;
  location: string;
  quantity: string;
}

export interface DocumentProduct {
  id: string;
  sku: string;
  name: string;
  /** Código de unidad (`unit`, `g`, `ml`…), no su nombre: lo traduce `unitName`. */
  baseUnit: string;
  isComposite: boolean;
  tracksLots: boolean;
  /**
   * Unidades ARMABLES de un compuesto, con los componentes DE ESTE ALMACÉN.
   * `null` en los productos simples: su saldo ya lo dice.
   */
  availableUnits: number | null;
  presentations: DocumentPresentation[];
}

export interface DocumentDetail extends DocumentSummary {
  reasonNote: string | null;
  authorizedBy: string | null;
  linkedWarehouseId: string | null;
  rows: DocumentRow[];
  products: DocumentProduct[];
  summary: { lines: number; products: number; newLots: number; errors: number };
}

export interface DocumentPage {
  rows: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListDocumentsParams {
  type: InventoryDocumentType;
  status?: DocumentStatus;
  warehouseId?: string;
  folio?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface UpsertLineInput {
  productId: string;
  presentationId?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  lotCode?: string | null;
  expiresAt?: string | null;
  location?: string | null;
  counted?: number | null;
}
