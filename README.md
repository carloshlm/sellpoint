# SellPoint

Sistema web **multi-tenant** de Control de Inventario + Punto de Venta (POS) para pequeños y medianos comercios. Monorepo TypeScript con API NestJS, frontend React y paquetes compartidos, pensado para operar multi-sucursal, multi-idioma (es/en) y multi-currency (MXN/USD).

> **Estado:** 🚧 Fase 0 — Setup + Walking Skeleton (en curso). El plan completo, tarea por tarea, vive en [IMPLEMENTACION.md](./IMPLEMENTACION.md).

## Quick start

Requisitos: **Node ≥ 22** y **pnpm 11** (versión pineada en `packageManager`). Docker Desktop se suma a partir del módulo F0-DB (Postgres + Redis locales).

```bash
pnpm install   # instala dependencias y activa los git hooks
pnpm dev       # levanta las apps en modo desarrollo (vía Turborepo)
```

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm dev` | Modo desarrollo de todas las apps (turbo) |
| `pnpm build` | Build de todos los paquetes en orden topológico |
| `pnpm test` | Tests de todos los paquetes |
| `pnpm lint` | Biome check (lint + format check) repo completo |
| `pnpm format` | Formatea el repo con Biome |
| `pnpm lint:packages` | Pipeline `lint` de turbo (lints propios de cada paquete) |

## Releases (F6-RELEASE)

El deploy es continuo: cada push a `main` pasa checks → imágenes → sandbox → producción, y el
server arranca por el **sha** (`IMAGE_TAG`: inmutable, es la llave del rollback). La **versión** es
un alias legible que cortas tú cuando hay algo que contar (`feat` sube minor, `fix` sube patch,
`BREAKING CHANGE` sube major — sale de los commits):

```bash
pnpm release:dry                 # ¿qué versión propone y qué entra al CHANGELOG? (no toca nada)
pnpm release                     # bumpea package.json, escribe CHANGELOG.md, commit chore(release) y tag vX.Y.Z
git push --follow-tags origin main   # SIN --follow-tags no viaja el tag y el pipeline no publica el release
```

La primera vez: `pnpm release:first` (fija 1.0.0). El pipeline, con producción verde, ve el tag en
HEAD, etiqueta las tres imágenes con `:X.Y.Z` (alias de la misma imagen que `:sha`) y crea la GitHub
Release con la sección del CHANGELOG. Qué versión corre: `GET /api/health` (`version` y `build`), el
pie del menú lateral, o la Release.

## Estructura

```
apps/            # api (NestJS) y web (React + Vite) — llegan en Fase 0
packages/        # shared (tipos + Zod), api-client (cliente HTTP generado)
infrastructure/  # docker-compose, deploy, IaC
.github/         # workflows de CI/CD
```

## Convenciones

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `commitlint` rechaza mensajes que no cumplan (`feat: ...`, `fix: ...`, etc.).
- **Pre-commit:** `lint-staged` corre `biome check` sobre los archivos staged; el commit se rechaza si hay errores.
- **TypeScript:** `strict` + `noUncheckedIndexedAccess`, configuración base en [tsconfig.base.json](./tsconfig.base.json). Sin `baseUrl` (TS 7 lo removió) — paths relativos siempre.

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [ARQUITECTURA.md](./ARQUITECTURA.md) | Stack, multi-tenancy (RLS), modelo de datos, decisiones técnicas |
| [CASOS_DE_USO.md](./CASOS_DE_USO.md) | Casos de uso por módulo y rol |
| [FLUJOS.md](./FLUJOS.md) | Flujos de negocio (ventas, inventario, traspasos) |
| [VISTAS.md](./VISTAS.md) | Especificación de pantallas y UX |
| [MERCADOS.md](./MERCADOS.md) | Países soportados, monedas, zonas horarias y diferencias de nomenclatura |
| [IMPLEMENTACION.md](./IMPLEMENTACION.md) | Plan de fases, tareas atomizadas, bitácora de decisiones |
| [ControlDeInventario.md](./ControlDeInventario.md) · [PuntoDeVenta.md](./PuntoDeVenta.md) | Documentos de idea originales |
