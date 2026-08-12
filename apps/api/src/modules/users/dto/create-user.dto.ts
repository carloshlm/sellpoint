import { z } from "zod";

// F1-RBAC-03: usuario nace `invited` (mismo estado que el owner en
// register-tenant) — sin password, no puede loguear todavía. El flujo de
// aceptación de invitación (setear password) queda fuera de este batch,
// ver apply-progress. `roleIds` exige al menos un rol: un usuario sin
// ningún rol nace con `permissions: []`, indistinguible del catálogo vacío
// (gate W3 de f1-auth) — mejor no permitir ese estado desde el alta.
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  firstName: z.string().trim().min(1),
  lastNamePaternal: z.string().trim().min(1),
  lastNameMaternal: z.string().trim().min(1).optional(),
  locale: z.enum(["es", "en"]).optional(),
  roleIds: z.array(z.uuid()).min(1),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
