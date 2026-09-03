import { z } from "zod";

/** F9-CLINIC-22 — las tres casillas; al menos una. */
export const updateSettingsSchema = z
  .object({
    sellsMedications: z.boolean().optional(),
    sellsLabStudies: z.boolean().optional(),
    sellsDiagnosticStudies: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "medical_clinic.empty_update" });

export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
