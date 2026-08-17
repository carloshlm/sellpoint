import { z } from "zod";

/**
 * F2-IMPORT-02/03. El archivo viaja como TEXTO dentro del JSON y no como
 * multipart: para un CSV de hasta 5 MB alcanza de sobra y evita sumarle a la
 * API una dependencia de parseo de formularios por un endpoint que se usa una
 * vez cada tanto. El front lo lee con `FileReader` y lo manda tal cual.
 *
 * El `.xlsx` es binario, así que viaja en base64 dentro del mismo campo. Por
 * eso el formato es explícito y no se adivina del contenido: adivinar obligaría
 * a olfatear bytes mágicos y a fallar de forma confusa cuando alguien renombra
 * un `.csv` a `.xlsx`.
 */
export const importProductsSchema = z.object({
  content: z.string().min(1),
  /** `xlsx` implica que `content` viene en base64. */
  format: z.enum(["csv", "xlsx"]).default("csv"),
  /** Sin escribir nada: devuelve el reporte fila por fila. */
  dryRun: z.boolean().default(false),
  /** Importa las válidas aunque haya filas con error. */
  skipErrors: z.boolean().default(false),
});

export type ImportProductsDto = z.infer<typeof importProductsSchema>;
