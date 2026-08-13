import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { getScope, type RequestWithScope, type UserScope } from "./request-warehouse-scope";

/**
 * Factory separada del decorator (patrón recomendado por Nest para poder
 * testear un `createParamDecorator` sin bootstrapear un `ExecutionContext`
 * real) — ver `current-user-scope.decorator.spec.ts`.
 */
export function currentUserScopeFactory(_data: unknown, ctx: ExecutionContext): UserScope {
  const request = ctx.switchToHttp().getRequest<Request & RequestWithScope>();
  return getScope(request);
}

/**
 * F1-SCOPE-04: lee `req.scope`, adjuntado por `WarehouseScopeInterceptor`
 * (F1-SCOPE-03). Igual que `@CurrentUser()`, solo tiene sentido en rutas
 * protegidas — a diferencia de `@CurrentUser()`, acá `getScope` SIEMPRE
 * devuelve un valor (fail-closed a `{ warehouseIds: [] }` en vez de
 * `undefined`) para que los handlers no necesiten null-check.
 *
 *   @CurrentUserScope() scope: UserScope
 */
export const CurrentUserScope = createParamDecorator(currentUserScopeFactory);
