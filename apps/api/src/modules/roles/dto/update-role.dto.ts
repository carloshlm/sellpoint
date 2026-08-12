import { z } from "zod";

// PATCH parcial: `name` y `permissionCodes` son independientes, pero al
// menos uno tiene que venir (si no, no hay nada que actualizar). Cuando
// `permissionCodes` viene, es la lista COMPLETA (reemplazo, no delta) — el
// caller (frontend) manda el editor de roles entero.
export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    permissionCodes: z.array(z.string().trim().min(1)).optional(),
  })
  .refine((data) => data.name !== undefined || data.permissionCodes !== undefined, {
    message: "roles.invalid_body",
  });

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
