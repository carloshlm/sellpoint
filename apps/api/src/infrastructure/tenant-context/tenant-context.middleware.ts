import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { type RequestWithTenant, resolveTenantId } from "./request-tenant";

/**
 * F1-TENANT-01: middleware global que resuelve `req.tenantId` a partir del
 * claim `tenantId` del Bearer token (sin verificar firma, mismo patrón que
 * `LocaleResolverMiddleware` de F1-LOCALE-02) y deja evidencia en el log
 * estructurado de la variable de tenant asociada al request — el criterio
 * de verificación del tablero ("logs muestran la variable seteada por
 * request").
 *
 * Corre en TODA request ('*'), antes que los guards (los middlewares
 * siempre corren antes que los guards en el pipeline de Nest, por eso NO
 * depende de que `JwtAuthGuard` ya haya poblado `req.user`).
 *
 * Deliberadamente NO ejecuta `set_config` acá — ver el comment de
 * `resolveTenantId` en `request-tenant.ts`. La única fuente de confianza
 * para RLS sigue siendo `PrismaService.withTenantContext` /
 * `withNewTenantContext` (F1-TENANT-02, ya integrado en los services de
 * dominio), que abre el contexto DENTRO de un `$transaction` — la única
 * forma correcta según f1-auth AD-1.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  use(req: Request & RequestWithTenant, _res: Response, next: NextFunction): void {
    const tenantId = resolveTenantId(req);
    req.tenantId = tenantId;

    if (tenantId) {
      this.logger.log(
        `tenant context set: tenantId=${tenantId} method=${req.method} url=${req.originalUrl}`,
      );
    }

    next();
  }
}
