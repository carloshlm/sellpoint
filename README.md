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
| [IMPLEMENTACION.md](./IMPLEMENTACION.md) | Plan de fases, tareas atomizadas, bitácora de decisiones |
| [ControlDeInventario.md](./ControlDeInventario.md) · [PuntoDeVenta.md](./PuntoDeVenta.md) | Documentos de idea originales |
