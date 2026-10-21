import { customerLabelSchema, TURN_SERVICES_MAX } from "@sellpoint/shared";
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
    // F9-RECEP-25 — el conjunto COMPLETO de servicios que generan turno al
    // venderse: lo que no viene, se quita. Sin repetidos; que cada uno sea un
    // servicio activo del negocio lo valida el service (necesita la base).
    turnServiceIds: z
      .array(z.uuid())
      .max(TURN_SERVICES_MAX)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "reception.turn_service_invalid",
      })
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "reception.empty_update" });

export type UpdateReceptionSettingsDto = z.infer<typeof updateReceptionSettingsSchema>;
