import { z } from "zod";

/**
 * PATCH parcial de un campo.
 *
 * `fieldType` se puede cambiar SOLO mientras el campo no tenga datos — con
 * datos el service devuelve 409 (decisión de Carlos, 2026-08-16: guardas en
 * vez de versionado). Convertir "texto" a "numérico" con valores cargados
 * dejaría registros que ya no cumplen su propio schema y no hay respuesta
 * automática correcta para "¿qué hago con 'aproximadamente 3'?".
 *
 * `isArchived: false` es el camino de RESTAURAR un campo archivado — sus
 * valores nunca se borraron, así que vuelve con todo.
 *
 * `key` no está y no va a estar: es el identificador estable de los datos.
 */
export const updateFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    fieldType: z.enum(["text", "number", "lookup"]).optional(),
    lookupCatalogId: z.string().uuid().nullable().optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "catalogs.empty_update" });

export type UpdateFieldDto = z.infer<typeof updateFieldSchema>;
