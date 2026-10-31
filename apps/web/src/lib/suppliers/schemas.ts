import { isTaxId } from "@sellpoint/shared";
import { z } from "zod";
import { composePhone } from "@/lib/reception/schemas";

/**
 * F9-SUPPL-06 — lo que valida el formulario de proveedor ANTES de llamar al
 * API, espejo del DTO del server. El registro fiscal se valida con el PAÍS
 * del negocio (`isTaxId`: sin país o vacío, todo vale), igual que hace el
 * service; los mensajes son claves i18n del namespace `suppliers`.
 */
/** Vacío o un correo válido: la misma regla para el contacto 1 y los adicionales. */
const optionalEmail = z
  .string()
  .trim()
  .refine((valor) => valor === "" || z.email().safeParse(valor).success, {
    message: "suppliers.form.errors.email",
  });

/** El tope de contactos adicionales (Contacto 2 a 11), espejo del DTO del API. */
export const SUPPLIER_EXTRA_CONTACTS_MAX = 10;

export function supplierFormSchema(country: string | null) {
  return z.object({
    // F9-SUPPCAT-04: vacío = el API lo genera (PROV-NNN); el input ya lo sube a mayúsculas.
    code: z.string().trim().max(64).default(""),
    name: z.string().trim().min(1, "suppliers.form.errors.required").max(200),
    taxId: z
      .string()
      .trim()
      .max(32)
      .refine((valor) => isTaxId(country, valor), { message: "suppliers.form.errors.taxId" }),
    contactName: z.string().trim().max(120),
    jobTitle: z.string().trim().max(120),
    email: optionalEmail,
    // «Calle y número»: el resto de la dirección lo capturan los campos del país.
    address: z.string().trim().max(500),
    notes: z.string().trim().max(2000),
  });
}

export type SupplierFormValues = z.infer<ReturnType<typeof supplierFormSchema>>;

/**
 * Un contacto adicional (Contacto 2, 3…) que trae algún dato: el nombre es
 * obligatorio y el correo sigue la regla del contacto 1. El teléfono se
 * compone aparte, con `composeSupplierPhone`.
 */
export const supplierContactSchema = z.object({
  name: z.string().trim().min(1, "suppliers.form.errors.contactName").max(120),
  email: optionalEmail,
  jobTitle: z.string().trim().max(120),
});

/** El teléfono canónico (misma regla que clientes), con la clave de error de este namespace. */
export function composeSupplierPhone(
  country: string,
  number: string,
): { phone: string | null; error: string | null } {
  const resultado = composePhone(country, number);
  return { phone: resultado.phone, error: resultado.error && "suppliers.form.errors.phone" };
}
