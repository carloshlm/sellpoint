# @sellpoint/api

API de SellPoint — NestJS 11 + Prisma 7 + Postgres 16 + Redis 7. Valida su entorno con Zod al arrancar (env inválido = no arranca, con mensaje claro).

## Quick start

```bash
# desde la raíz del monorepo
pnpm dev:up                      # levanta Postgres + Redis (docker compose)
cp apps/api/.env.example apps/api/.env
pnpm --filter api start:dev      # http://localhost:3000
```

Verificación rápida: `curl localhost:3000/health` → `{"status":"ok","db":"ok","redis":"ok"}`

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm --filter api start:dev` | Dev server con watch (incluye JSON de i18n) |
| `pnpm --filter api test` | Tests unit (jest) |
| `pnpm --filter api test:e2e` | Tests e2e (supertest, módulo slim sin DB) |
| `pnpm --filter api build` | Compila a `dist/` |
| `pnpm --filter api exec prisma migrate dev` | Nueva migración en dev |
| `pnpm --filter api exec prisma generate` | Regenera el client (a `src/generated/`) |

## Estructura

```
src/
├── config/            # env.schema.ts — validación Zod del entorno (fail-fast)
├── common/filters/    # AllExceptionsFilter → {statusCode, message, error}
├── health/            # GET /health — canario permanente (db + redis)
├── i18n/              # nestjs-i18n: {es,en}/{common,auth,errors,emails}.json + GET /hello
├── infrastructure/
│   ├── prisma/        # PrismaService (adapter pg, extiende PrismaClient)
│   └── redis/         # RedisModule global (token REDIS_CLIENT, ioredis)
└── generated/prisma/  # client generado — NO editar, NO commitear
```

## Variables de entorno

Ver [.env.example](./.env.example). Todas validadas en [src/config/env.schema.ts](./src/config/env.schema.ts):

| Variable | Ejemplo | Notas |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://...` | URL requerida |
| `REDIS_URL` | `redis://localhost:6379` | URL requerida |
| `CORS_ORIGINS` | `http://localhost:5173` | CSV de URLs, con default |
| `NODE_ENV` / `PORT` | `development` / `3000` | Con defaults |

## Gotchas del stack (leer antes de pelearte con el tooling)

- **Prisma 7**: el client se genera en `src/generated/` con `moduleFormat: "cjs"` (jest revienta con el ESM default). Runtime necesita driver adapter (`@prisma/adapter-pg`). Las migraciones en prod corren en una **imagen dedicada** (`migrate` stage del Dockerfile) porque el CLI es devDependency.
- **Biome + Nest**: `useImportType` está OFF para este app (rompe la DI de Nest) y los decoradores de parámetro están habilitados — ambos en el override de `biome.json`. No los "arregles".
- **Tests sin `.env`**: `test/setup-env.js` (jest `setupFiles`) inyecta env defaults ANTES de los imports — `ConfigModule.forRoot` valida al importar, no al ejecutar.
- **i18n**: claves dotted (`common.hello`) idénticas a las del web. `GET /hello` es canario permanente de wiring, no residuo.
