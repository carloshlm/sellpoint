// Token DI aislado en su propio archivo a propósito: `redis.module.ts`
// registra `PermEpochService` como provider (necesita importar la clase), y
// `PermEpochService` necesita el token `REDIS_CLIENT` — si ese token viviera
// en `redis.module.ts`, los dos archivos se importarían entre sí (ciclo) y
// el decorator `@Inject(REDIS_CLIENT)` de `PermEpochService` resolvería
// `undefined` en tiempo de carga (el síntoma: Nest no puede resolver el
// argumento 0 del constructor). `redis.module.ts` re-exporta este token para
// no romper a ningún consumidor existente (`import { REDIS_CLIENT } from
// "../../infrastructure/redis/redis.module"` sigue funcionando).
export const REDIS_CLIENT = "REDIS_CLIENT";
