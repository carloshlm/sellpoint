import { z } from "zod";

// Importación de registros de un SUBCATÁLOGO (Carlos, 2026-09-01): SOLO
// Excel — el contenido viaja en base64, mismo transporte que el resto.
export const importRecordsSchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  skipErrors: z.boolean().optional().default(false),
});

export type ImportRecordsDto = z.infer<typeof importRecordsSchema>;
