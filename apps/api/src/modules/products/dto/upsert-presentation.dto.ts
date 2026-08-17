import { z } from "zod";
import { moneyAmount } from "../money";

/**
 * F2-PRESENT-01. `allowFractionalInput` es OPCIONAL a propósito: si no viene,
 * lo deriva el server de la categoría de la unidad base del producto. Que el
 * cliente pueda mandarlo es el override del TenantAdmin, no el camino normal.
 */
export const createPresentationSchema = z.object({
  name: z.string().trim().min(1).max(64),
  factor: z.number().positive(),
  isPurchasable: z.boolean().default(true),
  isSellable: z.boolean().default(true),
  isDefaultSale: z.boolean().default(false),
  allowFractionalInput: z.boolean().optional(),
  barcode: z.string().trim().min(1).max(64).optional(),
  price: moneyAmount().optional(),
  cost: moneyAmount().optional(),
});

export const updatePresentationSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    factor: z.number().positive().optional(),
    isPurchasable: z.boolean().optional(),
    isSellable: z.boolean().optional(),
    isDefaultSale: z.boolean().optional(),
    allowFractionalInput: z.boolean().optional(),
    barcode: z.string().trim().min(1).max(64).nullable().optional(),
    price: moneyAmount().nullable().optional(),
    cost: moneyAmount().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "products.empty_update" });

export type CreatePresentationDto = z.infer<typeof createPresentationSchema>;
export type UpdatePresentationDto = z.infer<typeof updatePresentationSchema>;
