# Contexto de build: raíz del monorepo
# docker build -f infrastructure/docker/api.Dockerfile .

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# --- Etapa de build: instala workspace, genera prisma client y compila ---
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter api... --ignore-scripts=false

COPY tsconfig.base.json biome.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api... build

# node_modules de producción autocontenido para el deploy
RUN pnpm --filter api deploy --prod --legacy /prod/api

# --- Etapa de runtime: imagen mínima solo con dist + deps de producción ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist

EXPOSE 3000
USER node
CMD ["node", "dist/main"]

# --- Etapa de migraciones: imagen dedicada solo para `prisma migrate deploy` ---
# Prisma es devDependency de apps/api (no existe en la etapa runtime de arriba,
# D11 del proposal f0-deploy). Se instala el CLI + dotenv como deps locales de
# esta imagen (no globales: prisma.config.ts hace `import "dotenv/config"` y
# necesita resolverlo en node_modules relativo, no en el global de npm).
# Versión pineada = la misma que apps/api/package.json (mantener en sync).
FROM base AS migrate
WORKDIR /app

RUN npm install --no-save --no-audit --no-fund prisma@7.9.0 dotenv@17.4.2

COPY apps/api/prisma ./prisma
COPY apps/api/prisma.config.ts ./prisma.config.ts

CMD ["npx", "prisma", "migrate", "deploy"]
