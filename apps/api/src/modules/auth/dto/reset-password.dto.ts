import { z } from "zod";
import { passwordSchema } from "./register-tenant.dto";

// AUTH-REQ-09/10: mismo validador de password (NIST 12+) que el registro —
// `token` vacío/ausente cae al fallbackKey del pipe (auth.token_invalid,
// mismo criterio que verify-email.dto.ts).
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, "auth.token_invalid"),
  password: passwordSchema,
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
