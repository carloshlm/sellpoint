import { z } from "zod";

// AUTH-REQ-01/AUTH-REQ-10: 12+ caracteres, SIN reglas de composición (NIST
// SP 800-63B, confirmado por Carlos) — nada de mayúscula+número+símbolo.
// Exportado: reset-password.dto.ts (U5) reusa el MISMO validador — AUTH-REQ-10
// exige la misma política en registro, reset y cambio de password.
export const passwordSchema = z.string().min(12, "auth.weak_password");

export const registerTenantSchema = z.object({
  // OPCIONAL desde 2026-08-25 (Carlos): la pantalla de registro ya no lo
  // pide — el negocio se nombra en el paso 1 del wizard (Nombre legal). Sin
  // él, el tenant nace con un nombre provisional por locale (ver provision).
  tenantName: z.string().trim().min(1).optional(),
  // CHECK (currency IN ('MXN','USD')) vive en la DB — acá solo se limita a
  // los dos valores soportados hoy.
  currency: z.enum(["MXN", "USD"]).optional(),
  // Normalización AUTH-REQ-01: trim + lowercase en el DTO, la DB además
  // tiene el índice funcional sobre lower(email) como red de seguridad.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: passwordSchema,
  firstName: z.string().trim().min(1),
  lastNamePaternal: z.string().trim().min(1),
  lastNameMaternal: z.string().trim().min(1).optional(),
  locale: z.enum(["es", "en"]).optional(),
});

export type RegisterTenantDto = z.infer<typeof registerTenantSchema>;
