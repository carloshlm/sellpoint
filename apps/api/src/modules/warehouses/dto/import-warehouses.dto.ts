import { z } from "zod";

// Importación de almacenes (Carlos, 2026-09-01): SOLO Excel — el contenido
// viaja en base64, mismo transporte que productos y servicios.
export const importWarehousesSchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  skipErrors: z.boolean().optional().default(false),
});

export type ImportWarehousesDto = z.infer<typeof importWarehousesSchema>;
