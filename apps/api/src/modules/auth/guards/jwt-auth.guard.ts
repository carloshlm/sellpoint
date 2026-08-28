import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../../infrastructure/redis/redis.module";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { TokenService, TokenVerificationError } from "../services/token.service";
import { AuthUser } from "../types/auth-user";

type AuthenticatedRequest = Request & { user?: AuthUser };

/**
 * Secure by default (f1-auth AD-8): registrado como APP_GUARD global en
 * app.module.ts. `@Public()` es la única forma de saltarlo.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (isPublic) {
      // Autenticación OPCIONAL. Una ruta pública puede igual QUERER saber
      // quién entró: la vitrina de planes lee el país del negocio para
      // mostrarle su tarifa. Sin esto `@CurrentUser()` llegaba SIEMPRE
      // `undefined` en rutas públicas aunque el front mandara el Bearer —
      // y todo el mundo veía los precios en dólares (Carlos, 2026-08-29).
      //
      // Best-effort, y acá NADA lanza: un token vencido, revocado o basura
      // deja la ruta pública funcionando exactamente como pública. Esa es
      // la diferencia con el camino privado de abajo — acá el token es un
      // dato opcional, no una credencial que se exige.
      if (token) {
        await this.populateOptionalUser(request, token);
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException({ message: "auth.missing_token" });
    }

    const payload = this.verify(token);
    const maxEpoch = await this.resolveMaxEpoch(payload.tenantId, payload.sub);

    if (maxEpoch !== null && payload.iat < maxEpoch) {
      throw new UnauthorizedException({ message: "auth.token_stale" });
    }

    request.user = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      permissions: payload.permissions,
      locale: payload.locale,
    };

    return true;
  }

  /**
   * Puebla `request.user` en una ruta PÚBLICA si —y solo si— el Bearer que
   * vino es válido y vigente. Aplica las MISMAS reglas que el camino
   * privado (firma y epoch de revocación): un token repudiado no vale más
   * por entrar por una puerta pública. Lo único distinto es el final —
   * cualquier problema deja la petición anónima en vez de rechazarla.
   */
  private async populateOptionalUser(request: AuthenticatedRequest, token: string): Promise<void> {
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      const maxEpoch = await this.resolveMaxEpoch(payload.tenantId, payload.sub);
      if (maxEpoch !== null && payload.iat < maxEpoch) {
        return;
      }
      request.user = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        permissions: payload.permissions,
        locale: payload.locale,
      };
    } catch {
      // Anónimo y sin ruido: en una ruta pública, un token malo no es un
      // error del usuario — es simplemente ausencia de sesión.
    }
  }

  private verify(token: string) {
    try {
      return this.tokenService.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        throw new UnauthorizedException({ message: "auth.invalid_token" });
      }
      throw error;
    }
  }

  private async resolveMaxEpoch(tenantId: string, userId: string): Promise<number | null> {
    try {
      const [tenantEpoch, userEpoch] = await this.redis.mget(
        `perm-epoch:${tenantId}`,
        `perm-epoch:${userId}`,
      );
      const epochs = [tenantEpoch, userEpoch]
        .filter((value): value is string => value !== null)
        .map((value) => Number(value));

      return epochs.length > 0 ? Math.max(...epochs) : null;
    } catch (error) {
      // Fail-open consciente (AD-8): el peor caso es degradar a la ventana
      // de 15 min del access token; fail-closed desloguearía a todo el
      // sistema por un hipo de Redis.
      this.logger.warn(
        `Redis inalcanzable al chequear perm-epoch, fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim() || undefined;
}
