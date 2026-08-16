import { z } from "zod";

/**
 * F2-BOM-01. La composición se reemplaza COMPLETA, no por delta: la UI edita
 * una tabla y guarda lo que quedó. Un delta obligaría al front a llevar la
 * cuenta de qué borró, que es donde se cuelan los bugs.
 *
 * `quantity` es cuánto lleva UNA unidad del compuesto, en la unidad base del
 * COMPONENTE.
 */
export const replaceCompositionSchema = z.object({
  lines: z
    .array(
      z.object({
        componentId: z.string().uuid(),
        quantity: z.number().positive(),
        wastePercentage: z.number().min(0).max(100).default(0),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .max(200),
});

export type ReplaceCompositionDto = z.infer<typeof replaceCompositionSchema>;
