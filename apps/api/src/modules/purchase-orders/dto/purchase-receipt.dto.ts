import { z } from "zod";
import { lotCodeField } from "../../inventory/dto/document.dto";

/**
 * F9-PO-07 — los cuerpos de la RECEPCIÓN: el papel del andén. La cabecera se
 * autoguarda (fecha, remisión, notas) y las líneas van en BLOQUE, como en la
 * compra: cada guardado revalida cada cantidad contra lo pendiente.
 */
const texto = (max: number) => z.string().trim().min(1).max(max);

export const updatePurchaseReceiptSchema = z
  .object({
    /** Cuándo llegó: un hecho, de hoy para atrás. */
    receivedDate: z.iso.date().optional(),
    /** La remisión (MX) o el packing slip (US/CA) con que llegó. */
    packingSlip: texto(120).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "purchase_orders.empty_update" });

export const purchaseReceiptLineSchema = z
  .object({
    purchaseOrderLineId: z.uuid(),
    /** Lo que llegó de esa línea, en la presentación de la orden. Cero no se captura. */
    quantity: z.number().gt(0).max(99_999_999),
    lotCode: lotCodeField().nullish(),
    expiresAt: z.iso.date().nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();

export const replacePurchaseReceiptLinesSchema = z
  .object({ lines: z.array(purchaseReceiptLineSchema).max(500) })
  .strict();

export const cancelPurchaseReceiptSchema = z
  .object({
    reason: z.string().trim().min(3, "purchase_orders.cancel_reason_required").max(500),
  })
  .strict();

export type UpdatePurchaseReceiptDto = z.infer<typeof updatePurchaseReceiptSchema>;
export type PurchaseReceiptLineDto = z.infer<typeof purchaseReceiptLineSchema>;
export type ReplacePurchaseReceiptLinesDto = z.infer<typeof replacePurchaseReceiptLinesSchema>;
export type CancelPurchaseReceiptDto = z.infer<typeof cancelPurchaseReceiptSchema>;
