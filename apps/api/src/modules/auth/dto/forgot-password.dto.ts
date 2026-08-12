import { z } from "zod";

// AUTH-REQ-08: la misma normalización de email que login/register-tenant —
// el body a prueba de enumeración no depende de esto (el 202 es idéntico
// siempre), pero mantiene el lookup consistente contra el índice
// funcional lower(email).
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
