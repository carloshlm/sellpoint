import { z } from "zod";

// F2-IMPORT de servicios (Carlos, 2026-09-01): SOLO Excel — el contenido
// viaja en base64, mismo transporte que el importador de productos.
export const importServicesSchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  skipErrors: z.boolean().optional().default(false),
});

export type ImportServicesDto = z.infer<typeof importServicesSchema>;
