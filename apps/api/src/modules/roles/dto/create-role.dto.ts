import { z } from "zod";

// F1-RBAC-04: `permissionCodes` es la lista COMPLETA de codes del rol nuevo
// (no un delta) — mismo criterio que PATCH. Vacío es válido: un rol recién
// creado sin permisos no rompe nada (mismo caso que "catálogo vacío" en
// role-catalog.ts).
export const createRoleSchema = z.object({
  name: z.string().trim().min(1),
  permissionCodes: z.array(z.string().trim().min(1)).default([]),
});

export type CreateRoleDto = z.infer<typeof createRoleSchema>;
