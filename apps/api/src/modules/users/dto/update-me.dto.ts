import { SUPPORTED_LOCALES } from "@sellpoint/shared";
import { z } from "zod";

// F1-LOCALE-05: PATCH /me solo acepta `locale` por ahora — el endpoint
// queda abierto a más campos de perfil en tareas futuras sin romper el
// contrato (agregar `.optional()` a los nuevos, nunca sacar `locale`).
export const updateMeSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
});

export type UpdateMeDto = z.infer<typeof updateMeSchema>;
