import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type Logger,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import { HASHER, type HashPort } from "../../infrastructure/crypto/hash.port";
import { REDIS_CLIENT } from "../../infrastructure/redis/redis.tokens";
import type { AuthUser } from "../auth/types/auth-user";

/** F4-DISC: intentos fallidos del código antes del candado, y cuánto dura. */
export const AUTHORIZATION_CODE_MAX_ATTEMPTS = 5;
export const AUTHORIZATION_CODE_LOCK_SECONDS = 15 * 60;

/**
 * La llave de Redis con los intentos fallidos de una persona. Se llama
 * «discount» porque nació con el descuento (F4-DISC); desde F10-CASHMOV-02 la
 * usan también los retiros de efectivo, y NO se renombra: es UNA sola cuenta
 * por persona, sea cual sea la pantalla donde se equivocó.
 */
export function authorizationAttemptsKey(tenantId: string, userId: string): string {
  return `pos:discount-attempts:${tenantId}:${userId}`;
}

/**
 * El código de autorización del negocio (`Tenant.discountCodeHash`), verificado
 * en UN solo lugar. Lo piden el descuento del ticket (F4-DISC) y, desde
 * F10-CASHMOV-02, el retiro de efectivo y la anulación de una entrada.
 *
 * Es una credencial y se defiende como tal: cinco intentos fallidos seguidos
 * bloquean a la persona quince minutos (429), un código equivocado es 403 y
 * se cuenta, y el acierto borra la cuenta. La cuenta es la MISMA para todo lo
 * que pide el código: equivocarse en un retiro también acerca el candado del
 * descuento, y al revés. Si no, cinco intentos por pantalla serían diez.
 *
 * Quien llama pasa su `logger`: el aviso del código equivocado sale con el
 * contexto de quien lo pidió, igual que antes de mover esto aquí.
 */
@Injectable()
export class AuthorizationCodeService {
  constructor(
    @Inject(HASHER) private readonly hasher: HashPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Verifica `code` contra `codeHash`. No devuelve nada: si no pasa, lanza.
   * Quien llama ya comprobó que el negocio TIENE código (cada uno responde
   * distinto cuando no lo tiene).
   */
  async verify(user: AuthUser, codeHash: string, code: string, logger: Logger): Promise<void> {
    const llave = authorizationAttemptsKey(user.tenantId, user.userId);
    const intentos = Number((await this.redis.get(llave)) ?? 0);
    if (intentos >= AUTHORIZATION_CODE_MAX_ATTEMPTS) {
      throw new HttpException(
        { message: "pos.discount_code_locked" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const valido = await this.hasher.verify(codeHash, code);
    if (!valido) {
      await this.redis.incr(llave);
      await this.redis.expire(llave, AUTHORIZATION_CODE_LOCK_SECONDS);
      logger.warn({ tenantId: user.tenantId, userId: user.userId }, "pos.discount_code_invalid");
      throw new ForbiddenException({ message: "pos.discount_code_invalid" });
    }
    await this.redis.del(llave);
  }
}
