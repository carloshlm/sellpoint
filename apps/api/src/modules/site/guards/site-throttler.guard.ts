import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Env } from "../../../config/env.schema";
import { RedisThrottlerStorage } from "../../../infrastructure/throttle/redis-throttler.storage";
import {
  SITE_THROTTLE_KEY,
  SITE_THROTTLES,
  type SiteThrottle,
  siteThrottleKey,
} from "../site-throttle";

/**
 * F11-SITE-LEAD-03 / F11-SITE-SEO-06 — el límite por IP de los dos endpoints
 * públicos del sitio.
 *
 * No extiende `ThrottlerGuard` del paquete por el mismo motivo que
 * `AuthEmailThrottlerGuard` (ver su docblock): los dos baldes de acá no son
 * «la app entera» sino dos rutas con presupuestos muy distintos, y meterlos en
 * el `ThrottlerModule` global obligaría a anotar con `@SkipThrottle` cada
 * controller FUTURO que no sea del sitio. El throttler global (300/min por IP)
 * sigue estando encima de estos dos: este guard es un piso más estrecho, no un
 * reemplazo.
 *
 * Fail-open + WARN si Redis está caído: degradar la ventana de throttle es
 * mejor que tirar un 500 en el formulario de contacto del sitio público.
 */
@Injectable()
export class SiteThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(SiteThrottlerGuard.name);

  constructor(
    private readonly storage: RedisThrottlerStorage,
    private readonly configService: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.configService.get("THROTTLE_ENABLED", { infer: true })) {
      return true;
    }

    const declarado = this.reflector.getAllAndOverride<SiteThrottle | undefined>(
      SITE_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin `@SiteThrottle(...)` se aplica el balde MÁS ESTRICTO: un endpoint
    // público sin límite es un agujero, y fallar del lado ruidoso es lo único
    // aceptable acá.
    const throttle = declarado ?? SITE_THROTTLES.lead;
    if (!declarado) {
      this.logger.warn(
        `Un handler del sitio no declara @SiteThrottle: se aplica el presupuesto de ${SITE_THROTTLES.lead.name}`,
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ttlMs = throttle.ttlSec * 1000;

    try {
      const record = await this.storage.increment(
        siteThrottleKey(throttle.name, request.ip),
        ttlMs,
        throttle.limit,
        ttlMs,
        throttle.name,
      );
      if (record.isBlocked) {
        throw new HttpException(
          { message: "site.too_many_requests" },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn(
        `Redis inalcanzable al chequear el throttle ${throttle.name}, fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return true;
  }
}
