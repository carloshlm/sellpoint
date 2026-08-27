# Contexto de build: raíz del monorepo
# docker build -f infrastructure/docker/web.Dockerfile .

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter web...

COPY tsconfig.base.json biome.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# URL del API bakeada en build (override: --build-arg VITE_API_URL=...)
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
# DSN de Sentry (publico por diseno: vive en el JS del cliente); vacio = apagado. F6-WATCH-02.
ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}

RUN pnpm --filter web build

# --- Runtime: nginx sirviendo el build estático ---
# F6-SUPPLY-02: la variante UNPRIVILEGED corre como usuario nginx (101) sin
# root en ningún proceso — a cambio escucha en 8080 (los puertos <1024 piden
# privilegio). Los vhosts del edge apuntan a web:8080/sandbox-web:8080.
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
