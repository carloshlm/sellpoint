import { Inject, Injectable } from "@nestjs/common";
import type { ThrottlerStorage, ThrottlerStorageRecord } from "@nestjs/throttler";
import { Redis } from "ioredis";
import { REDIS_CLIENT } from "../redis/redis.module";

// f1-auth AD-7: atómico en un único roundtrip — INCR + PEXPIRE SOLO en el
// primer hit (current == 1) + PTTL. Si dos requests concurrentes pegan al
// mismo tiempo, Redis serializa el script entero: no hay ventana donde el
// TTL se "reinicie" por un hit que no es el primero (contrato: "no se
// extiende", ver §8 del design).
const INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
return { current, pttl }
`;

/**
 * f1-auth AD-7 (U6-01): storage propio de `ThrottlerStorage` sobre el
 * `REDIS_CLIENT` que ya existe — sin dependencias extra
 * (`@nest-lab/throttler-storage-redis` queda descartado, ver design).
 *
 * Contrato Redis vinculante (spec AUTH-REQ-17 / design §6): las claves de
 * throttle SIEMPRE llevan TTL — son las primeras candidatas a evicción bajo
 * `maxmemory-policy volatile-ttl`, a diferencia de `perm-epoch:*` que nunca
 * debe expirar. Esta clase NO decide el nombre de la key (eso lo arma el
 * guard como `throttle:{name}:{tracker}`) — la usa tal cual la recibe.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const [totalHits, pttl] = (await this.redis.eval(INCREMENT_SCRIPT, 1, key, ttl)) as [
      number,
      number,
    ];

    const timeToExpire = Math.ceil(pttl / 1000);
    const isBlocked = totalHits > limit;

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      // f1-auth AD-7: sin ventana de bloqueo progresivo separada en F1 — el
      // "bloqueo" ES la ventana de conteo (blockDuration == ttl del
      // throttler), así que timeToBlockExpire coincide con timeToExpire.
      timeToBlockExpire: timeToExpire,
    };
  }
}
