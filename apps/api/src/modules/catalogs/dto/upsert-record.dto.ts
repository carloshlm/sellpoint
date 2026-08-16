import { z } from "zod";

// `code` es el campo estándar "Código (Nombre Corto)" que define el cliente
// (`kg`, `lt`): único dentro del catálogo y llave visible de los lookups.
// `attributes` llega sin tipar acá a propósito — su forma la dicta
// `catalog_fields`, y la valida `validateRecordAttributes` (F2-CAT-04), no zod.
export const createRecordSchema = z.object({
  code: z.string().trim().min(1).max(64),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const updateRecordSchema = z
  .object({
    code: z.string().trim().min(1).max(64).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "catalogs.empty_update" });

export type CreateRecordDto = z.infer<typeof createRecordSchema>;
export type UpdateRecordDto = z.infer<typeof updateRecordSchema>;
