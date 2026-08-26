import { SUPPORTED_LOCALES } from "@sellpoint/shared";
import { z } from "zod";

// F1-LOCALE-05 nació con solo `locale`; "Tus datos" editable (Carlos,
// 2026-08-26) lo crece a nombre y apellidos. Todos opcionales pero al menos
// uno presente (mismo patrón que updateTenantSchema): es un PATCH parcial.
// El email NO está a propósito — es la identidad de acceso y cambiarlo
// exigirá su propio flujo con re-verificación.
export const updateMeSchema = z
  .object({
    locale: z.enum(SUPPORTED_LOCALES).optional(),
    firstName: z.string().trim().min(1).optional(),
    lastNamePaternal: z.string().trim().min(1).optional(),
    // `null` BORRA el apellido materno: es opcional desde el registro.
    lastNameMaternal: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "users.invalid_body",
  });

export type UpdateMeDto = z.infer<typeof updateMeSchema>;
