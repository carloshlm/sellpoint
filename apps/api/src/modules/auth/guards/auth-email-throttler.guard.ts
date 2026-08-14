import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { Env } from "../../../config/env.schema";
import { RedisThrottlerStorage } from "../../../infrastructure/throttle/redis-throttler.storage";

// AUTH-REQ-12 / design AD-7: "10/hora por email" solo aplica en las rutas
// donde un email puede usarse para hostigar a un tercero (adivinar password
// ajena, o inundarlo de mails de reset). `register-tenant` también recibe
// email en el body, pero se deja AFUERA a propósito: esa ruta ya tiene su
// propia mitigación (409 + auth-ip, R4 del design) y no dispara ningún mail
// "de otro" ni intenta autenticar.
const EMAIL_TRACKED_HANDLERS = new Set(["login", "forgotPassword"]);

/**
 * F1-WEB-AUTH-10: excepciones al throttle de IP de AD-7. Ese límite (5 cada
 * 15 min por IP) existe para frenar el adivinado de credenciales SIN
 * autenticar. `GET /auth/sessions` es una LECTURA que ya exige un JWT válido
 * y que la página de perfil dispara en cada visita: dejarla adentro haría que
 * tres visitas dejaran al usuario —y a toda su oficina detrás del mismo NAT—
 * sin poder ni siquiera loguearse. Un self-DoS, no una protección.
 *
 * `change-password` NO está acá a propósito: verifica la password actual, así
 * que ES superficie de adivinado y consume el mismo presupuesto que login.
 *
 * El acoplamiento por nombre de handler falla SEGURO (renombrar el método
 * pierde la exención y vuelve a throttlear, que es ruidoso pero no un hueco),
 * al revés que `EMAIL_TRACKED_HANDLERS`.
 *
 * `refresh` se sumó tras un self-DoS REAL en producción (2026-08-14): el
 * bootstrap de sesión del front dispara `POST /auth/refresh` en CADA carga de
 * página, así que **cinco navegaciones en 15 minutos dejaban a la IP sin
 * poder loguearse ni verificar su email** — le pasó a Carlos justo al validar
 * su cuenta. No es superficie de adivinado: autentica con una cookie httpOnly
 * cuyo token es aleatorio de 256 bits, y el reuso ya revoca la familia
 * entera (AD-6). Sigue cubierto por el throttler global (100/60s por IP), que
 * es el que corresponde para volumen, no el presupuesto de credenciales.
 */
const IP_THROTTLE_EXEMPT_HANDLERS = new Set(["listSessions", "refresh"]);

/**
 * f1-auth AD-7 / U6-02: throttling de `/auth/*` — combina DOS dimensiones
 * independientes (IP siempre, email normalizado solo en login/forgot-password)
 * en un único guard para poder responder el MISMO 429 `auth.too_many_attempts`
 * sin filtrar cuál de las dos saltó (AUTH-REQ-12 no exige distinguir, y
 * hacerlo regalaría información a quien está probando credenciales).
 *
 * No extiende `ThrottlerGuard` del paquete `@nestjs/throttler`: sus dos
 * throttlers no comparten tracker ni scope de ruta (uno es IP en TODO
 * `/auth/*`, el otro es email SOLO en dos rutas) y el mecanismo de
 * `@SkipThrottle` por controller obligaría a anotar cada controller FUTURO
 * no-auth para excluirlo — un guard local aplicado solo en `AuthController`
 * es más simple y seguro-por-default (design D2: "el guard son ~30 líneas y
 * las leemos todas").
 *
 * Fail-open + WARN si Redis está caído: mismo precedente que
 * `JwtAuthGuard.resolveMaxEpoch` — degradar la ventana de throttle es mejor
 * que tirar 500 en /auth/login por un hipo de Redis.
 */
@Injectable()
export class AuthEmailThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(AuthEmailThrottlerGuard.name);

  constructor(
    private readonly storage: RedisThrottlerStorage,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.configService.get("THROTTLE_ENABLED", { infer: true })) {
      return true;
    }

    const handlerName = context.getHandler().name;

    if (IP_THROTTLE_EXEMPT_HANDLERS.has(handlerName)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const ipBlocked = await this.checkLimit({
      key: `throttle:auth-ip:${request.ip}`,
      limit: this.configService.get("THROTTLE_AUTH_IP_LIMIT", { infer: true }),
      ttlSec: this.configService.get("THROTTLE_AUTH_IP_TTL_SEC", { infer: true }),
      throttlerName: "auth-ip",
    });

    if (ipBlocked) {
      throw this.tooManyAttempts();
    }

    const email = normalizeEmail((request.body as { email?: unknown } | undefined)?.email);

    // "Si el body no trae email → no aplica (delega al de IP)" (design AD-7).
    if (EMAIL_TRACKED_HANDLERS.has(handlerName) && email) {
      const emailBlocked = await this.checkLimit({
        key: `throttle:auth-email:${email}`,
        limit: this.configService.get("THROTTLE_AUTH_EMAIL_LIMIT", { infer: true }),
        ttlSec: this.configService.get("THROTTLE_AUTH_EMAIL_TTL_SEC", { infer: true }),
        throttlerName: "auth-email",
      });

      if (emailBlocked) {
        throw this.tooManyAttempts();
      }
    }

    return true;
  }

  private async checkLimit(params: {
    key: string;
    limit: number;
    ttlSec: number;
    throttlerName: string;
  }): Promise<boolean> {
    const ttlMs = params.ttlSec * 1000;

    try {
      const record = await this.storage.increment(
        params.key,
        ttlMs,
        params.limit,
        ttlMs,
        params.throttlerName,
      );
      return record.isBlocked;
    } catch (error) {
      this.logger.warn(
        `Redis inalcanzable al chequear throttle ${params.throttlerName}, fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private tooManyAttempts(): HttpException {
    return new HttpException({ message: "auth.too_many_attempts" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}
