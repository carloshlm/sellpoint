import {
  hasValidMoneyScale,
  MONEY_MAX,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_TAX_MODES,
} from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-PO-04 — los cuerpos de Órdenes de compra. Todos `.strict()`, como en
 * Compras: un campo que el API no conoce es un error del cliente.
 *
 * La orden nace con lo mínimo (proveedor, almacén y la fecha del pedido) y
 * el resto se captura con autoguardado; las líneas van en BLOQUE (`PUT`)
 * porque cada guardado recompone los impuestos estimados.
 */
const dinero = z.number().min(0).max(MONEY_MAX).refine(hasValidMoneyScale, {
  message: "purchase_orders.invalid_amount",
});
const texto = (max: number) => z.string().trim().min(1).max(max);
const bandera = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const createPurchaseOrderSchema = z
  .object({
    supplierId: z.uuid(),
    warehouseId: z.uuid().optional(),
    /** La fecha del PEDIDO: un día del calendario, de hoy para atrás. */
    orderDate: z.iso.date(),
    /** Cuándo se espera la mercancía: la ÚNICA fecha que puede ser futura. */
    expectedDate: z.iso.date().nullable().optional(),
  })
  .strict();

export const updatePurchaseOrderSchema = z
  .object({
    supplierId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    orderDate: z.iso.date().optional(),
    expectedDate: z.iso.date().nullable().optional(),
    supplierReference: texto(120).nullable().optional(),
    paymentTerms: texto(120).nullable().optional(),
    taxMode: z.enum(PURCHASE_TAX_MODES).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "purchase_orders.empty_update" });

/** Lo que sigue vivo en una orden EMITIDA: promesas y anotaciones, nada de dinero. */
export const CAMPOS_VIVOS_TRAS_EMITIR = [
  "expectedDate",
  "supplierReference",
  "paymentTerms",
  "notes",
] as const;

export const purchaseOrderLineSchema = z
  .object({
    productId: z.uuid(),
    /** `null` = la unidad base, igual que en la compra. */
    presentationId: z.uuid().nullish(),
    /** Lo pedido: mayor que cero, siempre (una línea de cero no es un pedido). */
    quantity: z.number().gt(0).max(99_999_999),
    /** El costo ACORDADO. Nullable en el borrador; emitir lo exige. */
    unitCost: dinero.nullish(),
    discount: dinero.default(0),
    /** Ausente = el impuesto default del negocio; `null` = sin impuesto. */
    taxGroupId: z.uuid().nullish(),
  })
  .strict();

export const replacePurchaseOrderLinesSchema = z
  .object({ lines: z.array(purchaseOrderLineSchema).max(500) })
  .strict();

/** F9-PO-09: las recepciones confirmadas (sin factura) que una compra va a facturar. */
export const createPurchaseFromReceiptsSchema = z
  .object({ receiptIds: z.array(z.uuid()).min(1).max(50) })
  .strict();

export const cancelPurchaseOrderSchema = z
  .object({
    reason: z.string().trim().min(3, "purchase_orders.cancel_reason_required").max(500),
  })
  .strict();

/** Los filtros que comparten el listado y su resumen (sin `.refine`: se extiende). */
const filtrosDeOrdenes = z.object({
  /** Folio, referencia del proveedor, notas o nombre del proveedor. */
  query: z.string().trim().min(1).max(120).optional(),
  folio: z.string().trim().min(1).max(20).optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  /** Días del calendario del negocio sobre `order_date` (DATE con DATE). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Sobre `expected_date`: «¿qué debería llegar esta semana?». */
  expectedFrom: z.iso.date().optional(),
  expectedTo: z.iso.date().optional(),
  /** Solo las que todavía esperan mercancía (`open` y `partially_received`). */
  pendingOnly: bandera,
  /** Solo las que tienen recepciones confirmadas SIN compra: lo recibido sin factura. */
  pendingInvoice: bandera,
});

const rangoCoherente = (q: {
  from?: string;
  to?: string;
  expectedFrom?: string;
  expectedTo?: string;
}) =>
  (q.from === undefined || q.to === undefined || q.from <= q.to) &&
  (q.expectedFrom === undefined || q.expectedTo === undefined || q.expectedFrom <= q.expectedTo);

export const listPurchaseOrdersQuerySchema = filtrosDeOrdenes
  .extend({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict()
  .refine(rangoCoherente, { message: "purchase_orders.invalid_query", path: ["to"] });

export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderDto = z.infer<typeof updatePurchaseOrderSchema>;
export type PurchaseOrderLineDto = z.infer<typeof purchaseOrderLineSchema>;
export type ReplacePurchaseOrderLinesDto = z.infer<typeof replacePurchaseOrderLinesSchema>;
export type CancelPurchaseOrderDto = z.infer<typeof cancelPurchaseOrderSchema>;
export type CreatePurchaseFromReceiptsDto = z.infer<typeof createPurchaseFromReceiptsSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
