export interface UserScope {
  warehouseIds: string[] | "all";
}

export interface RequestWithScope {
  scope?: UserScope;
}

/**
 * Lee `req.scope` (seteado por `WarehouseScopeInterceptor`, F1-SCOPE-03 —
 * remediación CRITICAL C2 del verify-report `sdd/f1-scope`); si no corrió
 * (ruta `@Public()`, request no autenticado, o el interceptor todavía no
 * ejecutó), degrada fail-closed a `{ warehouseIds: [] }` — NUNCA `'all'` — en
 * vez de `undefined`, así los handlers no necesitan null-check y un endpoint
 * público que use `@CurrentUserScope()` recibe CERO warehouses, no todos.
 */
export function getScope(req: { scope?: UserScope }): UserScope {
  return req.scope ?? { warehouseIds: [] };
}
