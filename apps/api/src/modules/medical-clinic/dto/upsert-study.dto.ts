import { z } from "zod";

/**
 * F9-CLINIC-07 — los cuerpos de los dos catálogos de estudios. Un solo DTO
 * para laboratorio y diagnóstico: hoy tienen la misma forma (código, nombre,
 * descripción, costo y precio de venta). El código se guarda en mayúsculas,
 * como el SKU.
 */
const codigo = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((v) => v.toUpperCase());
const nombre = z.string().trim().min(1).max(200);
const descripcion = z.string().trim().max(2000);
const dinero = z.coerce.number().min(0).max(999_999_999_999);

export const createStudySchema = z.object({
  code: codigo,
  name: nombre,
  description: descripcion.optional(),
  cost: dinero.optional(),
  price: dinero.optional(),
});

export const updateStudySchema = z
  .object({
    code: codigo.optional(),
    name: nombre.optional(),
    description: descripcion.nullable().optional(),
    cost: dinero.nullable().optional(),
    price: dinero.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "medical_clinic.empty_update" });

export const listStudiesQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  // Texto y no `coerce.boolean`: "false" coaccionado sería `true`.
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateStudyDto = z.infer<typeof createStudySchema>;
export type UpdateStudyDto = z.infer<typeof updateStudySchema>;
export type ListStudiesQuery = z.infer<typeof listStudiesQuerySchema>;
