import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "./redis.tokens";

/**
 * f1-auth AD-8: contrato de invalidación de permisos vigentes. Extraído acá
 * (F1-RBAC-04) desde `AuthService.bumpPermEpoch` (que sigue existiendo,
 * privado, para `reset-password`/`change-password`) para que RBAC pueda
 * bumpear el epoch al cambiar los permisos de un rol (por TENANT) o al
 * suspender un usuario (por USER) sin duplicar el criterio:
 *
 * - `SET` SIN TTL — inevictable con `maxmemory-policy volatile-ttl`, a
 *   diferencia de `throttle:*` que siempre lleva TTL.
 * - Valor en unix SEGUNDOS, misma unidad que el claim `iat` del JWT.
 * - Fail-open con log WARN si Redis está inalcanzable: degradar a la
 *   ventana de 15 min del access token es preferible a deslogar a todo el
 *   tenant por un hipo de Redis.
 */
@Injectable()
export class PermEpochService {
  private readonly logger = new Logger(PermEpochService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async bumpTenantEpoch(tenantId: string, now: Date): Promise<void> {
    await this.bump(`perm-epoch:${tenantId}`, now);
  }

  async bumpUserEpoch(userId: string, now: Date): Promise<void> {
    await this.bump(`perm-epoch:${userId}`, now);
  }

  private async bump(key: string, now: Date): Promise<void> {
    try {
      await this.redis.set(key, String(Math.floor(now.getTime() / 1000)));
    } catch (error) {
      this.logger.warn(
        `Redis inalcanzable al bumpear ${key}, fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
