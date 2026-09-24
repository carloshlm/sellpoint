import { z } from "zod";

// F10-MANFIX-11: el mismo body y la misma normalización que forgot-password.
// El 202 es idéntico siempre (anti-enumeración), así que esto no protege
// nada por sí solo: mantiene el lookup consistente contra el índice
// funcional lower(email) y el contador de throttle con la misma clave.
export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type ResendVerificationDto = z.infer<typeof resendVerificationSchema>;
