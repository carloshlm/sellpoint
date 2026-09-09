import { z } from "zod";

/** F9-CLINIC-HC-22 — lo que el médico teclea para buscar un diagnóstico: código o texto. */
export const icd10QuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type Icd10Query = z.infer<typeof icd10QuerySchema>;
