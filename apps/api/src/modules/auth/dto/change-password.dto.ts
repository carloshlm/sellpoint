import { z } from "zod";

/**
 * W1 de f1-auth (AUTH-REQ-10) — cambio de password autenticado.
 *
 * OJO: acá NO se usa `passwordSchema` para `newPassword`, y es a propósito.
 * El pipe corre ANTES del handler, así que validar la política acá invertiría
 * la secuencia obligatoria del servicio: primero se verifica la password
 * ACTUAL (401) y recién después la política de la nueva (400). Si el pipe
 * rechazara primero, un atacante con un access token robado distinguiría
 * "password vieja incorrecta" de "password nueva débil" y sus intentos
 * fallidos no quedarían auditados.
 *
 * `AuthService.changePassword` aplica el MISMO `passwordSchema` que register y
 * reset — la política sigue viviendo en un solo lugar, solo se mueve el
 * momento en que se evalúa.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
