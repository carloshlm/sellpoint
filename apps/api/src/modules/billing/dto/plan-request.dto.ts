import { z } from "zod";

/** F7-CONTACT — lo que el negocio nos escribe desde «Mi plan» para activar su plan. */
export const planRequestSchema = z.object({
  message: z.string().trim().min(10).max(1000),
});
export type PlanRequestDto = z.infer<typeof planRequestSchema>;
