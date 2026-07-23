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
