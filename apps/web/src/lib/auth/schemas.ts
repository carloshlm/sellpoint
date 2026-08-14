import { z } from "zod";

/**
 * Los mensajes son CLAVES i18n (`validation.*`): los componentes las traducen
 * con `t(...)`. Así los schemas quedan puros (sin depender de i18next) y los
 * tests los validan sin montar React.
 */

/**
 * AUTH-REQ-01/10 (NIST SP 800-63B): mínimo 12 caracteres, SIN reglas de
 * composición. Misma política que `passwordSchema` del API
 * (register-tenant.dto.ts) — registro y reset la comparten.
 */
export const passwordSchema = z.string().min(12, "validation.passwordMin");

const requiredString = z.string().trim().min(1, "validation.required");

const emailSchema = z
  .string()
  .trim()
  .min(1, "validation.required")
  .toLowerCase()
  .pipe(z.email("validation.email"));

export const loginSchema = z.object({
  email: emailSchema,
  // En login NO se valida largo: una password vieja corta debe poder entrar
  // al backend y fallar allá con auth.invalid_credentials.
  password: z.string().min(1, "validation.required"),
});

export const registerSchema = z.object({
  tenantName: requiredString,
  firstName: requiredString,
  lastNamePaternal: requiredString,
  // Opcional: vacío se normaliza a undefined para no mandar "" al API.
  lastNameMaternal: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

/**
 * F1-WEB-AUTH-10. `currentPassword` solo se exige NO VACÍA: una password
 * vieja de 8 caracteres (creada antes de la política NIST) tiene que poder
 * viajar al backend y morir allá con `auth.invalid_credentials`. Validar su
 * largo acá dejaría a ese usuario sin forma de cambiarla.
 *
 * La confirmación es 100% de cliente (el API no la conoce): existe para que
 * un typo no te deje afuera de tu propia cuenta, ya que el cambio cierra
 * todas las otras sesiones.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "validation.required"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "validation.required"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "validation.passwordMismatch",
    path: ["confirmPassword"],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.input<typeof registerSchema>;
export type RegisterPayloadValues = z.output<typeof registerSchema>;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
