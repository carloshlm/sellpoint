import { z } from "zod";

// PATCH parcial: renombrar y/o archivar. `isActive: false` es el "borrado"
// del motor — archivar, no eliminar: los registros y los lookups que apuntan
// a ellos siguen existiendo (misma filosofía que `isArchived` de los campos).
export const updateCatalogSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: "catalogs.empty_update",
  });

export type UpdateCatalogDto = z.infer<typeof updateCatalogSchema>;
