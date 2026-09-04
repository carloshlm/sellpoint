import { isE164 } from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-RECEP-05 — los cuerpos del registro de clientes. Espejo del modelo
 * `Customer`.
 *
 * El teléfono es E.164 (`+525512345678`, la MISMA regla que `tenants.phone`,
 * misma fuente: `isE164` de shared). La fecha de nacimiento viaja como
 * `YYYY-MM-DD` —un día del calendario, sin hora ni zona— y nadie nace
 * mañana. `attributes` no se acepta todavía: la columna existe, el motor de
 * catálogos para ella no (deuda anotada en el modelo).
 */
const nombre = z.string().trim().min(1).max(120);
const HOY_ISO = () => new Date().toISOString().slice(0, 10);
const fechaDeNacimiento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "reception.invalid_birth_date")
  .refine((valor) => !Number.isNaN(Date.parse(valor)) && valor <= HOY_ISO(), {
    message: "reception.invalid_birth_date",
  });
const telefono = z.string().trim().refine(isE164, { message: "reception.invalid_phone" });
const correo = z.string().trim().max(254).pipe(z.email());
const notas = z.string().trim().max(2000);

export const createCustomerSchema = z.object({
  firstName: nombre,
  lastNamePaternal: nombre,
  lastNameMaternal: nombre.optional(),
  birthDate: fechaDeNacimiento.optional(),
  phone: telefono.optional(),
  email: correo.optional(),
  notes: notas.optional(),
});

export const updateCustomerSchema = z
  .object({
    firstName: nombre.optional(),
    lastNamePaternal: nombre.optional(),
    lastNameMaternal: nombre.nullable().optional(),
    birthDate: fechaDeNacimiento.nullable().optional(),
    phone: telefono.nullable().optional(),
    email: correo.nullable().optional(),
    notes: notas.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "reception.empty_update" });

export const listCustomersQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    /** `YYYY-MM-DD` de ALTA, en el calendario del negocio (F9-RECEP-20). */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    // Molde de productos y servicios: default 20, tope 100.
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "reception.invalid_query",
    path: ["to"],
  });

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
