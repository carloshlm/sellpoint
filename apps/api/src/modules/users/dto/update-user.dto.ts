import { z } from "zod";

// PATCH parcial: todos los campos opcionales, pero al menos uno debe venir.
// `roleIds`, cuando viene, es el set COMPLETO de roles del user (reemplazo,
// no delta) — mismo criterio que `permissionCodes` en update-role.dto.ts.
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    // F1-NAME-10: `null` BORRA, igual que en `update-me`. Sin el `.nullable()`
    // el dueño podía limpiar su propio segundo apellido pero un admin no podía
    // limpiar el de nadie — una asimetría que no defendía nada.
    secondLastName: z.string().trim().min(1).nullable().optional(),
    locale: z.enum(["es", "en"]).optional(),
    roleIds: z.array(z.uuid()).min(1).optional(),
    /** F3-HOME-01. `null` explícito lo quita. */
    defaultWarehouseId: z.uuid().nullish(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "users.invalid_body",
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
