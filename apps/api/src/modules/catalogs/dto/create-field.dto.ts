import { z } from "zod";

// Los tres tipos del motor (F2-CAT-03). Espejo del enum `catalog_field_type`
// de la DB — el zod valida en el borde, el enum en la última línea.
export const FIELD_TYPES = ["text", "number", "lookup"] as const;

// La `key` NO es parte del DTO: la deriva el server desde el label
// (`deriveFieldKey`). Dejarla escribir al cliente permitiría dos campos con la
// misma etiqueta y keys distintas, o keys que colisionan con los campos
// estándar.
export const createFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    fieldType: z.enum(FIELD_TYPES),
    lookupCatalogId: z.string().uuid().optional(),
    required: z.boolean().default(false),
  })
  .refine((value) => (value.fieldType === "lookup") === (value.lookupCatalogId !== undefined), {
    message: "catalogs.lookup_target_mismatch",
    path: ["lookupCatalogId"],
  });

export type CreateFieldDto = z.infer<typeof createFieldSchema>;
