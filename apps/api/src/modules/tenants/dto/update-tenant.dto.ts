import { isCountryCode, isE164, SUPPORTED_CURRENCIES } from "@sellpoint/shared";
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
    // capturarlo una vez no lo vuelve obligatorio. Solo E.164 CANÓNICO
    // (`+525512345678`, isE164 de @sellpoint/shared — la misma fuente que el
    // selector del web): la UI compone país + número y manda un solo string;
    // aceptar separadores acá dejaría cinco formatos del mismo teléfono en la
    // base. Sin validación de longitudes por país, mismo criterio que country.
    phone: z.string().refine(isE164, { message: "tenants.invalid_phone" }).nullable().optional(),
    timezone: z.string().trim().min(1).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    templateChoice: z.string().trim().min(1).optional(),
    country: z.string().refine(isCountryCode, { message: "tenants.invalid_country" }).optional(),
    // El tema del negocio (2026-08-25/26): catálogo cerrado, sin CHECK SQL —
    // mismo criterio que currency/country. Los primeros 4 se ofrecen en el
    // wizard; los 8 completos, desde Mi perfil.
    theme: z
      .enum(["light", "dark", "sand", "grape", "emerald", "cabin", "cotton", "charcoal"])
      .optional(),
    // F7-POS-05: "Vender sin existencias". En planes CON control de stock lo
    // decide el admin; en Free/Basic la venta sin stock ya es implícita por
    // plan y este valor no cambia nada (la regla efectiva es un OR).
    sellWithoutStock: z.boolean().optional(),
    usesLocations: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "tenants.invalid_body",
  });

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
