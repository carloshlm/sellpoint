import { SUPPORTED_CURRENCIES } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F1-WEB-ONBOARD-01, paso 1 (datos del negocio + moneda operacional).
 * Mismos mensajes-como-clave-i18n que `lib/rbac/schemas.ts`: el componente
 * traduce con `t(...)`, el schema queda puro.
 */
const requiredString = z.string().trim().min(1, "validation.required");

// `country` (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2): PRIMER campo
// del paso 1, requerido — decisión de Carlos. Solo "no vacío" acá, igual que
// `roleId` en `inviteRowSchema`: el select solo ofrece valores del catálogo
// compartido (`ISO_COUNTRY_CODES`), la validación estricta contra el
// catálogo vive en el DTO del backend (`updateTenantSchema`, `isCountryCode`).
export const businessStepSchema = z.object({
  country: requiredString,
  legalName: requiredString,
  taxId: requiredString,
  address: requiredString,
  timezone: requiredString,
  currency: z.enum(SUPPORTED_CURRENCIES),
});

export type BusinessStepValues = z.infer<typeof businessStepSchema>;

/**
 * "Datos del negocio" en Mi perfil (2026-08-25) — la puerta de edición
 * PERMANENTE de lo que el wizard capturó una vez. Schema propio y no
 * `businessStepSchema`: el wizard exige country/timezone/currency que acá no
 * se editan, y `phone` solo existe en esta tarjeta (el wizard nunca lo pidió).
 * Vacío es válido en phone — vaciarlo lo borra; si viene, 5-20 caracteres,
 * espejo de `updateTenantSchema` (apps/api).
 */
export const businessDetailsSchema = z.object({
  name: requiredString,
  legalName: requiredString,
  taxId: requiredString,
  address: requiredString,
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || (value.length >= 5 && value.length <= 20), {
      message: "validation.phone",
    }),
});

export type BusinessDetailsValues = z.infer<typeof businessDetailsSchema>;

const emailSchema = z
  .string()
  .trim()
  .min(1, "validation.required")
  .toLowerCase()
  .pipe(z.email("validation.email"));

/**
 * F1-WEB-ONBOARD-04, paso 4 (D5, #347): "email+nombre+rol por fila, DTO sin
 * relajar" — mismos campos obligatorios que `userFormSchema`
 * (lib/rbac/schemas.ts), que a su vez espeja `create-user.dto.ts` del API.
 * `roleId` es UN rol por fila (no el checklist multi-rol del alta desde
 * /system/users) — el container lo envuelve en `roleIds: [roleId]` al
 * llamar `createUser`, que sigue exigiendo `roleIds.min(1)`.
 */
export const inviteRowSchema = z.object({
  email: emailSchema,
  firstName: requiredString,
  lastNamePaternal: requiredString,
  roleId: requiredString,
});

export const invitesStepSchema = z.object({
  rows: z.array(inviteRowSchema).min(1, "validation.required"),
});

export type InviteRowValues = z.infer<typeof inviteRowSchema>;
export type InvitesStepValues = z.infer<typeof invitesStepSchema>;
