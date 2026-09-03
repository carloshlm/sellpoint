import { z } from "zod";

/** F9-CLINIC-13 — lo que el médico teclea para buscar un medicamento. */
export const stockSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type StockSearchQuery = z.infer<typeof stockSearchQuerySchema>;
