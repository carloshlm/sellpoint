import { z } from "zod";

/**
 * Los exports directos (usuarios, almacenes, catálogo) no tienen filtros: son
 * «bájame la lista completa». Lo único que se elige es el formato.
 */
export const directExportQuerySchema = z
  .object({ format: z.enum(["csv", "xlsx"]).default("xlsx") })
  .strict();

export type DirectExportQueryDto = z.infer<typeof directExportQuerySchema>;
