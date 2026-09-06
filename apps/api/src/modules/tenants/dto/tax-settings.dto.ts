import { MAX_TAX_COMPONENTS, rateToScaled, taxModeSchema } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F4-TAX-09 — lo que se cambia con un PUT de impuestos: el modo, la
 * provincia o el estado, y el catálogo completo de grupos con sus
 * componentes. Los grupos se reconocen por `code` (ids estables); un grupo
 * que no viene en el body se DESACTIVA, nunca se borra.
 */
const codigo = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_]{1,32}$/, { message: "tenants.tax_code_invalid" });

const tasa = z
  .string()
  .trim()
  .refine(
    (v) => {
      try {
        rateToScaled(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "tenants.tax_rate_invalid" },
  );

const componente = z
  .object({
    code: codigo.pipe(z.string().max(16)),
    name: z.string().trim().min(1).max(40),
    rate: tasa,
  })
  .strict();

const grupo = z
  .object({
    code: codigo,
    name: z.string().trim().min(1).max(60),
    isDefault: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    rates: z.array(componente).max(MAX_TAX_COMPONENTS),
  })
  .strict()
  .refine((g) => new Set(g.rates.map((r) => r.code)).size === g.rates.length, {
    message: "tenants.tax_codes_duplicated",
  });

export const updateTaxSettingsSchema = z
  .object({
    mode: taxModeSchema.optional(),
    /** ISO 3166-2 sin prefijo (`ON`, `TX`); el service la valida contra el país del negocio. */
    region: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{1,3}$/, { message: "tenants.tax_invalid_region" })
      .nullable()
      .optional(),
    groups: z.array(grupo).max(50).optional(),
  })
  .strict()
  .refine((v) => v.mode !== undefined || v.region !== undefined || v.groups !== undefined, {
    message: "tenants.empty_update",
  })
  .refine(
    (v) => v.groups === undefined || new Set(v.groups.map((g) => g.code)).size === v.groups.length,
    {
      message: "tenants.tax_codes_duplicated",
    },
  )
  // Exactamente UN default entre los grupos ACTIVOS: es lo que exige el
  // índice parcial de la base, y se dice acá con un mensaje y no con un P2002.
  .refine(
    (v) => v.groups === undefined || v.groups.filter((g) => g.isDefault && g.isActive).length === 1,
    { message: "tenants.tax_default_required" },
  );

export type UpdateTaxSettingsDto = z.infer<typeof updateTaxSettingsSchema>;
