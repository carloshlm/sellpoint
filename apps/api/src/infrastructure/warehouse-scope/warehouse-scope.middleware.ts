import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TENANT_ADMIN_PERMISSION_CODES } from "../../modules/roles/tenant-admin-guard";
import { PrismaService } from "../prisma/prisma.service";
import { decodeUnverifiedScopeClaims, type RequestWithScope } from "./request-warehouse-scope";

/**
 * F1-SCOPE-03: middleware global que carga los `warehouseIds` accesibles del
 * usuario en `req.scope`, para que `@CurrentUserScope()` (F1-SCOPE-04) los
 * inyecte en el handler. Preparación para F2: hoy solo existe la tabla
 * `user_warehouse_scopes` (F1-SCOPE-01/02), sin `warehouses` real todavía.
 *
 * Criterio de bypass ("TenantAdmin ve todo", tablero F1-SCOPE-03): en vez de
 * comparar por NOMBRE de rol, reutiliza `TENANT_ADMIN_PERMISSION_CODES`
 * (`roles:manage` + `users:manage`) — la MISMA invariante que
 * `assertTenantRetainsAdmin` usa para "quién administra el tenant"
 * (f1-rbac, `tenant-admin-guard.ts`). Más robusto que el nombre de rol:
 *   1. El catálogo de permisos varía por entorno (dev/CI/prod siembran
 *      distinto — Regla operativa del proyecto: nunca asumir el TAMAÑO del
 *      catálogo). Comparar membership exacta de 2 codes conocidos es
 *      estable frente a esa variación; "tiene TODOS los permisos del
 *      catálogo" no lo sería.
 *   2. `permissions` YA viaja en el JWT (F1-AUTH) — no hace falta una query
 *      extra a `user_roles`/`roles` solo para decidir el bypass, así que los
 *      requests de un TenantAdmin ni siquiera tocan la DB acá.
 *
 * Como el resto de los middlewares de request (`TenantContextMiddleware`,
 * `LocaleResolverMiddleware`), decodifica el Bearer token SIN verificar
 * firma porque corre ANTES que los guards — ver el comentario de
 * `decodeUnverifiedScopeClaims` para por qué es seguro en este caso puntual
 * (a diferencia de tenantId/locale, que son solo observabilidad/UX).
 *
 * Sin `set_config` propio: reusa `PrismaService.withTenantContext` (AD-1),
 * la única forma permitida de abrir contexto de tenant.
 */
@Injectable()
export class WarehouseScopeMiddleware implements NestMiddleware {
  private readonly logger = new Logger(WarehouseScopeMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request & RequestWithScope, _res: Response, next: NextFunction): Promise<void> {
    const claims = decodeUnverifiedScopeClaims(req);
    if (!claims) {
      next();
      return;
    }

    const isTenantAdmin = TENANT_ADMIN_PERMISSION_CODES.every((code) =>
      claims.permissions.includes(code),
    );

    if (isTenantAdmin) {
      req.scope = { warehouseIds: "all" };
      next();
      return;
    }

    try {
      const scopes = await this.prisma.withTenantContext(claims.tenantId, (tx) =>
        tx.userWarehouseScope.findMany({
          where: { userId: claims.userId },
          select: { warehouseId: true },
        }),
      );
      req.scope = { warehouseIds: scopes.map((scope) => scope.warehouseId) };
    } catch (error) {
      // Fail-closed a propósito (a diferencia del fail-open de JwtAuthGuard
      // con Redis, AD-8): acá el peor caso de fallar cerrado es "ve 0
      // warehouses", mucho más seguro que degradar a 'all'.
      this.logger.warn(
        `no se pudo resolver warehouse scope, fail-closed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      req.scope = { warehouseIds: [] };
    }

    next();
  }
}
