import { z } from "zod";

// Importación de proveedores (Carlos, 2026-09-12): SOLO Excel — el contenido
// viaja en base64, mismo transporte que productos, servicios y almacenes.
export const importSuppliersSchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  skipErrors: z.boolean().optional().default(false),
});

export type ImportSuppliersDto = z.infer<typeof importSuppliersSchema>;
