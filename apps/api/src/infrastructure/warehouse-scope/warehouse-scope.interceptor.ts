import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import type { AuthUser } from "../../modules/auth/types/auth-user";
import { TENANT_ADMIN_PERMISSION_CODES } from "../../modules/roles/tenant-admin-guard";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestWithScope } from "./request-warehouse-scope";

type ScopedRequest = Request & RequestWithScope & { user?: AuthUser };

/**
 * F1-SCOPE-03 (remediación CRITICAL C1/C2, verify-report `sdd/f1-scope`):
 * carga los `warehouseIds` accesibles del usuario en `req.scope`, para que
 * `@CurrentUserScope()` (F1-SCOPE-04) los inyecte en el handler.
 *
 * REEMPLAZA a `WarehouseScopeMiddleware`. NO volver a un middleware para
 * esto: el pipeline de Nest ejecuta middleware -> guards -> interceptores ->
 * pipes -> handler. Un middleware corre ANTES que `JwtAuthGuard` y ANTES que
 * `ThrottlerGuard`, así que solo puede leer el JWT SIN verificar firma (el
 * guard todavía no corrió). Eso permitía:
 *   - a un anónimo con un token de firma inválida y un `tenantId` ajeno
 *     abrir contexto RLS (`withTenantContext`) de un tenant arbitrario
 *     incluso contra rutas `@Public()` (lectura cross-tenant ejecutada, solo
 *     no expuesta porque nadie leía `req.scope` todavía);
 *   - a cualquier request (incluso un 404) forzar una transacción Postgres
 *     completa ANTES de que `ThrottlerGuard` pudiera rechazarla — rompía
 *     AD-7 (f1-auth): "el throttle tiene que pegar ANTES de gastar ciclos".
 *
 * Un interceptor corre DESPUÉS de los guards, así que lee `req.user`
 * (poblado por `JwtAuthGuard` con la firma RS256 y el epoch de permisos YA
 * verificados) en vez de decodificar el token crudo:
 *   - en una ruta `@Public()`, `JwtAuthGuard` retorna `true` sin tocar el
 *     token, así que `req.user` es SIEMPRE `undefined` acá -> no se calcula
 *     scope, no se toca la DB, `getScope()` degrada fail-closed a `[]`;
 *   - en una ruta protegida, si el token no verifica, `JwtAuthGuard` ya
 *     lanzó 401 antes de que este interceptor exista;
 *   - el bypass de TenantAdmin (`TENANT_ADMIN_PERMISSION_CODES`) se evalúa
 *     solo sobre `permissions` ya verificados;
 *   - el trabajo de DB queda después del throttler -> restaura AD-7.
 *
 * ⚠️ INVARIANTE DE LA QUE DEPENDE TODO LO ANTERIOR (S6 del verify #296):
 * **`JwtAuthGuard` es el ÚNICO escritor de `request.user` en toda la app.**
 * Comprobable: `rg "\.user\s*=" apps/api/src` devuelve UNA coincidencia.
 * Si alguien la rompe (middleware/interceptor/guard que popule `req.user`
 * con datos no verificados), este interceptor vuelve a decidir sobre claims
 * forjados y revive el vector cross-tenant que motivó el cambio. Cualquier
 * escritura nueva a `request.user` exige revisar este archivo.
 *
 * Criterio de bypass ("TenantAdmin ve todo"): reutiliza
 * `TENANT_ADMIN_PERMISSION_CODES` (`roles:manage` + `users:manage`) — la
 * MISMA invariante que `assertTenantRetainsAdmin` usa para "quién administra
 * el tenant" (f1-rbac, `tenant-admin-guard.ts`). Más robusto que el nombre
 * de rol porque el catálogo de permisos varía por entorno (dev/CI/prod
 * siembran distinto). `permissions` ya viaja verificado en `req.user` — el
 * bypass no toca la DB.
 *
 * Sin `set_config` propio: reusa `PrismaService.withTenantContext` (AD-1),
 * la única forma permitida de abrir contexto de tenant.
 */
@Injectable()
export class WarehouseScopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WarehouseScopeInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<ScopedRequest>();
    const user = req.user;

    if (!user) {
      return next.handle();
    }

    const isTenantAdmin = TENANT_ADMIN_PERMISSION_CODES.every((code) =>
      user.permissions.includes(code),
    );

    if (isTenantAdmin) {
      req.scope = { warehouseIds: "all" };
      return next.handle();
    }

    try {
      const scopes = await this.prisma.withTenantContext(user.tenantId, (tx) =>
        tx.userWarehouseScope.findMany({
          where: { userId: user.userId },
          select: { warehouseId: true },
        }),
      );
      // F2-SCOPE-01 — DEFAULT PERMISIVO cuando el usuario no tiene ninguna
      // fila asignada (ARQUITECTURA § 3.4: "otro rol sin scope asignado → ve
      // todos los almacenes").
      //
      // Durante toda la Fase 1 esto degradaba a `[]`, y estaba bien: la tabla
      // `warehouses` no existía, así que "sin filas" y "sin almacenes" eran lo
      // mismo. Ahora que existen, `[]` significaría que un tenant chico —un
      // solo almacén, nadie con scope asignado— no vería NADA de su propio
      // inventario. La restricción es opt-in: se limita a quien se le asigna
      // un alcance explícito.
      //
      // Ojo con la diferencia: esto es "sin filas" (nadie lo limitó). El
      // fail-closed del catch de abajo sigue siendo `[]` — ahí sí falló algo y
      // no se sabe qué puede ver.
      req.scope =
        scopes.length === 0
          ? { warehouseIds: "all" }
          : { warehouseIds: scopes.map((scope) => scope.warehouseId) };
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

    return next.handle();
  }
}
