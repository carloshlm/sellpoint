import { z } from "zod";

// PATCH parcial: todos los campos opcionales, pero al menos uno debe venir.
// `roleIds`, cuando viene, es el set COMPLETO de roles del user (reemplazo,
// no delta) — mismo criterio que `permissionCodes` en update-role.dto.ts.
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastNamePaternal: z.string().trim().min(1).optional(),
    lastNameMaternal: z.string().trim().min(1).optional(),
    locale: z.enum(["es", "en"]).optional(),
    roleIds: z.array(z.uuid()).min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "users.invalid_body",
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
