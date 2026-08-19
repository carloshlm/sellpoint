import { z } from "zod";

/**
 * Espejo de `create-user.dto.ts`/`update-user.dto.ts`/`create-role.dto.ts`
 * (apps/api). Mismos mensajes-como-clave-i18n que `lib/auth/schemas.ts`: los
 * componentes traducen con `t(...)`, los schemas quedan puros.
 */

const requiredString = z.string().trim().min(1, "validation.required");

const emailSchema = z
  .string()
  .trim()
  .min(1, "validation.required")
  .toLowerCase()
  .pipe(z.email("validation.email"));

/**
 * Alta: `roleIds.min(1)` — un usuario sin rol nace con `permissions: []`,
 * indistinguible del catálogo vacío (mismo criterio que `create-user.dto.ts`
 * del API).
 */
export const userFormSchema = z.object({
  email: emailSchema,
  firstName: requiredString,
  lastNamePaternal: requiredString,
  lastNameMaternal: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  locale: z.enum(["es", "en"]).optional(),
  roleIds: z.array(z.string()).min(1, "validation.rolesRequired"),
  /**
   * F3-NAV-03. Sin `.min(1)` a propósito: vacío significa "todos los
   * almacenes" (default permisivo del API), no "ninguno". Exigir al menos uno
   * prohibiría el estado más común. `.optional()` y no `.default([])`: este schema se
   * declara ESPEJO de `create-user.dto.ts`, y el alta del API no acepta este
   * campo — el alcance es otro recurso. Además el default desalinearía los
   * tipos de entrada y salida que react-hook-form exige iguales.
   */
  warehouseIds: z.array(z.string()).optional(),
});

export const roleFormSchema = z.object({
  name: requiredString,
  permissionCodes: z.array(z.string()).default([]),
});

export type UserFormValues = z.infer<typeof userFormSchema>;
export type RoleFormValues = z.infer<typeof roleFormSchema>;
