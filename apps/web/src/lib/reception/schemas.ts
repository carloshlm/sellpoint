import { COUNTRY_DIAL_CODES, type CountryCode, isE164 } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-RECEP-12 — lo que valida el formulario de cliente ANTES de llamar al
 * API, espejo del DTO del server. Los mensajes son claves i18n del namespace
 * `reception`; el server sigue validando lo mismo (esto solo ahorra el viaje).
 */
export const customerFormSchema = z.object({
  firstName: z.string().trim().min(1, "reception.form.errors.required").max(120),
  lastNamePaternal: z.string().trim().min(1, "reception.form.errors.required").max(120),
  lastNameMaternal: z.string().trim().max(120),
  birthDate: z
    .string()
    .trim()
    .refine(
      (valor) =>
        valor === "" ||
        (/^\d{4}-\d{2}-\d{2}$/.test(valor) &&
          !Number.isNaN(Date.parse(valor)) &&
          valor <= new Date().toISOString().slice(0, 10)),
      { message: "reception.form.errors.birthDate" },
    ),
  email: z
    .string()
    .trim()
    .refine((valor) => valor === "" || z.email().safeParse(valor).success, {
      message: "reception.form.errors.email",
    }),
  notes: z.string().trim().max(2000),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

/**
 * El teléfono canónico: dial del país + dígitos sin espacios. Vacío = sin
 * teléfono. Si no arma un E.164 válido, la clave del error.
 */
export function composePhone(
  country: string,
  number: string,
): { phone: string | null; error: string | null } {
  const digits = number.replaceAll(" ", "").trim();
  if (digits === "") {
    return { phone: null, error: null };
  }
  const dial = COUNTRY_DIAL_CODES[country as CountryCode];
  const phone = dial ? `+${dial}${digits}` : `+${digits}`;
  return isE164(phone)
    ? { phone, error: null }
    : { phone: null, error: "reception.form.errors.phone" };
}
