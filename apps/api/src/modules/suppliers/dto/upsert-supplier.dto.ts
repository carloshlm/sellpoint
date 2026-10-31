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

/**
 * Contactos de proveedor (Carlos, 2026-10-31). Un texto recortado donde «»
 * cuenta como «sin dato» (`null`), igual que la dirección de Sucursales
 * (`upsert-warehouse.dto.ts`). En el alta es `.optional()`; en la edición,
 * `.nullable().optional()` para poder limpiarlo.
 */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));
const textoAnulable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v));

/** «Puesto / Cargo» del contacto 1 y de cada contacto adicional. */
const PUESTO_MAX = 120;
// La dirección desglosada, con los mismos topes que Sucursales: `address` es
// la línea 1 y la región y el CP se validan en el service contra el país.
const LINEA2_MAX = 120;
const CIUDAD_MAX = 120;
const REGION_MAX = 8;
const CP_MAX = 16;

/** Tope de contactos ADICIONALES por proveedor (Carlos, 2026-10-31: «toparlo a 10»). */
export const MAX_SUPPLIER_CONTACTS = 10;

/**
 * Un contacto adicional («Contacto 2», «Contacto 3»…): el nombre es
 * obligatorio, lo demás no. El teléfono y el correo siguen la misma regla
 * que los del contacto 1. Sin `id`: la edición reemplaza el conjunto
 * completo y la posición es la del arreglo.
 */
const contactoAdicional = z.object({
  name: contacto,
  phone: telefono.nullable().optional(),
  email: correo.nullable().optional(),
  jobTitle: textoAnulable(PUESTO_MAX).optional(),
});
const contactosAdicionales = z.array(contactoAdicional).max(MAX_SUPPLIER_CONTACTS);

// F9-SUPPCAT-05: los campos propios del catálogo `suppliers`; el service los
// valida contra sus definiciones (`assertSystemCatalogAttributes`).
const atributos = z.record(z.string(), z.unknown());

export const createSupplierSchema = z.object({
  code: codigo.optional(),
  name: nombre,
  attributes: atributos.optional(),
  taxId: registroFiscal.optional(),
  contactName: contacto.optional(),
  jobTitle: textoOpcional(PUESTO_MAX).optional(),
  phone: telefono.optional(),
  email: correo.optional(),
  address: direccion.optional(),
  addressLine2: textoOpcional(LINEA2_MAX).optional(),
  city: textoOpcional(CIUDAD_MAX).optional(),
  region: textoOpcional(REGION_MAX).optional(),
  postalCode: textoOpcional(CP_MAX).optional(),
  notes: notas.optional(),
  contacts: contactosAdicionales.optional(),
});

export const updateSupplierSchema = z
  .object({
    code: codigo.optional(),
    name: nombre.optional(),
    attributes: atributos.optional(),
    taxId: registroFiscal.nullable().optional(),
    contactName: contacto.nullable().optional(),
    jobTitle: textoAnulable(PUESTO_MAX).optional(),
    phone: telefono.nullable().optional(),
    email: correo.nullable().optional(),
    address: direccion.nullable().optional(),
    addressLine2: textoAnulable(LINEA2_MAX).optional(),
    city: textoAnulable(CIUDAD_MAX).optional(),
    region: textoAnulable(REGION_MAX).optional(),
    postalCode: textoAnulable(CP_MAX).optional(),
    notes: notas.nullable().optional(),
    // Presente REEMPLAZA el conjunto completo (en el orden del arreglo);
    // `[]` o `null` lo vacían; ausente no lo toca.
    contacts: contactosAdicionales.nullable().optional(),
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

export type SupplierContactInput = z.infer<typeof contactoAdicional>;
export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
