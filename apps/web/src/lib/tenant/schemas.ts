import {
  type AddressField,
  COUNTRY_DIAL_CODES,
  isCountryCode,
  isPostalCode,
  isTaxId,
  resolveAddressFormat,
  SUPPORTED_CURRENCIES,
} from "@sellpoint/shared";
import { z } from "zod";

import { moneyInputError } from "@/lib/money";

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
export const businessStepSchema = z
  .object({
    country: requiredString,
    // F4-TAX-18: la provincia o el estado. Obligatoria SOLO donde la tasa
    // depende de ella (CA/US, `needsRegion`); para el resto viaja vacía y el
    // container la manda en null.
    region: z.string(),
    legalName: requiredString,
    taxId: requiredString,
    address: requiredString,
    // F1-ADDR-05: la dirección estructurada. Qué es obligatorio lo dice el
    // PAÍS (`required` del formato: México, Canadá y Estados Unidos piden
    // ciudad, región y código postal; un país sin formato solo la calle), y
    // el código postal se valida contra su regla. Acá viajan como texto —
    // vacío es «sin dato»— y el container manda `null` por lo vacío.
    addressLine2: z.string(),
    city: z.string(),
    postalCode: z.string(),
    timezone: requiredString,
    currency: z.enum(SUPPORTED_CURRENCIES),
  })
  .superRefine((values, ctx) => {
    const format = resolveAddressFormat(values.country);
    for (const field of format.required) {
      const path = ADDRESS_FORM_FIELD[field];
      if (values[path].trim() === "") {
        ctx.addIssue({ code: "custom", path: [path], message: "validation.required" });
      }
    }
    if (values.postalCode.trim() !== "" && !isPostalCode(values.country, values.postalCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "common.address.postalCodeInvalid",
      });
    }
    // F1-TAXID-03: el registro fiscal contra la regla de su país (la misma
    // función que el servidor); el componente traduce con el ejemplo.
    if (values.taxId.trim() !== "" && !isTaxId(values.country || null, values.taxId)) {
      ctx.addIssue({ code: "custom", path: ["taxId"], message: "validation.taxIdInvalid" });
    }
  });

/** El campo del formulario que guarda cada parte de la dirección (`line1` vive en `address`). */
export const ADDRESS_FORM_FIELD: Record<
  AddressField,
  "address" | "addressLine2" | "city" | "region" | "postalCode"
> = {
  line1: "address",
  line2: "addressLine2",
  city: "city",
  region: "region",
  postalCode: "postalCode",
};

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
    // F1-TAXID (2026-09-10): OPCIONAL —un negocio que no lo tiene o no lo sabe
    // guarda lo demás; vacío BORRA, como el teléfono y la meta—. El formato NO
    // se valida acá: la regla corre en el submit, donde se sabe si el campo
    // CAMBIÓ (`dirtyFields`), que es exactamente cuando el valor viaja. Dos
    // condiciones distintas para validar y para mandar podían divergir, y ahí
    // el que avisaba era el servidor, con un mensaje sin ejemplo.
    taxId: z.string(),
    address: requiredString,
    // F1-ADDR-06: la dirección estructurada, OPCIONAL acá — un negocio que ya
    // existe no se traba por lo que no capturó; solo el wizard obliga. El
    // país viaja en el form SOLO para validar el CP (no se edita ni se manda).
    country: z.string(),
    addressLine2: z.string(),
    city: z.string(),
    region: z.string(),
    postalCode: z.string(),
    // Zona horaria editable (Carlos, 2026-08-26): los negocios se mudan
    // dentro de su país. El PAÍS no está a propósito — quedó fijo el mismo
    // día que nació editable: los impuestos por país del roadmap dependerán
    // de él (mismo criterio que congeló la moneda).
    timezone: requiredString,
    phoneCountry: z.string(),
    phoneNumber: z.string(),
    // F5-DASH-02: la meta mensual como TEXTO de formulario — vacío es válido
    // (borra la meta). Va a la MISMA columna `DECIMAL(14,2)` que el costo y el
    // precio, así que desde 2026-09-08 usa su misma aritmética
    // (`moneyInputError`): la coma se RECHAZA con un mensaje que enseña el
    // formato en vez de interpretarse —«25,000» es veinticinco mil para un
    // mexicano y veinticinco para un español— y los tres decimales se marcan.
    // Lo único propio es que cero no es una meta: para no perseguir ninguna,
    // el campo se deja vacío.
    monthlySalesGoal: z.string(),
  })
  .superRefine((values, ctx) => {
    if (
      values.postalCode.trim() !== "" &&
      !isPostalCode(values.country || null, values.postalCode)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "common.address.postalCodeInvalid",
      });
    }
    const metaError = moneyInputError(values.monthlySalesGoal);
    if (metaError !== null) {
      ctx.addIssue({ code: "custom", path: ["monthlySalesGoal"], message: metaError });
    } else if (values.monthlySalesGoal.trim() !== "" && Number(values.monthlySalesGoal) <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["monthlySalesGoal"],
        message: "validation.moneyPositive",
      });
    }
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

// El paso de invitar al equipo se quitó del wizard (Carlos, 2026-08-25) y
// sus schemas se fueron con él: el alta de usuarios vive en Sistema →
// Usuarios con su propio `userFormSchema` (lib/rbac/schemas.ts).
