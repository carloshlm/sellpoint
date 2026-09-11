import {
  hasValidMoneyScale,
  MONEY_MAX,
  PURCHASE_STATUSES,
  PURCHASE_TAX_MODES,
} from "@sellpoint/shared";
import { z } from "zod";
import { lotCodeField } from "../../inventory/dto/document.dto";

/**
 * F9-PURCH-05/06 — los cuerpos de Compras. Todos `.strict()`: un campo que el
 * API no conoce es un error del cliente, no un dato que se ignora.
 *
 * La compra nace con lo mínimo para existir (proveedor, almacén y la fecha
 * del papel) y el resto se captura con autoguardado: por eso la cabecera es
 * un PATCH de campos opcionales y las líneas van en BLOQUE (`PUT`), que es lo
 * que permite recomponer los impuestos de una sola vez.
 */
const dinero = z.number().min(0).max(MONEY_MAX).refine(hasValidMoneyScale, {
  message: "purchases.invalid_amount",
});
const cantidad = z.number().min(0).max(99_999_999);
const texto = (max: number) => z.string().trim().min(1).max(max);

export const createPurchaseSchema = z
  .object({
    supplierId: z.uuid(),
    warehouseId: z.uuid().optional(),
    /** La fecha del PAPEL, tecleada: un día del calendario, sin zona. */
    purchaseDate: z.iso.date(),
  })
  .strict();

export const updatePurchaseSchema = z
  .object({
    supplierId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    purchaseDate: z.iso.date().optional(),
    receivedDate: z.iso.date().nullable().optional(),
    supplierInvoice: texto(120).nullable().optional(),
    /** Lo que dice el papel; el descuadre se deriva y nunca bloquea. */
    declaredTotal: dinero.nullable().optional(),
    taxMode: z.enum(PURCHASE_TAX_MODES).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "purchases.empty_update" });

/** Lo único editable de una compra CONFIRMADA: cuándo llegó y con qué papel. */
export const updateReceptionSchema = z
  .object({
    receivedDate: z.iso.date().nullable().optional(),
    supplierInvoice: texto(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "purchases.empty_update" });

export const purchaseLineSchema = z
  .object({
    productId: z.uuid(),
    /** `null` = la unidad base, igual que en un documento de inventario. */
    presentationId: z.uuid().nullish(),
    quantity: cantidad.nullish(),
    unitCost: dinero.nullish(),
    discount: dinero.default(0),
    /** Ausente = el impuesto default del negocio; `null` = sin impuesto. */
    taxGroupId: z.uuid().nullish(),
    lotCode: lotCodeField().nullish(),
    expiresAt: z.iso.date().nullish(),
    /**
     * F9-PO-09: la línea de la ORDEN que esta línea factura. Solo tiene
     * sentido en una compra nacida de recepciones; la pantalla lo conserva al
     * reguardar las líneas para no perder el hilo del three-way match.
     */
    purchaseOrderLineId: z.uuid().nullish(),
  })
  .strict();

export const replacePurchaseLinesSchema = z
  .object({ lines: z.array(purchaseLineSchema).max(500) })
  .strict();

export const purchaseChargeSchema = z
  .object({
    description: texto(200),
    amount: dinero,
    taxGroupId: z.uuid().nullish(),
  })
  .strict();

export const replacePurchaseChargesSchema = z
  .object({ charges: z.array(purchaseChargeSchema).max(50) })
  .strict();

export const cancelPurchaseSchema = z
  .object({ reason: z.string().trim().min(3, "purchases.cancel_reason_required").max(500) })
  .strict();

/** Los filtros que comparten el listado y su resumen (sin `.refine`: se extiende). */
const filtrosDeCompras = z.object({
  /** Folio, factura del proveedor, notas o nombre del proveedor. */
  query: z.string().trim().min(1).max(120).optional(),
  folio: z.string().trim().min(1).max(20).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  supplierId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  /** F9-PO-09: las compras que nacieron de una orden. */
  purchaseOrderId: z.uuid().optional(),
  /** Días del calendario del negocio sobre `purchase_date` (DATE con DATE). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

const rangoCoherente = (q: { from?: string; to?: string }) =>
  q.from === undefined || q.to === undefined || q.from <= q.to;

export const listPurchasesQuerySchema = filtrosDeCompras
  .extend({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict()
  .refine(rangoCoherente, { message: "purchases.invalid_query", path: ["to"] });

export type CreatePurchaseDto = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseDto = z.infer<typeof updatePurchaseSchema>;
export type UpdateReceptionDto = z.infer<typeof updateReceptionSchema>;
export type PurchaseLineDto = z.infer<typeof purchaseLineSchema>;
export type ReplacePurchaseLinesDto = z.infer<typeof replacePurchaseLinesSchema>;
export type PurchaseChargeDto = z.infer<typeof purchaseChargeSchema>;
export type ReplacePurchaseChargesDto = z.infer<typeof replacePurchaseChargesSchema>;
export type CancelPurchaseDto = z.infer<typeof cancelPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
