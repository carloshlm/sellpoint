# @sellpoint/web

Frontend de SellPoint — Vite 8 + React 19 + TypeScript estricto. TanStack Router (file-based) + TanStack Query, Tailwind 4, shadcn/ui, i18next, Zustand.

## Quick start

```bash
# desde la raíz del monorepo
pnpm --filter web dev            # http://localhost:5173
```

No necesita `.env` para arrancar (`VITE_API_URL` tiene default). Para hablar con el API local, levantalo aparte (`pnpm --filter api start:dev`).

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm --filter web dev` | Dev server con HMR |
| `pnpm --filter web test` | Tests (vitest + testing-library) |
| `pnpm --filter web build` | `tsc -b` + build de producción |
| `pnpm --filter web preview` | Sirve el build localmente |

## Estructura

```
src/
├── routes/            # TanStack Router file-based: __root, index (home), login
│                      #   routeTree.gen.ts se AUTOGENERA (commiteado, excluido de Biome)
├── components/
│   ├── ui/            # primitivas shadcn (Button, ...)
│   └── error-boundary.tsx
├── i18n/              # {es,en}/{common,auth,validation}.json + factory createI18n
├── lib/               # api.ts (axios, errores normalizados al shape del backend), utils
├── stores/            # Zustand — auth.store (token SOLO en memoria)
└── test/              # setup de vitest
```

## Convenciones que importan

- **Ningún string de UI hardcodeado**: todo texto pasa por `t('dominio.clave')` (claves idénticas a las del api). Cambiar un label = editar un JSON.
- **Estilos por tokens**: theme vars de Tailwind/shadcn en `index.css` — el look se cambia ahí, no componente por componente.
- **La home tiene 4 canarios** (`data-testid`): shared-import, tailwind-check, shadcn-check, i18n-check — son smoke tests vivos del wiring, no demos. Los cubren los tests; no los borres.
- **Tests herméticos**: los tests de router inyectan `createI18n()` propio (no el singleton con detector) — el patrón está en `router.test.tsx`.
- Paths: `@/*` → `src/`, `@sellpoint/*` → paquetes del monorepo **resolviendo a src** (vite-tsconfig-paths — HMR cross-package, sin rebuilds de shared).

## Env

| Variable | Default | Notas |
|----------|---------|-------|
| `VITE_API_URL` | `http://localhost:3000` | En producción se bakea `/api` (relativo, mismo origen) en el build de la imagen |
