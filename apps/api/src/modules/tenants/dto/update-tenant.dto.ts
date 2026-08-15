import { SUPPORTED_CURRENCIES } from "@sellpoint/shared";
import { z } from "zod";

// F1-WEB-ONBOARD: PATCH parcial (paso 1 del wizard + futura pantalla de
// configuración de F2), todos los campos opcionales pero al menos uno debe
// venir — mismo criterio que `update-user.dto.ts`. `currency` dispara
// `TenantCurrencyChangeableGuard` en el controller, este schema solo valida
// que sea una moneda soportada (F1-LOCALE-07).
export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    legalName: z.string().trim().min(1).optional(),
    taxId: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    templateChoice: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "tenants.invalid_body",
  });

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
