import { isE164, normalizeCode } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-SUPPL-02 — los cuerpos del catálogo de proveedores. Espejo del modelo
 * `Supplier` (molde: `upsert-customer.dto.ts`).
 *
 * El teléfono es E.164 (misma regla y misma fuente que `customers`). El
 * registro fiscal NO se valida aquí: su regla depende del país del negocio,
 * que el DTO no conoce — va en el service (`SuppliersService`), como hace
 * `TenantProfileService` con el del propio negocio.
 */
// F9-SUPPCAT-03: la llave visible, en MAYÚSCULAS. Opcional en el API: si el
// alta no lo trae, el service genera `PROV-NNN` (molde del almacén).
const codigo = z.string().trim().min(1).max(64).transform(normalizeCode);
const nombre = z.string().trim().min(1).max(200);
const registroFiscal = z.string().trim().max(32);
const contacto = z.string().trim().min(1).max(120);
const telefono = z.string().trim().refine(isE164, { message: "suppliers.invalid_phone" });
const correo = z.string().trim().max(254).pipe(z.email());
const direccion = z.string().trim().max(500);
const notas = z.string().trim().max(2000);

// F9-SUPPCAT-05: los campos propios del catálogo `suppliers`; el service los
// valida contra sus definiciones (`assertSystemCatalogAttributes`).
const atributos = z.record(z.string(), z.unknown());

export const createSupplierSchema = z.object({
  code: codigo.optional(),
  name: nombre,
  attributes: atributos.optional(),
  taxId: registroFiscal.optional(),
  contactName: contacto.optional(),
  phone: telefono.optional(),
  email: correo.optional(),
  address: direccion.optional(),
  notes: notas.optional(),
});

export const updateSupplierSchema = z
  .object({
    code: codigo.optional(),
    name: nombre.optional(),
    attributes: atributos.optional(),
    taxId: registroFiscal.nullable().optional(),
    contactName: contacto.nullable().optional(),
    phone: telefono.nullable().optional(),
    email: correo.nullable().optional(),
    address: direccion.nullable().optional(),
    notes: notas.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "suppliers.empty_update" });

export const listSuppliersQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  /** Sin filtro trae activos e inactivos; el picker pide `true`. */
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  // Molde de clientes: default 20, tope 100.
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
