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
