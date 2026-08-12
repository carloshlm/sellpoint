import { z } from "zod";

export const loginSchema = z.object({
  // Normalización AUTH-REQ-03: mismo trim+lowercase que register-tenant —
  // el email es único global, sin selector de tenant.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Sin regla de longitud acá a propósito: un password corto/inválido debe
  // caer en el MISMO 401 auth.invalid_credentials que uno correcto pero
  // equivocado — filtrar "muy corto" via 400 delataría info al atacante.
  password: z.string().min(1, "auth.invalid_credentials"),
});

export type LoginDto = z.infer<typeof loginSchema>;
