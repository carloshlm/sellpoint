import { z } from "zod";

/**
 * El binario del Excel viaja en base64 dentro del JSON — mismo transporte que
 * productos y servicios. `dryRun` reporta sin escribir; `skipErrors` mete lo
 * bueno y reporta lo demás.
 */
export const importStudiesSchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  skipErrors: z.boolean().optional().default(false),
});

export type ImportStudiesDto = z.infer<typeof importStudiesSchema>;
