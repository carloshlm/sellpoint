import { isCountryCode, SUPPORTED_CURRENCIES } from "@sellpoint/shared";
import { z } from "zod";

// F1-WEB-ONBOARD: PATCH parcial (paso 1 del wizard + futura pantalla de
// configuración de F2), todos los campos opcionales pero al menos uno debe
// venir — mismo criterio que `update-user.dto.ts`. `currency` dispara
// `TenantCurrencyChangeableGuard` en el controller, este schema solo valida
// que sea una moneda soportada (F1-LOCALE-07). `country` (ad-hoc post-Fase 1,
// 2026-08-16, MERCADOS.md §2): sin CHECK SQL de países — la validación vive
// acá, contra el mismo catálogo (`isCountryCode`, `@sellpoint/shared`) que
// alimenta el selector del front, así que un país nuevo se habilita en un
// solo lugar sin migración.
export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    legalName: z.string().trim().min(1).optional(),
    taxId: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
    // El ÚNICO campo borrable (nullable): nunca lo exigió el wizard, así que
    // capturarlo una vez no lo vuelve obligatorio. min(5)/max(20): suficiente
    // para cualquier E.164 con formato, sin validar por país (mismo criterio
    // laxo que `address` — la forma exacta es asunto del negocio, no nuestro).
    phone: z.string().trim().min(5).max(20).nullable().optional(),
    timezone: z.string().trim().min(1).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    templateChoice: z.string().trim().min(1).optional(),
    country: z.string().refine(isCountryCode, { message: "tenants.invalid_country" }).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "tenants.invalid_body",
  });

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
