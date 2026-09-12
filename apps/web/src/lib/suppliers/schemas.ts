import { isTaxId } from "@sellpoint/shared";
import { z } from "zod";
import { composePhone } from "@/lib/reception/schemas";

/**
 * F9-SUPPL-06 — lo que valida el formulario de proveedor ANTES de llamar al
 * API, espejo del DTO del server. El registro fiscal se valida con el PAÍS
 * del negocio (`isTaxId`: sin país o vacío, todo vale), igual que hace el
 * service; los mensajes son claves i18n del namespace `suppliers`.
 */
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
    email: z
      .string()
      .trim()
      .refine((valor) => valor === "" || z.email().safeParse(valor).success, {
        message: "suppliers.form.errors.email",
      }),
    address: z.string().trim().max(500),
    notes: z.string().trim().max(2000),
  });
}

export type SupplierFormValues = z.infer<ReturnType<typeof supplierFormSchema>>;

/** El teléfono canónico (misma regla que clientes), con la clave de error de este namespace. */
export function composeSupplierPhone(
  country: string,
  number: string,
): { phone: string | null; error: string | null } {
  const resultado = composePhone(country, number);
  return { phone: resultado.phone, error: resultado.error && "suppliers.form.errors.phone" };
}
