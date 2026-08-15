import { SUPPORTED_CURRENCIES } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F1-WEB-ONBOARD-01, paso 1 (datos del negocio + moneda operacional).
 * Mismos mensajes-como-clave-i18n que `lib/rbac/schemas.ts`: el componente
 * traduce con `t(...)`, el schema queda puro.
 */
const requiredString = z.string().trim().min(1, "validation.required");

export const businessStepSchema = z.object({
  legalName: requiredString,
  taxId: requiredString,
  address: requiredString,
  timezone: requiredString,
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export type BusinessStepValues = z.infer<typeof businessStepSchema>;
