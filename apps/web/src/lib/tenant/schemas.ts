import { COUNTRY_DIAL_CODES, isCountryCode, SUPPORTED_CURRENCIES } from "@sellpoint/shared";
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
 * se editan, y el teléfono solo existe en esta tarjeta (el wizard nunca lo
 * pidió).
 *
 * El teléfono son DOS campos de formulario (país + número nacional) que el
 * container compone en un E.164 canónico antes de mandarlo — el API solo
 * acepta esa forma (`updateTenantSchema`, isE164). Número vacío es válido:
 * vaciarlo borra el teléfono. Si hay número: solo dígitos y espacios (los
 * espacios son formato de quien teclea, se quitan al componer), el país es
 * obligatorio, y el total dial+número respeta el máximo ITU de 15 dígitos.
 */
export const businessDetailsSchema = z
  .object({
    name: requiredString,
    legalName: requiredString,
    taxId: requiredString,
    address: requiredString,
    phoneCountry: z.string(),
    phoneNumber: z.string(),
  })
  .superRefine((values, ctx) => {
    const raw = values.phoneNumber.trim();
    if (raw === "") {
      return;
    }
    if (!/^[\d ]+$/.test(raw)) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "validation.phone" });
      return;
    }
    if (!isCountryCode(values.phoneCountry)) {
      ctx.addIssue({ code: "custom", path: ["phoneCountry"], message: "validation.required" });
      return;
    }
    const digits = raw.replaceAll(" ", "");
    const dial = COUNTRY_DIAL_CODES[values.phoneCountry];
    if (digits.length < 4 || dial.length + digits.length > 15) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "validation.phone" });
    }
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
