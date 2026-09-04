import { customerLabelSchema } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-RECEP-17 — la configuración de Recepción: la palabra propia (o `null`
 * para volver a la de fábrica) y las dos entradas del menú. Al menos una.
 */
export const updateReceptionSettingsSchema = z
  .object({
    customerLabel: customerLabelSchema.nullable().optional(),
    showCustomers: z.boolean().optional(),
    showTurns: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "reception.empty_update" });

export type UpdateReceptionSettingsDto = z.infer<typeof updateReceptionSettingsSchema>;
