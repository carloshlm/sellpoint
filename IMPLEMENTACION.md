# SellPoint — Plan de Implementación Atomizada

> Documento operativo para construir SellPoint **paso a paso**. Cada tarea es una unidad pequeña, demoable, con criterio de "hecho" claro. Trabajamos punto por punto, marcamos progreso y registramos decisiones en la bitácora del final.

---

## Tabla de Contenidos

1. [Cómo Usar Este Documento](#1-cómo-usar-este-documento)
2. [Convenciones](#2-convenciones) · [2.5 Sincronización de Fuentes de Verdad](#25-sincronización-de-fuentes-de-verdad)
3. [Roadmap General](#3-roadmap-general)
4. [Fase 0 — Setup + Walking Skeleton](#fase-0--setup--walking-skeleton)
5. [Fase 1 — Multi-Tenant + Autenticación](#fase-1--multi-tenant--autenticación)
6. [Fase 2 — Catálogos Dinámicos](#fase-2--catálogos-dinámicos-outline)
7. [Fase 3 — Movimientos de Inventario](#fase-3--movimientos-de-inventario-outline)
8. [Fase 4 — POS PWA](#fase-4--pos-pwa-outline)
9. [Fase 5 — Reportes](#fase-5--reportes-outline)
10. [Fase 6 — Hardening de Producción](#fase-6--hardening-de-producción-outline)
11. [Fase 7 — Planes + Billing + Suscripciones](#fase-7--planes--billing--suscripciones)
12. [Fase 8 — Mobile (futuro)](#fase-8--mobile-futuro)
13. [Fase 9+ — Extensiones Verticales (futuro)](#fase-9--extensiones-verticales-futuro-fuera-de-mvp)
14. [Bitácora de Decisiones](#13-bitácora-de-decisiones)

---

## 1. Cómo Usar Este Documento

1. Trabajamos **una tarea a la vez**, en orden de dependencia.
2. Antes de empezar una tarea, leé su **criterio de hecho** y dependencias.
3. Al terminar, marcamos el checkbox `[x]` y agregamos una nota (si hubo decisiones interesantes) en la **Bitácora**.
4. Si una tarea resulta más grande de lo estimado, **partila** en sub-tareas (ej. `F1-AUTH-05` → `F1-AUTH-05a`, `F1-AUTH-05b`).
5. Cuando descubrimos trabajo que faltaba, **agregamos tareas nuevas** en la sección correspondiente (con el siguiente número libre).
6. Solo atomizamos las fases siguientes cuando estamos por entrar a ellas (**rolling wave planning**).

### 1.1 Criterio SDD — ¿usamos Spec-Driven Development en esta tarea?

> Antes de arrancar cada módulo, Claude evalúa este árbol de decisión y comunica la clasificación (sin SDD / SDD ligero / SDD completo). La regla completa vive en engram con `topic_key: sellpoint/sdd-application-criteria`. Acá queda la versión resumida para revisión humana.

**Árbol de decisión:**

| ¿La tarea es...? | Resultado |
|---|---|
| Setup / config / init / wiring puro (instalar dep, scaffold, docker-compose, CI yaml, scripts) | **SIN SDD** — directo + commit |
| < 2 h **Y** ≤ 3 archivos **Y** cero decisiones arquitectónicas **Y** no es feature de negocio | **SIN SDD** — directo + TDD si tiene lógica |
| Feature de negocio, seguridad, billing, datos críticos, o cross-cutting (auth, RLS, multi-tenant, BOM, POS, traspasos, i18n, Stripe, etc.) | **SDD COMPLETO** — explore → propose → spec → design → tasks → apply (TDD strict) → verify → archive |
| Hay ≥ 1 decisión arquitectónica no trivial (elegir patrón, modelar relación, diseñar UX no obvia, integración externa) | **SDD LIGERO** — propose + tasks + apply + verify (sin spec/design formales) |
| Nada de lo anterior | **SIN SDD** — directo + TDD si aplica |

**Mapeo concreto por categoría:**

- **SIN SDD**: F0-MONO-*, F0-DB-*, F0-SHARED-*, F0-I18N-01, F0-API-01, F0-WEB-01, F0-CI, F0-DOC. Bug fixes triviales.
- **SDD LIGERO**: F0-DEPLOY, F0-I18N-02/03/04, F2-WH, F5-EXPORT.
- **SDD COMPLETO**: F1-AUTH, F1-RBAC, F1-LOCALE, F1-TENANT, F1-SCOPE, F2-SCHEMA, F2-PRESENT, F2-BOM, F2-PROD, F2-IMPORT, F3-* (todos), F4-CART, F4-COMPOSITE, F4-CHECKOUT, F4-NUMPAD, F4-PRINT-BT, F4-PWA, F5-API, F6-*, F7-*, F9-*.

**Cómo Claude lo comunica:**

> "F{X}-{Y}-{N} es {clasificación} — recomiendo {plan de acción}. ¿OK?"

Y espera tu confirmación antes de avanzar.

**Override humano:** si decís *"hacelo sin SDD"* o *"hacelo con SDD aunque sea chico"*, Claude obedece. Anotamos la decisión en Bitácora.

**Auto-corrección mid-tarea:** si una tarea clasificada "sin SDD" revela complejidad inesperada, Claude pausa y propone pasar a SDD ligero antes de producir código frágil.

---

## 2. Convenciones

### 2.1 Sistema de Numeración

Cada tarea tiene un ID **único** con formato:

```
F{fase}-{módulo}-{N}
```

Ejemplos:
- `F0-MONO-01` → Fase 0, módulo MONO (monorepo), tarea 1
- `F1-AUTH-13` → Fase 1, módulo AUTH (autenticación), tarea 13
- `F2-CAT-07` → Fase 2, módulo CAT (catálogo), tarea 7

**Los números nunca se reutilizan**, incluso si una tarea se elimina (queda como `[descartada]`).

### 2.2 Estados

| Símbolo | Significado |
|---|---|
| `⬜` | Pendiente — no se ha empezado |
| `🟡` | En progreso — alguien la está trabajando ahora |
| `✅` | Completada |
| `⏸` | Bloqueada — esperando algo externo |
| `🚫` | Descartada — decidimos no hacerla (justificar en Bitácora) |

### 2.3 Granularidad

- **Cada tarea debería tomar entre 30 min y 4 horas.**
- Si va a tomar más → partirla.
- Si va a tomar menos de 30 min y no es de configuración → agruparla con otras.
- **Cada tarea debe ser demoable o verificable** (no tareas tipo "investigar X" sin entregable).

### 2.4 Formato de Tarea

```
- [ ] **F0-MONO-01** — Inicializar workspace pnpm
  - **Salida:** `pnpm-workspace.yaml` + `package.json` raíz creados
  - **Verificar:** `pnpm install` corre sin errores
  - **Depende de:** —
  - **Estimación:** 20 min
```

### 2.5 Sincronización de Fuentes de Verdad

> El proyecto tiene **tres fuentes** de información: los `.md`, **engram** (memoria persistente) y los **checkboxes/Bitácora**. El riesgo no es que existan — es que el mismo hecho viva en dos lugares y un día se contradigan. Esta sección define cómo se evita.

**Principio rector: una sola fuente de verdad POR CATEGORÍA de información.** No se sincroniza lo que no se duplica. Cada hecho vive en UN lugar; los demás apuntan, no copian.

| Categoría de información | Dueño canónico (SSOT) | Las otras fuentes |
|---|---|---|
| Diseño/spec estable (stack, modelos, flujos, vistas, plan de tareas) | los `.md` | engram apunta con `topic_key`; nunca copia el texto |
| Estado de ejecución (`⬜ 🟡 ✅ ⏸ 🚫` por tarea) | checkboxes en este documento | engram **no** trackea estado de tareas |
| Decisión + el porqué (lo que debe sobrevivir entre sesiones) | **engram** | Bitácora = índice de 1 línea que apunta al `topic_key` |
| Gotchas / aprendizajes / metodología | engram | — |

**Ritual de sincronización (momentos discretos, nunca "continuo"):**

1. **Al cerrar una tarea:**
   - Marcar el checkbox → `✅`.
   - ¿Hubo decisión o gotcha? → `mem_save` en engram (contenido completo) **+** una línea en la Bitácora apuntando al `topic_key`.
   - ¿La tarea cambió el diseño? → actualizar el `.md` afectado (ARQUITECTURA / VISTAS / etc.) **en el mismo commit que el código.**
2. **Al cerrar sesión:** `mem_session_summary`.
3. **Al cerrar una fase** (antes de atomizar la siguiente): auditoría rápida — ¿los checkboxes reflejan el código real?, ¿cada línea de Bitácora tiene un `topic_key` vivo?, ¿el `.md` de diseño describe lo que REALMENTE se construyó?

**Regla de oro — mismo commit:** cambio de código + actualización del `.md` + checkbox = **un commit atómico**. Si el código se movió y la doc no, el commit está incompleto. Ahí nace la deuda.

**Precedencia cuando igual diverjan:**
- Lo que el sistema **hace hoy** → manda el **código** (si el `.md` no coincide, está viejo: se corrige el `.md`).
- Lo que **decidimos y por qué** → manda **engram** (la Bitácora solo apunta).
- **Estado de ejecución** → mandan los checkboxes, verificados contra git al cerrar fase.

---

## 3. Roadmap General

| Fase | Nombre | Estado | Estimación | Atomizada |
|---|---|---|---|---|
| **F0** | Setup + Walking Skeleton | ⬜ Pendiente | 1.5-2 semanas | ✅ Sí |
| **F1** | Multi-Tenant + Auth | ⬜ Pendiente | 2-3 semanas | ✅ Sí |
| **F2** | Catálogos Dinámicos | ⬜ Pendiente | 2 semanas | ⬜ Outline |
| **F3** | Movimientos de Inventario | ⬜ Pendiente | 2-3 semanas | ⬜ Outline |
| **F4** | POS PWA | ⬜ Pendiente | 3 semanas | ⬜ Outline |
| **F5** | Reportes | ⬜ Pendiente | 1-2 semanas | ⬜ Outline |
| **F6** | Hardening de Producción | ⬜ Pendiente | 1 semana | ⬜ Outline |
| **F7** | Planes + Billing + Suscripciones | ⬜ Pendiente | 3-4 semanas | ✅ Sí |
| **F8** | Mobile | 🔮 Futuro | — | ⬜ Solo concepto |
| **F9+** | Extensiones Verticales (consultorio, dental, óptica, etc.) | 🔮 Futuro | — | ⬜ Solo concepto |

> Las fases marcadas como "Outline" se atomizarán cuando estemos por empezarlas, con el conocimiento que hayamos acumulado.

---

## Fase 0 — Setup + Walking Skeleton

> **Objetivo:** monorepo levantable con `pnpm dev`, dos apps vacías (`api`, `web`), CI básico, Docker local + VPS (Vultr), **y walking skeleton deployable a producción con HTTPS**. Cada push a `main` deploya automáticamente. Cuando empecemos features en F1, ya tenemos el pipeline end-to-end funcionando — no hay sorpresas de producción al final.

### Módulo F0-MONO — Estructura del Monorepo

- [x] **F0-MONO-01** — Inicializar workspace pnpm
  - **Salida:** `pnpm-workspace.yaml` + `package.json` raíz creados
  - **Verificar:** `pnpm install` corre sin errores
  - **Depende de:** —
  - **Estimación:** 20 min

- [x] **F0-MONO-02** — Configurar Turborepo
  - **Salida:** `turbo.json` con pipelines `build`, `test`, `lint`, `dev`
  - **Verificar:** `pnpm dlx turbo run --help` responde
  - **Depende de:** F0-MONO-01
  - **Estimación:** 30 min

- [x] **F0-MONO-03** — Crear estructura de carpetas
  - **Salida:** `apps/`, `packages/`, `infrastructure/`, `.github/` vacías con `.gitkeep`
  - **Verificar:** estructura visible en árbol
  - **Depende de:** F0-MONO-01
  - **Estimación:** 10 min

- [x] **F0-MONO-04** — Configurar `.gitignore` y `.editorconfig`
  - **Salida:** ambos archivos en raíz, con reglas para Node, TS, OS, IDE
  - **Verificar:** `git status` no muestra `node_modules` ni `dist`
  - **Depende de:** F0-MONO-01
  - **Estimación:** 10 min

- [x] **F0-MONO-05** — Configurar TypeScript root + `tsconfig.base.json`
  - **Salida:** `tsconfig.base.json` con `strict: true`, paths para `@sellpoint/*`
  - **Verificar:** `tsc --noEmit` corre sin errores en root
  - **Depende de:** F0-MONO-03
  - **Estimación:** 30 min

- [x] **F0-MONO-06** — Configurar Biome (lint + format)
  - **Salida:** `biome.json` con reglas, scripts `lint` y `format` en `package.json` raíz
  - **Verificar:** `pnpm lint` y `pnpm format` corren
  - **Depende de:** F0-MONO-01
  - **Estimación:** 30 min

- [x] **F0-MONO-07** — Configurar Husky + lint-staged
  - **Salida:** pre-commit hook que corre lint sobre archivos staged
  - **Verificar:** intentar commit con un archivo mal formateado lo rechaza
  - **Depende de:** F0-MONO-06
  - **Estimación:** 30 min

- [x] **F0-MONO-08** — Configurar conventional commits + commitlint
  - **Salida:** `commitlint.config.js` + Husky hook `commit-msg`
  - **Verificar:** `git commit -m "test"` falla; `git commit -m "feat: test"` pasa
  - **Depende de:** F0-MONO-07
  - **Estimación:** 20 min

- [x] **F0-MONO-09** — README principal del repo
  - **Salida:** `README.md` con descripción del proyecto, links a docs, comandos básicos
  - **Verificar:** revisión visual
  - **Depende de:** —
  - **Estimación:** 20 min

- [x] **F0-MONO-10** — Primer commit del monorepo
  - **Salida:** repo inicial con tag `v0.0.0-init`
  - **Verificar:** `git log` muestra el commit
  - **Depende de:** F0-MONO-01 a F0-MONO-09
  - **Estimación:** 5 min

---

### Módulo F0-DB — Infraestructura Local de Datos

- [x] **F0-DB-01** — `docker-compose.dev.yml` con Postgres 16
  - **Salida:** archivo en `infrastructure/docker-compose.dev.yml` con servicio `postgres` (volumen persistente, healthcheck)
  - **Verificar:** `docker compose -f infrastructure/docker-compose.dev.yml up postgres` levanta y `psql` conecta
  - **Depende de:** F0-MONO-03
  - **Estimación:** 30 min

- [x] **F0-DB-02** — Agregar Redis 7 al `docker-compose.dev.yml`
  - **Salida:** servicio `redis` con persistencia
  - **Verificar:** `redis-cli ping` responde PONG
  - **Depende de:** F0-DB-01
  - **Estimación:** 15 min

- [x] **F0-DB-03** — Script `dev:up` y `dev:down` en `package.json` raíz
  - **Salida:** comandos `pnpm dev:up` y `pnpm dev:down` que controlan los contenedores
  - **Verificar:** ambos comandos funcionan
  - **Depende de:** F0-DB-02
  - **Estimación:** 10 min

---

### Módulo F0-SHARED — Paquetes Compartidos

- [x] **F0-SHARED-01** — Crear `packages/shared` con TypeScript
  - **Salida:** `packages/shared/package.json`, `tsconfig.json` extendiendo el base, build con `tsc`
  - **Verificar:** `pnpm --filter @sellpoint/shared build` genera `dist/`
  - **Depende de:** F0-MONO-05
  - **Estimación:** 30 min

- [x] **F0-SHARED-02** — Instalar Zod en `packages/shared` y exportar primer schema dummy
  - **Salida:** archivo `src/schemas/health.ts` con `HealthSchema = z.object({status: z.literal('ok')})`
  - **Verificar:** importable desde otro paquete
  - **Depende de:** F0-SHARED-01
  - **Estimación:** 20 min

- [x] **F0-SHARED-03** — Crear `packages/api-client` (placeholder)
  - **Salida:** estructura vacía con `package.json` y un export `version`
  - **Verificar:** `pnpm install` lo enlaza correctamente
  - **Depende de:** F0-MONO-05
  - **Estimación:** 20 min

---

### Módulo F0-I18N — Setup base de Internacionalización + Currency

> Setup mínimo para que i18n y formateo de moneda estén disponibles desde el día 1. Las traducciones específicas (auth, errores, emails) se agregan en F1-LOCALE y módulos siguientes.

- [x] **F0-I18N-01** — Constantes y tipos `Locale` + `Currency` en `packages/shared`
  - **Salida:** `packages/shared/src/i18n.ts` con `SUPPORTED_LOCALES = ['es', 'en'] as const`, `SUPPORTED_CURRENCIES = ['MXN', 'USD'] as const`, types `Locale` y `Currency`, `DEFAULT_LOCALE`, `DEFAULT_CURRENCY`.
  - **Verificar:** importable desde `apps/api` y `apps/web` con autocompletado de tipos.
  - **Depende de:** F0-SHARED-02
  - **Estimación:** 20 min

- [x] **F0-I18N-02** — Helper `formatMoney(amount, currency, locale)` en `packages/shared`
  - **Salida:** función usando `Intl.NumberFormat`. Helper auxiliar `localeToBcp47(locale)` (`es` → `es-MX`, `en` → `en-US`). Tests unitarios cubriendo combinaciones MXN/USD × es/en.
  - **Verificar:** `formatMoney(1234.56, 'MXN', 'es')` → `"$1,234.56"`; tests verdes.
  - **Depende de:** F0-I18N-01
  - **Estimación:** 1 h

- [x] **F0-I18N-03** — Setup `nestjs-i18n` en `apps/api`
  - **Salida:** módulo `I18nModule.forRoot()` registrado, estructura `apps/api/src/i18n/{es,en}/{common,auth,errors,emails}.json` con un par de claves dummy. Loader configurado para hot-reload en dev.
  - **Verificar:** endpoint dummy `GET /hello` devuelve `"Hola"` con `Accept-Language: es` y `"Hello"` con `en`.
  - **Depende de:** F0-API-01, F0-I18N-01
  - **Estimación:** 1.5 h

- [x] **F0-I18N-04** — Setup `react-i18next` en `apps/web`
  - **Salida:** `react-i18next` + `i18next-browser-languagedetector` instalados; estructura `apps/web/src/i18n/{es,en}/{common,auth,validation}.json`; provider en root; hook `useTranslation()` funcionando; detector lee `localStorage` → `navigator`.
  - **Verificar:** componente dummy usando `t('common.welcome')` muestra texto correcto al cambiar locale — cubierto por tests (`changeLanguage` + persistencia en `localStorage`, `apps/web/src/i18n/i18n.test.tsx`). La verificación manual en devtools queda a mano del usuario si la quiere hacer.
  - **Depende de:** F0-WEB-01, F0-I18N-01
  - **Estimación:** 2 h

---

### Módulo F0-API — Bootstrap del Backend

- [x] **F0-API-01** — `nest new apps/api` (con pnpm)
  - **Salida:** app NestJS funcionando con `pnpm --filter api start:dev`
  - **Verificar:** `curl localhost:3000` devuelve `Hello World!`
  - **Depende de:** F0-MONO-02
  - **Estimación:** 30 min

- [x] **F0-API-02** — Configurar TypeScript estricto en `apps/api`
  - **Salida:** `tsconfig.json` extiende base, `strict: true`
  - **Verificar:** `pnpm --filter api build` sin errores
  - **Depende de:** F0-API-01
  - **Estimación:** 15 min

- [x] **F0-API-03** — Configurar variables de entorno tipadas (Zod + ConfigModule)
  - **Salida:** `src/config/env.schema.ts` valida `.env`, `ConfigModule.forRoot` con validation
  - **Verificar:** arrancar con `.env` inválido falla con mensaje claro
  - **Depende de:** F0-API-01, F0-SHARED-02
  - **Estimación:** 1 h

- [x] **F0-API-04** — Crear `.env.example` para API
  - **Salida:** archivo con todas las variables documentadas
  - **Verificar:** copia a `.env` permite arrancar el server
  - **Depende de:** F0-API-03
  - **Estimación:** 15 min

- [x] **F0-API-05** — Instalar y configurar Prisma
  - **Salida:** `prisma/schema.prisma` con datasource Postgres + generator, `PrismaService` en `infrastructure/prisma`
  - **Verificar:** `pnpm --filter api prisma migrate dev --name init` corre (con schema vacío)
  - **Depende de:** F0-API-01, F0-DB-01
  - **Estimación:** 45 min

- [x] **F0-API-06** — Endpoint `GET /health`
  - **Salida:** controller que devuelve `{status: 'ok', db: 'ok', redis: 'ok'}`
  - **Verificar:** `curl localhost:3000/health` devuelve 200
  - **Depende de:** F0-API-05, F0-DB-02
  - **Estimación:** 30 min

- [x] **F0-API-07** — Setup de Swagger
  - **Salida:** UI disponible en `/docs`, `openapi.json` generado
  - **Verificar:** `/docs` muestra el endpoint `/health`
  - **Depende de:** F0-API-06
  - **Estimación:** 30 min

- [x] **F0-API-08** — Setup de Pino logger con redacción
  - **Salida:** `nestjs-pino` configurado, redacta `authorization`, `password`, `cookie`
  - **Verificar:** request muestra log estructurado en JSON
  - **Depende de:** F0-API-01
  - **Estimación:** 45 min

- [x] **F0-API-09** — Global exception filter
  - **Salida:** `AllExceptionsFilter` formatea errores como `{statusCode, message, error}`
  - **Verificar:** lanzar un error desde el controller produce respuesta consistente
  - **Depende de:** F0-API-01
  - **Estimación:** 30 min

- [x] **F0-API-10** — Setup CORS + Helmet
  - **Salida:** middleware configurado con whitelist de origins desde env
  - **Verificar:** request desde origin no whitelisteado es rechazado
  - **Depende de:** F0-API-03
  - **Estimación:** 30 min

- [x] **F0-API-11** — Test unitario de smoke
  - **Salida:** Jest corriendo, `app.controller.spec.ts` con un test del health
  - **Verificar:** `pnpm --filter api test` pasa
  - **Depende de:** F0-API-06
  - **Estimación:** 30 min

- [x] **F0-API-12** — Dockerfile para API (multi-stage, dev)
  - **Salida:** `infrastructure/docker/api.Dockerfile`, build funciona
  - **Verificar:** `docker build -f infrastructure/docker/api.Dockerfile .` exitoso
  - **Depende de:** F0-API-11
  - **Estimación:** 1 h

---

### Módulo F0-WEB — Bootstrap del Frontend

- [x] **F0-WEB-01** — Crear `apps/web` con Vite + React + TypeScript
  - **Salida:** app levanta con `pnpm --filter web dev` en puerto 5173
  - **Verificar:** browser muestra landing default de Vite
  - **Depende de:** F0-MONO-02
  - **Estimación:** 30 min

- [x] **F0-WEB-02** — Configurar TypeScript estricto en `apps/web`
  - **Salida:** extiende `tsconfig.base.json`, paths para `@sellpoint/*`
  - **Verificar:** import desde `packages/shared` funciona
  - **Depende de:** F0-WEB-01, F0-SHARED-02
  - **Estimación:** 20 min

- [x] **F0-WEB-03** — Instalar Tailwind CSS + PostCSS
  - **Salida:** ~~`tailwind.config.ts`~~ Tailwind 4 CSS-first (`@tailwindcss/vite` + `@import "tailwindcss"`), sin config file ni PostCSS — clases funcionan
  - **Verificar:** un `<div class="bg-blue-500">` se ve azul
  - **Depende de:** F0-WEB-01
  - **Estimación:** 30 min

- [x] **F0-WEB-04** — Inicializar shadcn/ui
  - **Salida:** `components.json` configurado, `Button` instalado como prueba
  - **Verificar:** `<Button>Click</Button>` renderiza con estilos shadcn
  - **Depende de:** F0-WEB-03
  - **Estimación:** 45 min

- [x] **F0-WEB-05** — Setup TanStack Router (file-based, con autoCodeSplitting)
  - **Salida:** rutas `/` y `/login` (placeholder) navegables
  - **Verificar:** navegación browser funciona
  - **Depende de:** F0-WEB-04
  - **Estimación:** 1 h

- [x] **F0-WEB-06** — Setup TanStack Query con QueryClientProvider
  - **Salida:** `App.tsx` con provider, devtools en dev
  - **Verificar:** devtools de Query visibles en browser
  - **Depende de:** F0-WEB-05
  - **Estimación:** 30 min

- [x] **F0-WEB-07** — Axios instance con baseURL + interceptors básicos
  - **Salida:** `lib/api.ts` exporta instance configurada
  - **Verificar:** llamada a `/health` del API funciona desde el frontend
  - **Depende de:** F0-WEB-06, F0-API-06
  - **Estimación:** 45 min

- [x] **F0-WEB-08** — Setup de Zustand
  - **Salida:** store de ejemplo `useAuthStore` con accessToken (en memoria)
  - **Verificar:** un componente puede leer y setear el token
  - **Depende de:** F0-WEB-01
  - **Estimación:** 30 min

- [x] **F0-WEB-09** — Variables de entorno con prefijo `VITE_` (adelantada: WEB-07 la necesita)
  - **Salida:** `.env.example` y `vite-env.d.ts` tipados
  - **Verificar:** `import.meta.env.VITE_API_URL` está tipado
  - **Depende de:** F0-WEB-01
  - **Estimación:** 20 min

- [x] **F0-WEB-10** — ErrorBoundary global
  - **Salida:** componente que captura errores y muestra fallback
  - **Verificar:** un componente que lanza error muestra el fallback
  - **Depende de:** F0-WEB-01
  - **Estimación:** 30 min

- [x] **F0-WEB-11** — Manifest PWA básico (sin service worker aún)
  - **Salida:** `public/manifest.webmanifest` con nombre, íconos placeholder
  - **Verificar:** Lighthouse detecta el manifest
  - **Depende de:** F0-WEB-01
  - **Estimación:** 30 min

- [x] **F0-WEB-12** — Test smoke con Vitest (adelantada: habilita verificar WEB-05/06/07/10 con tests)
  - **Salida:** `App.test.tsx` con test mínimo, `vitest.config.ts`
  - **Verificar:** `pnpm --filter web test` pasa
  - **Depende de:** F0-WEB-01
  - **Estimación:** 30 min

- [x] **F0-WEB-13** — Dockerfile para Web (build estático + nginx)
  - **Salida:** `infrastructure/docker/web.Dockerfile`
  - **Verificar:** `docker build` exitoso, imagen sirve la app
  - **Depende de:** F0-WEB-12
  - **Estimación:** 1 h

---

### Módulo F0-CI — CI Básica

> 🔌 **MCP al abrir este módulo:** evaluar **GitHub MCP** si el repo gana remote + Actions (opcional: `gh` CLI ya cubre el 80%). Ver `topic_key: decision/mcps-del-proyecto...` en engram.

- [x] **F0-CI-01** — GitHub Actions: workflow `ci.yml`
  - **Salida:** workflow corre en push y PR: `pnpm install`, `pnpm lint`, `pnpm type-check`, `pnpm test`
  - **Verificar:** push a una rama dispara el workflow y pasa
  - **Depende de:** F0-API-11, F0-WEB-12
  - **Estimación:** 1 h
  - **Nota (2026-08-06):** implementada dentro del change `f0-deploy` (D5 del proposal), no como módulo aparte. `checks.yml` reusable + `ci.yml` que lo invoca en push/PR; `deploy.yml` llama al mismo reusable como gate antes de build+push. Confirmado en verde en el run del pipeline de producción (ver F0-DEPLOY-12).

- [x] **F0-CI-02** — Configurar Dependabot
  - **Salida:** `.github/dependabot.yml` para npm y GitHub Actions
  - **Verificar:** archivo válido (no se puede testear sin esperar el primer scan)
  - **Depende de:** F0-CI-01
  - **Estimación:** 15 min

- [ ] ⏸️ **F0-CI-03** — Branch protection rules en `main` — **DIFERIDA (2026-08-06)**
  - **Por qué:** choca con el diseño del walking skeleton ("push a main = deploy directo") y con un solo dev no protege de nada real. Los checks igual corren en cada push y frenan el deploy si fallan.
  - **Trigger de reactivación:** cuando el flujo de PRs entre en uso (chained PRs en F1) o se sume un segundo dev — lo primero que ocurra.
  - **Salida original:** configuración en GitHub que requiere CI verde para mergear
  - **Depende de:** F0-CI-01

---

### Módulo F0-DEPLOY — Walking Skeleton en Producción

> **Por qué acá y no en F6:** queremos que **cada commit deploye a producción desde el día 1**. Esto evita el anti-patrón de "funciona en mi máquina", descubre problemas de prod (HTTPS, cookies, CORS, RLS con pooler) cuando son baratos de arreglar, y construye el músculo de CD desde temprano. F0 deja el deploy mínimo funcional; F6 endurece (backups, monitoreo, secrets, DR).
>
> **Proveedor (FINAL, 2026-08-04):** VPS **Vultr High Frequency 1 vCPU/2GB, región Ciudad de México** ($12/mes verificado, ~15ms) + registry **GHCR**. Hetzner descartado con evidencia de consola: post-suba de junio 2026 su plan US cuesta $20.49 (más caro y con peor latencia) y los baratos son solo-Europa (~150ms). Resize a HF 4GB (~$24) cuando lleguen los workers de F5. La instancia EC2 previa se dio de baja. Detalle: `topic_key: decision/deploy-vultr` en engram.

- [x] **F0-DEPLOY-00** — Repo GitHub + remote + push inicial (tarea agregada por el proposal: el repo era local-only)
  - **Salida:** `carloshlm/sellpoint` con main pusheado; secrets de Actions cargados
  - **Verificar:** `git push` funciona; workflows visibles en Actions — HECHO 2026-08-06

- [x] **F0-DEPLOY-01** — Acceso SSH al VPS + hardening básico
  - **Salida:** acceso por key (no password), `ufw` con solo 22/80/443 abiertos, `fail2ban` activo, usuario non-root con sudo
  - **Verificar:** SSH funciona; conexión a puertos no abiertos es rechazada
  - **Depende de:** —
  - **Estimación:** 45 min
  - **Nota (2026-08-06):** `deploy` (grupos docker) creado por `infrastructure/scripts/bootstrap.sh`; `sshd_config` con `PermitRootLogin no` + `PasswordAuthentication no` + `AuthenticationMethods publickey`; `ufw` solo 22/80/443; `fail2ban` jail sshd activo; swap 2GB. Password de root del SO conservada a propósito (rescate por consola Vultr, D4 del proposal).

- [x] **F0-DEPLOY-02** — Instalar Docker + Docker Compose en el VPS
  - **Salida:** `docker run hello-world` corre en el server
  - **Verificar:** `docker --version` y `docker compose version` responden
  - **Depende de:** F0-DEPLOY-01
  - **Estimación:** 20 min
  - **Nota (2026-08-06):** Docker 29 + Compose v5 instalados por el bootstrap; usados en vivo para levantar los 5 servicios del stack (ver F0-DEPLOY-04/05).

- [x] **F0-DEPLOY-03** — Apuntar dominio a la IP del VPS
  - **Salida:** A record `tu-dominio.com` → IP del VPS (IP fija incluida)
  - **Verificar:** `dig tu-dominio.com` resuelve a la IP correcta
  - **Depende de:** F0-DEPLOY-01
  - **Estimación:** 30 min
  - **Nota (2026-08-04, verificada de nuevo 2026-08-06):** `laradoc.com`/`www.laradoc.com` delegados a Cloudflare. ⚠️ Al 2026-08-06 el proxy de Cloudflare está en modo naranja (`dig` → `172.64.80.1`, no la IP del VPS directamente) — el diseño original (D7 del proposal `f0-deploy`) asumía nube gris/DNS-only. Funciona igual porque el certificado de origin es válido (Cloudflare en modo Full/Full-strict) y el ACME challenge pasa por el proxy, pero es una desviación no intencional del diseño que Carlos debería confirmar.

- [x] **F0-DEPLOY-04** — `docker-compose.prod.yml` con Postgres + Redis en el VPS
  - **Salida:** ambos servicios con volúmenes persistentes en disco del VPS, network privada
  - **Verificar:** `docker compose up -d postgres redis` arranca; `psql` conecta desde dentro del server
  - **Depende de:** F0-DEPLOY-02
  - **Estimación:** 45 min
  - **Nota (2026-08-06):** `postgres:16-alpine` + `redis:7-alpine` arriba en `/opt/sellpoint`, sin `ports:` publicados (D4 — Docker saltea ufw), healthchecks verdes, volúmenes `postgres_data`/`redis_data` persistentes.

- [x] **F0-DEPLOY-05** — Nginx como reverse proxy (HTTP)
  - **Salida:** Nginx en container; sirve `:80` → API en `/api/*` y web estático (o `:5173`) en `/`
  - **Verificar:** `curl http://tu-dominio.com/api/health` devuelve 200
  - **Depende de:** F0-DEPLOY-03, F0-DEPLOY-04
  - **Estimación:** 1 h
  - **Nota (2026-08-06):** `nginx-edge` (etapa `http-only.conf`) con strip de `/api` (D8); `curl http://laradoc.com/api/health` → `{"status":"ok","db":"ok","redis":"ok"}` antes de emitir TLS.

- [x] **F0-DEPLOY-06** — SSL con Let's Encrypt + certbot + auto-renewal
  - **Salida:** certificado válido, redirect `80 → 443`, cron de renovación cada 60 días
  - **Verificar:** `https://tu-dominio.com` con candado verde; `certbot renew --dry-run` exitoso
  - **Depende de:** F0-DEPLOY-05
  - **Estimación:** 45 min
  - **Nota (2026-08-06):** `--dry-run` OK, emisión real OK (expira 2026-11-04), `nginx-edge` recreado con `with-tls.conf`; `curl -I https://laradoc.com` → 200 con cert de Let's Encrypt válido, `http://` redirige 301 a `https://`. Cron de renovación en crontab de `deploy`: diario 04:30 UTC (D7 del proposal — no cada 60 días como decía este ítem original, LE recomienda intentos más frecuentes; el cron corre `renew` que es no-op hasta ~30 días antes del vencimiento).

- [x] **F0-DEPLOY-07** — Variables de entorno productivas en el server
  - **Salida:** `/opt/sellpoint/.env.prod` fuera del repo (permisos `600`), referenciado por compose
  - **Verificar:** API arranca con URLs HTTPS y CORS configurado para el dominio prod
  - **Depende de:** F0-DEPLOY-06
  - **Estimación:** 30 min
  - **Nota (2026-08-06):** archivo real es `/opt/sellpoint/.env` (D9 del proposal — un solo nombre sin flags), generado EN el server vía SSH (password nunca pasó por el chat), `chmod 600`. `CORS_ORIGINS=https://laradoc.com,https://www.laradoc.com`, API healthy consumiéndolo.

- [x] **F0-DEPLOY-08** — Configurar GHCR + token con permisos mínimos
  - **Salida:** imágenes `sellpoint-api` y `sellpoint-web` en GHCR (`ghcr.io/{owner}`); el workflow usa `GITHUB_TOKEN` con `packages: write`; el VPS usa un PAT read-only para pull; política de retención de imágenes viejas
  - **Verificar:** `docker login ghcr.io` + push/pull de prueba funcionan
  - **Depende de:** —
  - **Estimación:** 30 min
  - **Nota (2026-08-06):** 3 imágenes (`api`, `web`, `migrate`) publicadas en `ghcr.io/carloshlm/sellpoint-*` con tags `latest` + sha. `docker login` en el server con PAT read-only confirmado, pull de las 3 imágenes exitoso en el deploy real.

- [x] **F0-DEPLOY-09** — GitHub Actions: build + push a GHCR
  - **Salida:** workflow `deploy.yml` que en push a `main` buildea ambas imágenes y las pushea con tags `latest` + `${sha}`
  - **Verificar:** push a `main` produce imágenes nuevas en GHCR
  - **Depende de:** F0-DEPLOY-08, F0-CI-01
  - **Estimación:** 1.5 h
  - **Nota (2026-08-06):** `deploy.yml` job `build-push` builea 3 imágenes (api runtime, migrate, web). Confirmado en verde en dos runs de producción (ver F0-DEPLOY-12).

- [x] **F0-DEPLOY-10** — GitHub Actions: SSH deploy al VPS
  - **Salida:** workflow hace SSH al server, `docker login` a GHCR, `docker compose pull && up -d`
  - **Verificar:** un cambio trivial en el repo se ve en `https://tu-dominio.com` en < 5 min
  - **Depende de:** F0-DEPLOY-09
  - **Estimación:** 1.5 h
  - **Nota (2026-08-06):** job `deploy` de `deploy.yml` hace scp del compose+nginx, migrate one-shot, `pull && up -d`, smoke con rollback (D10). Primer run (`31112444849`) quedó VERDE por un bug (ver F0-DEPLOY-11): `docker compose run --rm migrate` sin `</dev/null` se tragaba el resto del script por stdin compartido del heredoc SSH, terminando el deploy en silencio justo después de migrar, sin tocar `api`/`web`. Fix (`</dev/null`) + segundo run (`31113060850`) confirmaron `pull`+`up -d`+smoke reales, contenedores recreados con el tag nuevo.

- [x] **F0-DEPLOY-11** — Smoke test post-deploy
  - **Salida:** último paso del workflow pega a `/api/health`; si responde != 200 o `db != ok`, el deploy falla
  - **Verificar:** romper a propósito (apagar la DB) y validar que el workflow rojea
  - **Depende de:** F0-DEPLOY-10
  - **Estimación:** 30 min
  - **Nota (2026-08-06):** smoke loop (30×5s) contra `/api/health` con rollback automático por reescritura de `IMAGE_TAG` (D10). **Encontrado y corregido un bug real durante esta misma validación**: el primer run de producción (`31112444849`) quedó VERDE sin haber desplegado nada — `docker compose run --rm migrate` sin `</dev/null` heredaba el stdin del heredoc SSH y se tragaba el resto del script (pull/up -d/smoke/prune) como si fuera su propio input; bash llegaba a EOF prematuro y el script terminaba en `exit 0` justo después de migrar. Corregido agregando `</dev/null` al comando (commit `762fc23`); el run siguiente (`31113060850`) mostró el smoke real: `Container sellpoint-api Healthy` → `Smoke test /api/health...` → `Smoke OK. Limpiando imagenes viejas.`, con `api`/`web` recreados en el tag nuevo. La prueba de "apagar la DB a propósito" NO se ejecutó (prohibido bajar postgres/redis en este batch) — el smoke ya está validado por el bug real encontrado y corregido arriba, que es evidencia más fuerte que un test sintético.

- [x] **F0-DEPLOY-12** — Validación end-to-end del walking skeleton
  - **Salida:** commit con cambio trivial (ej. texto en home) → visible en producción automáticamente, sin intervención manual
  - **Verificar:** cronómetro: commit → deploy verde → cambio visible en < 5 min
  - **Depende de:** F0-DEPLOY-11
  - **Estimación:** 15 min
  - **Nota (2026-08-06):** run real de referencia `31113060850` (commit `762fc23` → `main`): push a `14:52:52 UTC`, workflow completo (`checks` 41s + `build-push` 31s + `deploy` 40s) en verde a `14:54:57 UTC` = **2m05s**, muy por debajo de los 5 min. Cambio visible en `https://laradoc.com` con el tag nuevo confirmado por SSH y por `/api/health`. Detalle completo en `sdd/f0-deploy/apply-progress`.

- [x] **F0-DEPLOY-13** — Backup mínimo de Postgres desde el día 1
  - **Salida:** cron nocturno de `pg_dump` comprimido subido a Cloudflare R2 (10GB gratis) o Backblaze B2, retención 14 días; adelantado de F6 porque con clientes reales un server único sin backup no es opción
  - **Verificar:** restaurar el dump de ayer en un Postgres local y correr una query
  - **Depende de:** F0-DEPLOY-04
  - **Estimación:** 1 h
  - **Nota (2026-08-06):** rclone binario estático instalado sin sudo en `/home/deploy/bin/rclone` (v1.75.0). `rclone lsd r2:` da 403 (token R2 scoped al bucket, sin permiso `ListBuckets` de cuenta) pero `rclone lsd r2:sellpoint-backups` da exit 0 — confirmado funcional. **Bug real encontrado y corregido en el script** (`infrastructure/scripts/backup-postgres.sh`, ya escrito en batch 1): usaba `${POSTGRES_USER:-sellpoint}`/`${POSTGRES_DB:-sellpoint}` del entorno del propio script (que corre standalone por cron, sin sourcear `.env`) — en prod `POSTGRES_DB=sellpoint_prod`, no `sellpoint`, así que el dump hubiera fallado apenas se instalara. Corregido para tomar esas vars directo del entorno del container `postgres` vía `exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"'`. También se cambió `rclone` a ruta absoluta `/home/deploy/bin/rclone` (cron no tiene el PATH de una sesión de login). **Primer backup real**: `sellpoint-20260806-1543.dump`, 2114 bytes, confirmado con `rclone ls r2:sellpoint-backups`. **Prueba de restore real**: dump bajado a `/tmp` del server, copiado al container con `docker compose cp`, `createdb sellpoint_restore_test` + `pg_restore` (exit 0) dentro del container `sellpoint-postgres`, verificado con `\dt` (tabla `_prisma_migrations`, único contenido real del schema hoy) y `SELECT current_database()`. Limpieza: `dropdb sellpoint_restore_test` + `rm` de ambos `/tmp` (host y container) — confirmado sin residuos. **Retención validada en caliente**: se subió un objeto de prueba con `rclone touch -t 2026-01-01T00:00:00` (mtime real, no por nombre), `rclone delete --min-age 14d --dry-run` mostró que solo ese objeto sería borrado, la corrida real lo eliminó y dejó intacto el backup real de hoy. Primera purga real de producción ocurre a los 14 días de la primera corrida por cron. Cron instalado: `15 9 * * *` (09:15 UTC = 03:15 CDMX), log en `/opt/sellpoint/logs/backup.log` con rotación simple (`tail -n 5000` in-place tras cada corrida, ~500 días de historial antes de recortar). Detalle completo en `sdd/f0-deploy/apply-progress`.

---

### Módulo F0-DOC — Documentación Inicial

- [x] **F0-DOC-01** — `CONTRIBUTING.md` con convenciones de commits y branches
  - **Salida:** archivo con guía de contribución
  - **Verificar:** revisión visual
  - **Depende de:** F0-MONO-08
  - **Estimación:** 30 min

- [x] **F0-DOC-02** — `apps/api/README.md` con comandos y estructura
  - **Salida:** README específico de la API
  - **Verificar:** seguir las instrucciones desde cero funciona
  - **Depende de:** F0-API-12
  - **Estimación:** 30 min

- [x] **F0-DOC-03** — `apps/web/README.md` con comandos y estructura
  - **Salida:** README específico del web
  - **Verificar:** seguir instrucciones desde cero funciona
  - **Depende de:** F0-WEB-13
  - **Estimación:** 30 min

---

### ✅ Definición de "Fase 0 completa"

**Dev local:**
- [x] Clonar el repo limpio, correr `pnpm install && pnpm dev:up && pnpm dev` levanta API en `:3000` y Web en `:5173` (el CI clona limpio e instala/buildea/testea verde en cada push)
- [x] `GET /health` responde 200 (local)
- [x] `GET /docs` muestra Swagger (local)
- [x] CI corre verde en GitHub
- [x] Pre-commit rechaza código mal formateado (biome vía lint-staged en cada commit)

**Walking skeleton en producción:**

> Nota: la app se mudó del ápice a **`system.laradoc.com`** en el change `vps-multidominio` (2026-08-07); el ápice `laradoc.com` quedó como sitio informativo PHP.

- [x] `https://system.laradoc.com` responde con HTTPS válido (candado verde, sin warnings — cert propio de Let's Encrypt)
- [x] `https://system.laradoc.com/api/health` responde 200 con `{db: 'ok', redis: 'ok'}` desde el server productivo
- [x] Un push a `main` despliega automáticamente y se ve en producción en < 5 min (histórico ~2-4 min)
- [x] Smoke test post-deploy bloquea releases rotos (probado en combate real, 2026-08-12: una migración fallida abortó el deploy con rollback automático de `IMAGE_TAG`, cero downtime)
- [x] `certbot renew --dry-run` exitoso (los 3 lineages: laradoc.com, berrinchitosdent.com, system.laradoc.com)

**Cierre:**
- [x] Tag `v0.1.0-fase0` creado (en `c14ee9a`, 2026-08-12 — primer commit donde TODOS los checks son demostrablemente ciertos)

---

## Fase 1 — Multi-Tenant + Autenticación

> **Objetivo:** un tenant puede registrarse, sus usuarios pueden loguearse con seguridad robusta, y RLS garantiza aislamiento de datos. UI básica de login + onboarding + gestión de usuarios.

### Convención de módulos por dominio (codificada al abrir F1 — decisión `sellpoint/feature-modules-convention`)

**Backend (`apps/api`)**: cada dominio de negocio vive en `src/modules/{dominio}/` (controller, service, repository del dominio). Lo transversal queda donde está: `common/`, `infrastructure/`, `config/`, `i18n/`.

**Frontend (`apps/web`)**: 4 capas, cada una cambiable sin tocar las otras:
1. `components/ui/` — primitivas shadcn (variants con cva). NO atomic design completo (rechazado).
2. **Presentational** por feature: props → JSX puro, cero hooks de datos.
3. **Containers** finitos: conectan Query/stores/router, cero markup interesante.
4. `features/{dominio}/` — `components/`, `containers/`, `hooks/` (las Query viven acá), `api.ts`. El código grita negocio, no tecnología.

**Reglas duras**: ningún string de UI hardcodeado (todo por `t('dominio.clave')`); estilos por design tokens (theme vars en `index.css`); hexagonal NO aplica al front (container/presentational + hooks ES la separación).

**La primera feature de F1 es el molde de referencia** — ante la duda, copiá su estructura.

### Módulo F1-DB — Modelos Base

- [x] **F1-DB-01** — Modelo Prisma `Tenant`
  - **Salida:** modelo con `id`, `name`, `legal_name`, `tax_id`, `timezone`, `currency` (CHAR(3), default `MXN`, CHECK `IN ('MXN','USD')`), `onboarded`, timestamps
  - **Verificar:** migration aplica limpia; CHECK constraint rechaza valores no soportados
  - **Depende de:** F0-API-05
  - **Estimación:** 30 min

- [x] **F1-DB-02** — Modelo Prisma `User`
  - **Salida:** modelo con `id`, `tenant_id`, `email`, `password_hash`, `employee_number`, `first_name`, `last_name_paternal`, `last_name_maternal`, `status`, `locale` (CHAR(2), default `es`, CHECK `IN ('es','en')`), `email_verified_at`
  - **Verificar:** relación con Tenant, email único por tenant, CHECK constraint en locale
  - **Depende de:** F1-DB-01
  - **Estimación:** 30 min

- [x] **F1-DB-03** — Modelos `Role`, `Permission`, `UserRole`, `RolePermission`
  - **Salida:** modelos M:N completos
  - **Verificar:** queries M:N funcionan en Prisma Studio
  - **Depende de:** F1-DB-02
  - **Estimación:** 45 min

- [x] **F1-DB-04** — Modelo `RefreshToken`
  - **Salida:** modelo con `id`, `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at`, `used_at`
  - **Verificar:** índices en `family_id` y `token_hash`
  - **Depende de:** F1-DB-02
  - **Estimación:** 30 min

- [x] **F1-DB-05** — Modelo `EmailVerificationToken` y `PasswordResetToken`
  - **Salida:** tablas para tokens de un solo uso con TTL
  - **Verificar:** índices únicos
  - **Depende de:** F1-DB-02
  - **Estimación:** 30 min

- [x] **F1-DB-06** — Modelo `AuditLog`
  - **Salida:** modelo con `id`, `tenant_id`, `user_id`, `action`, `resource_type`, `resource_id`, `before`, `after`, `ip`, `user_agent`, `created_at`
  - **Verificar:** índices por `tenant_id` + `created_at`
  - **Depende de:** F1-DB-01
  - **Estimación:** 30 min

- [x] **F1-DB-07** — Migration inicial con todos los modelos
  - **Salida:** `pnpm prisma migrate dev --name init_auth` corre limpio
  - **Verificar:** todas las tablas existen en la DB
  - **Depende de:** F1-DB-01 a F1-DB-06
  - **Estimación:** 20 min

- [x] **F1-DB-08** — Activar RLS en tablas con `tenant_id`
  - **Salida:** migration SQL custom que ejecuta `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en todas las tablas con `tenant_id`
  - **Verificar:** `\d+ users` en psql muestra "Row security: enabled"
  - **Depende de:** F1-DB-07
  - **Estimación:** 1 h

- [x] **F1-DB-09** — Crear policy `tenant_isolation` por tabla
  - **Salida:** policies que filtran por `current_setting('app.tenant_id')::uuid`
  - **Verificar:** sin set_config, `SELECT * FROM users` devuelve 0 filas
  - **Depende de:** F1-DB-08
  - **Estimación:** 45 min

- [x] **F1-DB-10** — Seed con tenant demo + admin demo + roles base
  - **Salida:** `prisma/seed.ts` crea: tenant "Demo" (con `currency='MXN'`), user admin (con `locale='es'`) con password conocido, roles `TenantAdmin/Manager/POS_Seller/Viewer` con permisos
  - **Verificar:** `pnpm prisma db seed` corre, se puede loguear como admin demo
  - **Depende de:** F1-DB-09
  - **Estimación:** 1.5 h

---

### Módulo F1-LOCALE — Idioma por Usuario y Moneda por Tenant

> Habilita el modelo de i18n + multi-currency operacional. El setup base de librerías ya fue hecho en F0-I18N. Acá se agregan traducciones reales, middleware de resolución, validaciones y UI de cambio.

- [x] **F1-LOCALE-01** — Tabla `currencies` (maestra) + migration
  - **Salida:** tabla con `code` (PK), `symbol`, `decimals`, `name_es`, `name_en`, `is_active`. Seed inicial con MXN y USD.
  - **Verificar:** `SELECT * FROM currencies` devuelve 2 filas activas.
  - **Depende de:** F1-DB-10
  - **Estimación:** 30 min

- [x] **F1-LOCALE-02** — `LocaleResolverMiddleware`
  - **Salida:** middleware Nest que setea `req.locale` con cascada: `user.locale` (autenticado) → `Accept-Language` (soportado) → `DEFAULT_LOCALE` (`es`). Expone helper `getLocale(req)`.
  - **Verificar:** tests unitarios cubriendo las 3 ramas de la cascada.
  - **Depende de:** F0-I18N-03, F1-AUTH-06
  - **Estimación:** 1.5 h

- [x] **F1-LOCALE-03** — Integrar resolución de locale con `nestjs-i18n`
  - **Salida:** `I18nModule` configurado para tomar `locale` desde `req.locale` (custom resolver). Endpoints existentes (`/auth/login`, `/auth/forgot`) devuelven errores traducidos.
  - **Verificar:** login con credenciales inválidas devuelve `"Credenciales inválidas"` (es) o `"Invalid credentials"` (en) según el header.
  - **Depende de:** F1-LOCALE-02
  - **Estimación:** 1.5 h

- [x] **F1-LOCALE-04** — Traducciones base de auth (es + en)
  - **Salida:** `i18n/{es,en}/auth.json` y `errors.json` con todas las claves usadas en F1-AUTH: login, register, forgot, reset, suspended, unverified, locked, weak password. Mínimo ~15 claves.
  - **Verificar:** todos los mensajes de error de auth disponibles en ambos idiomas.
  - **Depende de:** F1-LOCALE-03
  - **Estimación:** 1 h

- [x] **F1-LOCALE-05** — Endpoint `PATCH /me` con campo `locale`
  - **Salida:** acepta `{ locale }` en el body, valida contra `SUPPORTED_LOCALES`, persiste en `users.locale`, devuelve user actualizado. Audit log.
  - **Verificar:** cambio refleja en DB; siguiente request del user usa el nuevo locale.
  - **Depende de:** F1-LOCALE-02
  - **Estimación:** 1 h

- [x] **F1-LOCALE-06** — Guard de cambio de currency post-onboarding
  - **Salida:** decorator `@TenantCurrencyChangeable` aplicado al endpoint de update de tenant. Verifica si el tenant tiene transacciones (futuro: productos con precio, ventas, movimientos). En F1 no hay transacciones aún, así que la verificación inicialmente siempre permite — pero el guard queda preparado con TODO comments para extenderlo en F2-F4.
  - **Verificar:** guard existe y se ejecuta; tests con mocks de "tenant con/sin transacciones".
  - **Depende de:** F1-DB-01
  - **Estimación:** 1 h

- [ ] **F1-LOCALE-07** — Selector de moneda en wizard de onboarding (Paso 1)
  - **Salida:** componente `<CurrencySelector>` en el paso 1 de `/onboarding`. Default MXN. Submit guarda `tenant.currency`. Mensaje de advertencia "no se puede cambiar después si registrás movimientos".
  - **Verificar:** tenant nuevo termina onboarding con su currency persistida.
  - **Depende de:** F1-WEB-ONBOARD-01, F1-LOCALE-01
  - **Estimación:** 1.5 h

- [ ] **F1-LOCALE-08** — Selector de idioma en `/profile` (Mi perfil)
  - **Salida:** componente `<LanguageSelector>` en sección "Preferencias" de `/profile`. Submit llama `PATCH /me { locale }`. Al recibir respuesta OK, refresca `i18next` con el nuevo locale sin reload.
  - **Verificar:** user cambia idioma; UI cambia inmediatamente; al recargar, el idioma persiste.
  - **Depende de:** F1-LOCALE-05, F0-I18N-04
  - **Estimación:** 1.5 h

- [x] **F1-LOCALE-09** — Detección inicial de `Accept-Language` al signup
  - **Salida:** en `/register`, el frontend lee `navigator.language`, normaliza a un locale soportado, y lo envía al backend como `locale` inicial del primer user. Si el browser está en `pt-BR`, cae a default `es`.
  - **Verificar:** signup desde browser en inglés crea user con `locale='en'`.
  - **Depende de:** F1-LOCALE-05
  - **Estimación:** 45 min

---

### Módulo F1-TENANT — Contexto de Tenant

> 🔌 **MCP al abrir este módulo:** instalar **Postgres MCP (read-only)** — inspección directa de schema y queries para verificar RLS y aislamiento multi-tenant sin pasar por Prisma. Ver `topic_key: decision/mcps-del-proyecto...` en engram.

- [x] **F1-TENANT-01** — `TenantContextMiddleware`
  - **Salida:** middleware Nest que resuelve `tenantId` del JWT y lo expone en el request (resolución + observabilidad). ⚠️ El `set_config` NO va en el middleware: con connection pooling puede aterrizar en otra conexión o filtrarse entre tenants (AD-1 del design de f1-auth) — el `set_config` real corre DENTRO de la transacción vía `PrismaService.withTenantContext` (F1-TENANT-02)
  - **Verificar:** logs muestran el tenant resuelto por request; el e2e de F1-TENANT-03 prueba el mecanismo completo
  - **Depende de:** F1-DB-09, F1-AUTH-06
  - **Estimación:** 1 h

- [x] **F1-TENANT-02** — `PrismaService` integrado con tenant context
  - **Salida:** servicio que usa una connection-per-request o aplica el `set_config` antes de cada query
  - **Verificar:** dos usuarios de tenants distintos no ven los datos del otro
  - **Depende de:** F1-TENANT-01
  - **Estimación:** 1.5 h

- [x] **F1-TENANT-03** — Test e2e que valida aislamiento RLS
  - **Salida:** test que crea 2 tenants, 1 user en cada uno, verifica que User A no ve datos de Tenant B
  - **Verificar:** test pasa
  - **Depende de:** F1-TENANT-02
  - **Estimación:** 1 h

---

### Módulo F1-AUTH — Autenticación

- [x] **F1-AUTH-01** — Script para generar par de claves RS256
  - **Salida:** `scripts/generate-keys.sh` que crea `apps/api/keys/jwt-private.pem` y `jwt-public.pem`
  - **Verificar:** `ssh-keygen -y` o `openssl rsa` valida los archivos
  - **Depende de:** F0-API-01
  - **Estimación:** 20 min

- [x] **F1-AUTH-02** — Servicio de hashing con Argon2id
  - **Salida:** `HashService` con `hash(password)` y `verify(password, hash)`
  - **Verificar:** unit test verifica que hash distinto en cada llamada pero `verify` devuelve true
  - **Depende de:** F0-API-01
  - **Estimación:** 30 min

- [x] **F1-AUTH-03** — `AuthService.registerTenant`
  - **Salida:** crea tenant + admin + asigna rol `TenantAdmin`, todo en transacción
  - **Verificar:** POST `/auth/register-tenant` crea las 4 filas
  - **Depende de:** F1-DB-10, F1-AUTH-02
  - **Estimación:** 1 h

- [x] **F1-AUTH-04** — Email service stub (consola en dev)
  - **Salida:** `EmailService` interface + implementación console en dev
  - **Verificar:** mandar email loguea el contenido a stdout
  - **Depende de:** F0-API-08
  - **Estimación:** 30 min

- [x] **F1-AUTH-05** — Endpoint y flujo de verificación de email
  - **Salida:** crear `EmailVerificationToken`, enviar link, endpoint `GET /auth/verify?token=...` activa usuario
  - **Verificar:** registro nuevo → token en DB → endpoint marca `email_verified_at`
  - **Depende de:** F1-AUTH-03, F1-AUTH-04, F1-DB-05
  - **Estimación:** 1.5 h

- [x] **F1-AUTH-06** — JWT access token RS256
  - **Salida:** servicio que firma JWT con clave privada, payload `{userId, tenantId, permissions}`
  - **Verificar:** unit test verifica firma y decodifica con clave pública
  - **Depende de:** F1-AUTH-01
  - **Estimación:** 1 h

- [x] **F1-AUTH-07** — `AuthService.login` con Argon2id + JWT
  - **Salida:** POST `/auth/login` valida credenciales, retorna access + setea cookie refresh
  - **Verificar:** login con credenciales válidas devuelve 200 + cookie; inválidas → 401
  - **Depende de:** F1-AUTH-02, F1-AUTH-06
  - **Estimación:** 1.5 h

- [x] **F1-AUTH-08** — Refresh token rotativo
  - **Salida:** crear `RefreshToken` con `family_id`, cookie `httpOnly+Secure+SameSite=Strict`
  - **Verificar:** cookie se setea, hash guardado en DB
  - **Depende de:** F1-AUTH-07
  - **Estimación:** 1 h

- [x] **F1-AUTH-09** — Endpoint `/auth/refresh` con detección de reuse
  - **Salida:** rota el refresh; si se intenta usar uno ya rotado, **invalida toda la familia**
  - **Verificar:** reusar un refresh viejo invalida todos los tokens del usuario
  - **Depende de:** F1-AUTH-08
  - **Estimación:** 1.5 h

- [x] **F1-AUTH-10** — `AuthService.logout`
  - **Salida:** POST `/auth/logout` revoca el refresh actual + limpia cookie
  - **Verificar:** después del logout, el refresh no funciona
  - **Depende de:** F1-AUTH-09
  - **Estimación:** 30 min

- [x] **F1-AUTH-11** — Forgot password
  - **Salida:** POST `/auth/forgot-password` crea token de un solo uso, manda email
  - **Verificar:** crea fila en `PasswordResetToken` con TTL 30 min
  - **Depende de:** F1-AUTH-04, F1-DB-05
  - **Estimación:** 45 min

- [x] **F1-AUTH-12** — Reset password
  - **Salida:** POST `/auth/reset-password` con token + nuevo password; invalida TODOS los refresh tokens del usuario
  - **Verificar:** password actualizado, sesiones anteriores invalidadas
  - **Depende de:** F1-AUTH-11
  - **Estimación:** 45 min

- [x] **F1-AUTH-13** — Throttling en `/auth/*` con `@nestjs/throttler` + Redis
  - **Salida:** 5 intentos / 15 min por IP, 10 / hora por email en login
  - **Verificar:** intentar 6 veces seguidas devuelve 429
  - **Depende de:** F1-AUTH-07, F0-DB-02
  - **Estimación:** 1 h

- [x] **F1-AUTH-14** — `JwtAuthGuard`
  - **Salida:** guard que valida el JWT en header `Authorization: Bearer`
  - **Verificar:** endpoint protegido devuelve 401 sin token, 200 con token válido
  - **Depende de:** F1-AUTH-06
  - **Estimación:** 45 min

- [x] **F1-AUTH-15** — Decorator `@CurrentUser()`
  - **Salida:** decorator que inyecta el payload del JWT en el handler
  - **Verificar:** `@CurrentUser() user: AuthUser` recibe `{userId, tenantId, ...}`
  - **Depende de:** F1-AUTH-14
  - **Estimación:** 30 min

- [x] **F1-AUTH-16** — Suite de tests e2e de auth
  - **Salida:** tests para register, verify, login, refresh, logout, forgot, reset
  - **Verificar:** `pnpm --filter api test:e2e` pasa
  - **Depende de:** F1-AUTH-01 a F1-AUTH-15
  - **Estimación:** 2 h

---

### Módulo F1-RBAC — Roles y Permisos

- [ ] **F1-RBAC-01** — `PermissionsGuard`
  - **Salida:** guard que valida que el JWT tenga los permisos del decorator
  - **Verificar:** endpoint protegido por `@RequirePermissions('users:manage')` rechaza usuario sin ese permiso
  - **Depende de:** F1-AUTH-14
  - **Estimación:** 1 h

- [ ] **F1-RBAC-02** — Decorator `@RequirePermissions(...permissions)`
  - **Salida:** decorator que setea metadata leída por el guard
  - **Verificar:** unit test del decorator
  - **Depende de:** F1-RBAC-01
  - **Estimación:** 20 min

- [ ] **F1-RBAC-03** — CRUD endpoints de usuarios
  - **Salida:** `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `POST /users/:id/suspend`, `POST /users/:id/reactivate`
  - **Verificar:** Swagger muestra todos, tests verifican RBAC
  - **Depende de:** F1-RBAC-02
  - **Estimación:** 2 h

- [ ] **F1-RBAC-04** — CRUD endpoints de roles
  - **Salida:** `POST /roles`, `GET /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`
  - **Verificar:** swap de permisos en un rol cambia los de todos sus usuarios
  - **Depende de:** F1-RBAC-02
  - **Estimación:** 1.5 h

- [ ] **F1-RBAC-05** — Endpoint lectura de permisos disponibles
  - **Salida:** `GET /permissions` devuelve lista agrupada por módulo
  - **Verificar:** frontend puede construir el editor de roles
  - **Depende de:** F1-RBAC-04
  - **Estimación:** 30 min

- [ ] **F1-RBAC-06** — Tests de RBAC
  - **Salida:** tests que verifican cada combinación de rol vs endpoint
  - **Verificar:** matriz de permisos cubierta
  - **Depende de:** F1-RBAC-03, F1-RBAC-04
  - **Estimación:** 1.5 h

---

### Módulo F1-SCOPE — Warehouse Scoping (preparación)

> Las tablas de warehouses no existen aún (vienen en F2). Acá dejamos preparada la lógica de scoping.

- [ ] **F1-SCOPE-01** — Modelo Prisma `UserWarehouseScope`
  - **Salida:** tabla con `user_id`, `warehouse_id`, `tenant_id`, PK compuesta
  - **Verificar:** migration aplica (warehouse_id sin FK aún)
  - **Depende de:** F1-DB-07
  - **Estimación:** 20 min

- [ ] **F1-SCOPE-02** — Activar RLS en `user_warehouse_scopes`
  - **Salida:** policy `tenant_isolation`
  - **Verificar:** sin set_config no devuelve filas
  - **Depende de:** F1-SCOPE-01, F1-DB-09
  - **Estimación:** 15 min

- [ ] **F1-SCOPE-03** — `WarehouseScopeMiddleware`
  - **Salida:** middleware que carga `warehouseIds` accesibles del usuario en `req.scope`
  - **Verificar:** unit test verifica que TenantAdmin bypass, otros roles filtran
  - **Depende de:** F1-SCOPE-02, F1-TENANT-01
  - **Estimación:** 1 h

- [ ] **F1-SCOPE-04** — Decorator `@CurrentUserScope()`
  - **Salida:** inyecta `{warehouseIds: string[] | 'all'}` en el handler
  - **Verificar:** `@CurrentUserScope() scope` recibe el valor correcto
  - **Depende de:** F1-SCOPE-03
  - **Estimación:** 30 min

---

### Módulo F1-WEB-AUTH — UI de Autenticación

- [ ] **F1-WEB-AUTH-01** — Auth store con Zustand
  - **Salida:** `useAuthStore` con `accessToken`, `user`, `setAuth`, `clearAuth`
  - **Verificar:** estado persiste durante navegación, no en localStorage
  - **Depende de:** F0-WEB-08
  - **Estimación:** 30 min

- [ ] **F1-WEB-AUTH-02** — Axios interceptor de refresh automático
  - **Salida:** en respuesta 401, intenta `/auth/refresh`, si OK reintenta la request original
  - **Verificar:** test manual con access token expirado refresca y reintenta
  - **Depende de:** F1-WEB-AUTH-01, F1-AUTH-09
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-AUTH-03** — Página `/login`
  - **Salida:** form con email + password, validación con Zod + React Hook Form, llama a `/auth/login`
  - **Verificar:** login exitoso navega a `/dashboard`
  - **Depende de:** F1-WEB-AUTH-02, F1-AUTH-07
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-AUTH-04** — Página `/register`
  - **Salida:** form de registro de tenant con validación de password en vivo
  - **Verificar:** registro exitoso muestra "revisa tu email"
  - **Depende de:** F1-WEB-AUTH-03, F1-AUTH-03
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-AUTH-05** — Página `/verify`
  - **Salida:** lee token de URL, llama API, muestra éxito o error
  - **Verificar:** flujo completo desde registro hasta verificación
  - **Depende de:** F1-AUTH-05
  - **Estimación:** 45 min

- [ ] **F1-WEB-AUTH-06** — Página `/forgot-password`
  - **Salida:** form simple con email
  - **Verificar:** request a API funciona, muestra "revisa tu email"
  - **Depende de:** F1-AUTH-11
  - **Estimación:** 30 min

- [ ] **F1-WEB-AUTH-07** — Página `/reset-password`
  - **Salida:** form con nuevo password (token de URL)
  - **Verificar:** reset exitoso navega a login
  - **Depende de:** F1-AUTH-12
  - **Estimación:** 45 min

- [ ] **F1-WEB-AUTH-08** — Componente `ProtectedRoute`
  - **Salida:** wrapper que redirige a `/login` si no hay sesión
  - **Verificar:** ir a `/dashboard` sin login redirige a `/login`
  - **Depende de:** F1-WEB-AUTH-01
  - **Estimación:** 30 min

- [ ] **F1-WEB-AUTH-09** — Layout autenticado (sidebar + header)
  - **Salida:** `AppLayout` con sidebar colapsable y header con menú usuario
  - **Verificar:** se ve el layout en `/dashboard`, sidebar funciona
  - **Depende de:** F1-WEB-AUTH-08
  - **Estimación:** 2 h

- [ ] **F1-WEB-AUTH-10** — Página `/profile` (perfil básico)
  - **Salida:** muestra datos del usuario + form de cambiar password + sesiones activas (lista)
  - **Verificar:** cambio de password cierra otras sesiones
  - **Depende de:** F1-WEB-AUTH-09
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-AUTH-11** — Logout
  - **Salida:** botón en header llama `/auth/logout`, limpia store, navega a `/login`
  - **Verificar:** después de logout, refresh no funciona
  - **Depende de:** F1-WEB-AUTH-09, F1-AUTH-10
  - **Estimación:** 20 min

---

### Módulo F1-WEB-USERS — UI de Gestión de Usuarios

- [ ] **F1-WEB-USERS-01** — Página `/system/users` — lista
  - **Salida:** tabla con TanStack Table, paginación server-side, búsqueda
  - **Verificar:** lista de usuarios del tenant visible
  - **Depende de:** F1-RBAC-03, F1-WEB-AUTH-09
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-USERS-02** — Form crear usuario (modal o página)
  - **Salida:** form completo con validación, envía invitación
  - **Verificar:** crear usuario lo agrega a la lista, envía email
  - **Depende de:** F1-WEB-USERS-01
  - **Estimación:** 1.5 h

- [ ] **F1-WEB-USERS-03** — Form editar usuario
  - **Salida:** misma UI que crear, precargada
  - **Verificar:** cambios persisten
  - **Depende de:** F1-WEB-USERS-02
  - **Estimación:** 45 min

- [ ] **F1-WEB-USERS-04** — Acciones: suspender / reactivar / reenviar invitación / reset password
  - **Salida:** menú `⋮` en cada fila con estas opciones
  - **Verificar:** cada acción funciona end-to-end
  - **Depende de:** F1-WEB-USERS-03
  - **Estimación:** 1 h

- [ ] **F1-WEB-USERS-05** — Página `/system/roles` — lista y editor de permisos
  - **Salida:** sidebar con roles + checklist de permisos a la derecha
  - **Verificar:** modificar permisos persiste, aplica en próxima request del usuario
  - **Depende de:** F1-RBAC-04, F1-RBAC-05
  - **Estimación:** 2 h

---

### Módulo F1-WEB-ONBOARD — Wizard de Onboarding

- [ ] **F1-WEB-ONBOARD-01** — Step 1: datos del negocio
  - **Salida:** form con razón social, RFC/RUT, dirección, zona horaria
  - **Verificar:** datos persisten en `Tenant`
  - **Depende de:** F1-WEB-AUTH-05
  - **Estimación:** 1 h

- [ ] **F1-WEB-ONBOARD-02** — Step 2: placeholder de schema (se completa en F2)
  - **Salida:** pantalla con plantillas pero solo "elegir" sin editor aún
  - **Verificar:** decisión guardada en `Tenant.template_choice` (temporal)
  - **Depende de:** F1-WEB-ONBOARD-01
  - **Estimación:** 30 min

- [ ] **F1-WEB-ONBOARD-03** — Step 3: placeholder de primer almacén (se completa en F2)
  - **Salida:** pantalla skip con mensaje "lo haremos en el siguiente paso"
  - **Verificar:** continuar funciona
  - **Depende de:** F1-WEB-ONBOARD-02
  - **Estimación:** 20 min

- [ ] **F1-WEB-ONBOARD-04** — Step 4: invitar usuarios
  - **Salida:** UI para mandar invitaciones por email (multi)
  - **Verificar:** invitaciones llegan
  - **Depende de:** F1-WEB-ONBOARD-03, F1-WEB-USERS-02
  - **Estimación:** 1 h

- [ ] **F1-WEB-ONBOARD-05** — Marcar `Tenant.onboarded = true` al finalizar
  - **Salida:** endpoint + redirect a `/dashboard`
  - **Verificar:** próximos logins van directo a dashboard, no a wizard
  - **Depende de:** F1-WEB-ONBOARD-04
  - **Estimación:** 30 min

---

### ✅ Definición de "Fase 1 completa"

- [ ] Un visitante puede registrarse, verificar email, hacer login
- [ ] Dos tenants distintos NO ven los datos del otro (test e2e que lo prueba)
- [ ] El refresh token rota correctamente y detecta reuse
- [ ] Reset de password invalida todas las sesiones
- [ ] El TenantAdmin puede crear usuarios, asignarles roles, suspenderlos
- [ ] El TenantAdmin puede crear roles custom y asignar permisos granulares
- [ ] La UI tiene login, registro, recuperación, layout autenticado, usuarios, roles, perfil
- [ ] Throttling activo en `/auth/*`
- [ ] Cobertura de tests > 70% en `apps/api/src/modules/auth` y `users`
- [ ] Tag `v0.2.0-fase1` creado

---

## Fase 2 — Catálogos Dinámicos + UOM + BOM (outline)

> Atomizamos cuando lleguemos. Esta fase **incluye productos compuestos / BOM + stock decimal + presentaciones desde el core** (motivado por cliente cafetería comprometido). Ver [ARQUITECTURA.md § 3.5](ARQUITECTURA.md#35-modelo-de-productos-unidades-presentaciones-y-composición-bom).

### Hitos macro

- **F2-UOM** — Tabla `units` (catálogo global de unidades de medida) + seed inicial (`unit`, `ml`, `l`, `gr`, `kg`, `m`, `cm`, `oz`, `lb`). Helper de conversiones dentro de la misma categoría (`l↔ml`, `kg↔gr`, etc.). Tipo `Unit` en `packages/shared`.

- **F2-DB** — Modelos:
  - `Warehouse`
  - `ProductSchema` (con versionado)
  - `Product` con columnas `base_unit` (FK a `units.code`), `is_composite` (bool denormalizado para queries rápidas)
  - `ProductPresentation` (`product_id`, `name`, `factor` DECIMAL(14,4), `is_purchasable`, `is_sellable`, `is_default_sale`, **`allow_fractional_input` BOOLEAN** (default derivado de la categoría de `base_unit`: `count` → false, otras → true), `barcode` unique nullable, `price`, `cost`)
  - `ProductComposition` (`parent_product_id`, `ingredient_product_id`, `quantity` DECIMAL(14,4), `waste_percentage`, unique pair, CHECK parent≠ingredient)
  - `StockByWarehouse` con `quantity DECIMAL(14,4)` (NO integer)

- **F2-WH** — CRUD almacenes (API + UI).

- **F2-SCHEMA** — Editor visual de schema, versionado, validación de migración.

- **F2-PROD** — CRUD productos con validación Ajv + selector de `base_unit` + toggle `is_composite` en el form. Búsqueda full-text en SKU, nombre, atributos JSONB, y **barcodes de cualquier presentación**.

- **F2-PRESENT** — Módulo de presentaciones (API + UI inline en el tab "Presentaciones" del producto):
  - Tabla editable inline: agregar/editar/eliminar presentaciones
  - Validaciones: factor > 0, nombre único por producto, barcode único por tenant, default exclusivo (radio)
  - **Toggle `allow_fractional_input`** con default derivado server-side de la categoría de `base_unit` del producto (count → false, volume/weight/length → true). Editable manualmente como override.
  - Bloqueo de eliminación si hay ventas históricas que la referencian → opción "Marcar como inactiva"

- **F2-BOM** — Módulo de recetas (API + UI inline en el tab "Receta" del producto compuesto):
  - Tabla editable inline: agregar ingredientes con autocompletado del catálogo
  - Unidad pre-cargada (no editable) desde `base_unit` del ingrediente seleccionado
  - Endpoint `GET /products/:id/availability` que calcula `min(stock_i / qty_i)` para todos los ingredientes y devuelve porciones posibles + ingrediente limitante
  - Endpoint `GET /products/:id/cost-estimate` que calcula costo de la receta sumando `cost_promedio × quantity`
  - Validación **anti-recursión** en backend con DFS sobre el grafo de composiciones (un producto no puede ser ingrediente de sí mismo, ni directa ni indirectamente)
  - UI sin wizards, sin pasos, sin drag-and-drop — **tabla simple + picker**

- **F2-IMPORT** — Importación masiva desde Excel con reporte de errores. Plantilla incluye columnas para productos + columnas para presentaciones (separadas por `|` o en hoja aparte). Recetas se importan en una hoja distinta del Excel con referencias por SKU.

- **F2-SCOPE** — Cablear `user_warehouse_scopes` con los almacenes reales (preparado en F1).

- **F2-ONBOARD** — Completar steps 2 y 3 del wizard (template de schema + primer almacén).

**Estimación: 3-4 semanas** (era 2). **Atomizar cuando F1 esté ✅.**

---

## Fase 3 — Movimientos de Inventario (outline)

> **Modelo unificado:** 2 movimientos directos (Entrada Directa / Salida Directa) con campo `reason_code`. Traspaso = proceso de 2 pasos con confirmación + estado `in_transit` visible. Inventario físico es caso especial separado.

- **F3-DB** — Modelos:
  - `StockMovement` con columnas: `direction` (entry|exit), `reason_code`, `reason_note`, `linked_warehouse_id` (NULL salvo transfer), `transfer_id` (NULL salvo transfer), `quantity` **DECIMAL(14,4)** (NO integer — soporta fracciones ml/gr/m), `unit_cost` (NULL salvo invoice), `presentation_id` (NULL si fue ingreso/egreso en base_unit puro; si vino de una presentación se referencia para auditoría), `product_id`, `warehouse_id`, `created_by`, `created_at`. Append-only.
  - `StockByWarehouse` (`product_id`, `warehouse_id`, `quantity` **DECIMAL(14,4)**) — actualizada en cada movimiento. **NO se persiste para productos compuestos** (`is_composite=true`): su stock se calcula en vivo desde los ingredientes.
  - `Transfer` con `id`, `folio`, `tenant_id`, `origin_warehouse_id`, `destination_warehouse_id`, `status` (in_transit|completed|canceled), `created_by`, `created_at`, `received_by`, `received_at`, `canceled_by`, `canceled_at`, `cancel_reason`, `discrepancies` JSONB (líneas con diferencia).
  - `TransferLine` con `transfer_id`, `product_id`, `quantity_sent`, `quantity_received` (NULL hasta confirmación).
  - Enum SQL para `reason_code`: `invoice | adjustment | transfer | customer_return | production | loss | consumption | expired | physical_count`.

- **F3-ENTRY** — Endpoint `POST /inventory/entries` + UI única "Nueva Entrada Directa":
  - Acepta `{warehouse_id, reason_code, reason_note, linked_warehouse_id?, transfer_id?, lines[]}`. Cada línea: `{product_id, presentation_id?, quantity}` — si `presentation_id` viene, el sistema convierte a base_unit (`quantity × presentation.factor`) antes de persistir.
  - **Validación de fracciones**: si `presentation.allow_fractional_input = false`, el backend rechaza si `quantity % 1 !== 0` con error 422 y mensaje claro (`"La presentación '${name}' solo acepta cantidades enteras"`).
  - Validaciones contextuales según `reason_code` (factura requiere `unit_cost`, transfer requiere `linked_warehouse_id`, etc.).
  - Validación: no se puede crear entrada directa para producto **compuesto** (`is_composite=true`) — su stock se calcula desde ingredientes, no se carga directo. Excepción: `reason_code='production'` (preparar lote de compuesto), que genera salidas de ingredientes + entrada del compuesto auditada.
  - Si `reason_code='transfer'` y `transfer_id` presente: cierra el Transfer (status='completed', registra `quantity_received` por línea, calcula discrepancias).
  - UI con campos reactivos según motivo elegido + selector de presentación por línea.

- **F3-EXIT** — Endpoint `POST /inventory/exits` + UI única "Nueva Salida Directa":
  - Acepta `{warehouse_id, reason_code, reason_note, linked_warehouse_id?, lines[]}`. Línea: `{product_id, presentation_id?, quantity}` con conversión a base_unit.
  - **Validación de fracciones**: idéntica a F3-ENTRY — rechaza decimales si la presentación no los permite.
  - Validación de stock disponible (FOR UPDATE para evitar oversell en concurrencia).
  - **Productos compuestos en salida**: si se intenta dar salida de un compuesto (típicamente `reason='consumption'` o `expired`), el sistema expande la receta y genera N salidas de ingredientes en transacción atómica.
  - Si `reason_code='transfer'`: crea `Transfer` con status='in_transit', `TransferLine` por línea con `quantity_sent`, `linked_warehouse_id` apunta a destino.
  - UI con campos reactivos según motivo + validación en vivo de stock + selector de presentación.

- **F3-TRANSFER** — Endpoint `GET /transfers` (con filtros: pendientes_recibir, pendientes_enviar, por almacén, antigüedad) + Endpoint `POST /transfers/:id/cancel` (solo TenantAdmin, requiere justificación) + UI "Traspasos en Tránsito":
  - Dos tabs (pendientes de recibir, pendientes de enviar) según scope del usuario.
  - Modal de confirmación de recepción (dispara `POST /inventory/entries` con `reason_code='transfer'` y `transfer_id`).
  - Validación: cantidad recibida > enviada → bloqueado con mensaje accionable.
  - Badge naranja para traspasos > 7 días en tránsito.

- **F3-INVENTORY** — Inventario físico (Excel + reconciliación) — caso especial con `reason_code='physical_count'`.

- **F3-KARDEX** — Endpoint `GET /products/:id/kardex` + UI con filtros por almacén, rango fechas, dirección, motivo.

- **F3-REPORT-TRANSIT** — Reporte de stock en tránsito (cantidad total por producto que no está en ningún almacén consolidado).

- **F3-AUDIT** — Audit log integrado en cada movimiento + entradas detalladas para discrepancias de traspasos (alta sensibilidad para auditorías).

**Estimación:** 2-3 semanas. **Atomizar cuando F2 esté ✅.**

---

## Fase 4 — POS PWA (outline)

- **F4-DB** — Modelos `Sale`, `SaleItem` (con `product_id`, `presentation_id`, `quantity` DECIMAL, `unit_price`, `discount`), `CashboxSession`. **Reservar columnas nullable `Sale.clinical_document_id` y `Sale.quote_id`** para vincular ventas a documentos clínicos o cotizaciones cuando llegue Fase 9 (NO crear las tablas ahora, solo las FK nullable).
- **F4-API** — Endpoints venta, anulación, cierre. La anulación de una venta de producto compuesto **revierte el descuento de ingredientes** (entradas de reverso con `reason_code='customer_return'`).
- **F4-UI** — Pantalla principal de venta optimizada para tablet.
- **F4-SCAN** — Integración escáner cámara (@zxing/browser). El barcode escaneado busca primero en `product_presentations.barcode` (si matchea, agrega esa presentación) y solo si no, en `products.barcode` (legacy).
- **F4-CART** — Carrito con búsqueda predictiva. **Diseñar el "input principal" del POS como extensible** con strategy pattern: `SkuLookup`, `BarcodeLookup`, `TextSearchLookup` — para que agregar `PrescriptionLookup` y `QuoteLookup` en Fase 9 sea trivial. **Selector de presentación al agregar producto:** si tiene N presentaciones vendibles, mostrar selector inline; la marcada `is_default_sale` viene pre-seleccionada.
- **F4-NUMPAD** — Numpad inteligente: oculta el botón `.` cuando la presentación elegida tiene `allow_fractional_input = false`. Maneja paste/keyboard: si recibe input con punto en presentación entera, trunca y muestra hint inline ("Solo enteros"). El backend revalida igualmente (defense in depth).
- **F4-COMPOSITE** — Lógica de venta de productos compuestos:
  - El compuesto se ve y suma al carrito como cualquier producto. Su stock visible es el calculado en vivo: `min(stock_ingrediente_i / qty_i)`.
  - Al COBRAR, el sistema expande la receta de cada línea compuesta y genera N `stock_movements` de salida por ingrediente en **transacción atómica**.
  - Si CUALQUIER ingrediente no tiene stock suficiente → falla la venta entera con mensaje claro (qué ingrediente falta, cuántas porciones son posibles).
  - El recibo muestra el producto compuesto (no los ingredientes — el cliente no necesita saber que su latte llevó 18 gr de café).
- **F4-CHECKOUT** — Modal de cobro (efectivo, tarjeta, transferencia).
- **F4-PRINT-DESKTOP** — Impresión via `window.print` + CSS @page.
- **F4-PRINT-BT** — Impresión Web Bluetooth (ESC/POS).
- **F4-CASHBOX** — Cierre de caja.
- **F4-PWA** — Service worker, offline básico, manifest completo.

**Estimación:** 3 semanas.

---

## Fase 5 — Reportes (outline)

- **F5-API** — Endpoints de reportes con paginación server-side y filtros
- **F5-EXPORT** — Generación Excel (síncrono y asíncrono con cola Redis)
- **F5-UI-HUB** — Pantalla hub de reportes
- **F5-UI-STOCK** — Reporte de stock por almacén
- **F5-UI-CATALOG** — Reporte de catálogo
- **F5-UI-SALES** — Reporte de ventas
- **F5-UI-KARDEX** — Reporte de kardex detallado
- **F5-UI-USERS** — Reporte de usuarios

**Estimación:** 1-2 semanas.

---

## Fase 6 — Hardening de Producción (outline)

> **Nota:** el deploy básico (walking skeleton) ya está hecho en **F0-DEPLOY** y funcionando desde el día uno. Esta fase **endurece** la infra existente: pasa de "está corriendo" a "está listo para clientes reales".

- **F6-SECRETS** — Migrar de `.env` en disco a un gestor de secretos (a decidir: sops/age o Infisical — Parameter Store descartado al salir de AWS, ver decisión deploy-vultr); rotación de claves JWT
- **F6-BACKUPS** — Endurecer el backup de F0 (cifrado del dump, alerting si el cron falla; el básico a R2 ya corre desde F0-DEPLOY-13)
- **F6-RESTORE-DRILL** — Probar end-to-end el restore desde backup; documentar RTO/RPO
- **F6-LOGS** — Destino de logs a decidir (CloudWatch descartado al salir de AWS → Loki self-hosted o similar); retención + alertas básicas
- **F6-ROLLBACK-DRILL** — Ejercitar la rama de rollback de deploy.yml con un fallo inducido (herencia de F0: nunca corrió en real; hacerlo ANTES del primer dato de cliente) — verify W3
- **F6-GHCR-RETENTION** — Retención de imágenes en GHCR (actions/delete-package-versions); hoy crecen sin techo — verify W4
- **F6-CF-PROXY** — Decidir Cloudflare naranja vs gris: hoy naranja funciona (ACME verificado atravesando CF) pero el origen sigue alcanzable por IP y una renovación fallida de cert sería silenciosa; evaluar Origin Certificate de CF (15 años) + Authenticated Origin Pulls + alerting de renovación — verify W7
- **F6-SENTRY** — Sentry frontend + backend con `@sentry/nestjs`, source maps subidos en CI
- **F6-HEADERS** — Cabeceras de seguridad endurecidas: CSP estricta, HSTS preload, X-Frame-Options, Permissions-Policy
- **F6-DOCKER-HARDEN** — Imágenes productivas: multi-stage, non-root user, scan con Trivy en CI
- **F6-RATE-LIMIT-NGINX** — Rate limiting a nivel Nginx (defensa en profundidad sobre el throttler de Nest)
- **F6-FAIL2BAN-CUSTOM** — Reglas custom de fail2ban para abuso de `/auth/*`
- **F6-UPTIME** — Healthcheck externo (UptimeRobot o equivalente) con alertas a email/Slack
- **F6-RUNBOOK** — Documento de operaciones: deploy, rollback rápido, restore, troubleshooting, contactos
- **F6-DR** — Plan de disaster recovery: snapshots EBS automáticos, runbook de recuperación
- **F6-COSTS** — Setup de alertas de costos en AWS Billing

**Estimación:** 1 semana.

---

## Fase 7 — Planes + Billing + Suscripciones

> **Objetivo:** habilitar monetización del SaaS. Planes (Chica/Mediana/Empresa), suscripciones mensuales/anuales, pagos con Stripe (vía adapter pattern), límites por plan, trial de 14 días sin tarjeta, grace period de 7 días, dunning automático. Facturación fiscal (CFDI/SAT) **fuera de scope MVP** — se integra después con Facturapi cuando lo pida el primer cliente.
>
> 🔌 **MCP al abrir esta fase:** instalar **Stripe MCP oficial** (API de Stripe: products, prices, subscriptions, webhooks de prueba). Ver `topic_key: decision/mcps-del-proyecto...` en engram.

### Defaults confirmados

| Decisión | Valor |
|---|---|
| Pasarela | Stripe (vía `PaymentGatewayPort` con adapter pattern) |
| Moneda | MXN (hardcoded; multi-moneda futuro) |
| Trial | 14 días sin tarjeta |
| Dimensiones del plan | `max_users`, `max_warehouses`, `features` (JSONB de flags) |
| Comportamiento al límite | Hard block + modal "Mejorá tu plan" |
| Pricing | `price_monthly_cents` + `price_annual_cents` (anual ~17% descuento) |
| Pago fallido | Grace 7 días → read-only |
| Downgrade con exceso | Bloqueado con mensaje "Desactivá X usuarios primero" |
| Cambio mid-cycle | Prorating automático de Stripe |
| Cancelación | Al final del período (reactivable durante grace) |
| Facturación fiscal | Fuera de scope MVP. Recibos no fiscales (PDF Stripe). |
| Refunds | Manual desde Stripe Dashboard |

### Pre-requisitos a dejar listos en fases anteriores

Aunque Fase 7 va al final, estas piezas **deben estar preparadas** para que la integración sea suave:

- **F1-AUTH** debe persistir `tenant.created_at` (necesario para "grandfathered plan" de tenants beta).
- **F1-RBAC** debe permitir guards componibles (ej: `@Roles('TenantAdmin') @CheckLimit('max_users')`).
- Al lanzar Fase 7, **se agregará el guard `@CheckLimit` en endpoints existentes** (crear usuario, crear almacén). Esto queda anotado en la Bitácora cuando se ejecute (entrada formal por ser cambio retroactivo a tareas ya cerradas).

---

### Módulo F7-PLAN — Definición de Planes

- [ ] **F7-PLAN-01** — Schema `plans` y migration
  - **Salida:** tabla `plans` con: `id`, `code` (chica|mediana|empresa), `name`, `max_users`, `max_warehouses`, `features` JSONB, `price_monthly_cents`, `price_annual_cents`, `currency`, `is_active`, `stripe_product_id`, `stripe_price_monthly_id`, `stripe_price_annual_id`, `created_at`, `updated_at`. Migration aplicada.
  - **Verificar:** `prisma migrate dev` ok; tabla existe en DB local.
  - **Depende de:** —
  - **Estimación:** 30 min

- [ ] **F7-PLAN-02** — Seed de 3 planes default (Chica/Mediana/Empresa)
  - **Salida:** seed con planes: Chica (3 usuarios, 1 almacén, $499 MXN/mes), Mediana (10 usuarios, 5 almacenes, $1499 MXN/mes), Empresa (50 usuarios, 20 almacenes, $4999 MXN/mes). Precios anuales con ~17% descuento (2 meses gratis).
  - **Verificar:** `pnpm db:seed` deja 3 planes activos.
  - **Depende de:** F7-PLAN-01
  - **Estimación:** 30 min

- [ ] **F7-PLAN-03** — Sincronizar planes con Stripe Products/Prices
  - **Salida:** script `pnpm sync:stripe-plans` que crea/actualiza un `Product` + 2 `Price` (mensual y anual) en Stripe por cada plan local; persiste IDs en columnas `stripe_*` de `plans`. Idempotente.
  - **Verificar:** dashboard de Stripe muestra los 3 productos con 2 precios cada uno; DB tiene los IDs.
  - **Depende de:** F7-PLAN-02, F7-STRIPE-01
  - **Estimación:** 1.5 h

- [ ] **F7-PLAN-04** — Endpoint `GET /plans` (público)
  - **Salida:** controller que devuelve planes activos con precios, features y límites. Sin auth requerida (para la landing).
  - **Verificar:** curl devuelve los 3 planes con shape esperado.
  - **Depende de:** F7-PLAN-02
  - **Estimación:** 30 min

- [ ] **F7-PLAN-05** — CRUD de Planes (SuperAdmin)
  - **Salida:** endpoints `POST/PUT/DELETE /admin/plans` con guard `@Roles('SuperAdmin')`. La edición sincroniza con Stripe automáticamente.
  - **Verificar:** SuperAdmin crea plan nuevo y aparece en Stripe.
  - **Depende de:** F7-PLAN-03
  - **Estimación:** 2 h

- [ ] **F7-PLAN-06** — Soft-delete y protección de planes con suscripciones
  - **Salida:** no permitir borrar plan con suscripciones activas; en lugar de DELETE, hacer soft-delete (`is_active=false`). Tests unitarios.
  - **Verificar:** intento de borrar plan con suscripciones falla con 409.
  - **Depende de:** F7-PLAN-05
  - **Estimación:** 1 h

---

### Módulo F7-SUB — Suscripciones

- [ ] **F7-SUB-01** — Schema `subscriptions` y migration
  - **Salida:** tabla `subscriptions` con: `id`, `tenant_id` (unique), `plan_id`, `status` (trial|active|past_due|canceled|paused), `billing_cycle` (monthly|annual), `current_period_start`, `current_period_end`, `trial_end`, `canceled_at`, `cancel_at_period_end` bool, `grace_period_end`, `gateway_subscription_id`, `gateway_customer_id`. RLS por `tenant_id`.
  - **Verificar:** migration ok; RLS activa; index en `gateway_subscription_id`.
  - **Depende de:** F7-PLAN-01
  - **Estimación:** 45 min

- [ ] **F7-SUB-02** — Schema `webhook_events` para idempotency
  - **Salida:** tabla `webhook_events` con `gateway`, `event_id` (unique), `event_type`, `payload` JSONB, `processed_at`, `error`.
  - **Verificar:** migration ok; índice unique en (`gateway`, `event_id`).
  - **Depende de:** —
  - **Estimación:** 20 min

- [ ] **F7-SUB-03** — `SubscriptionService` (lectura)
  - **Salida:** método `getCurrentSubscription(tenantId)` que devuelve suscripción del tenant con plan asociado (JOIN). Cache opcional vía Redis.
  - **Verificar:** unit test con factory.
  - **Depende de:** F7-SUB-01
  - **Estimación:** 1 h

- [ ] **F7-SUB-04** — Crear trial automático al registrar tenant
  - **Salida:** hook que, al crearse un `Tenant` nuevo, crea una `Subscription` con `status='trial'`, `trial_end = now() + 14 days`, asignada al plan Chica por default. Atómico con la creación del tenant.
  - **Verificar:** registrar tenant nuevo y ver subscription en DB.
  - **Depende de:** F7-SUB-01, F7-ONBOARD-01
  - **Estimación:** 1 h

- [ ] **F7-SUB-05** — `SubscriptionStateGuard` global
  - **Salida:** guard global que bloquea acceso a la API si `subscription.status='canceled'` o si `status='past_due'` y `now() > grace_period_end`. Devuelve 402 Payment Required con metadata. Whitelist de endpoints de billing (para que puedan pagar/reactivar).
  - **Verificar:** request de tenant cancelado retorna 402; request de tenant en grace retorna 200 con header `X-Billing-Warning`.
  - **Depende de:** F7-SUB-03
  - **Estimación:** 2 h

- [ ] **F7-SUB-06** — Endpoint `GET /me/subscription`
  - **Salida:** devuelve plan actual, status, próxima fecha de cobro, monto, métodos de pago, días restantes de trial/grace.
  - **Verificar:** TenantAdmin ve su suscripción; otros roles ven versión limitada (sin métodos de pago).
  - **Depende de:** F7-SUB-03
  - **Estimación:** 1 h

- [ ] **F7-SUB-07** — Endpoint `POST /me/subscription/change-plan`
  - **Salida:** acepta `{plan_id, billing_cycle}`; valida que el nuevo plan acepte los recursos actuales (usuarios, almacenes). Si excede, retorna 422 con detalle. Si ok, llama a Stripe con `proration_behavior='create_prorations'`.
  - **Verificar:** TenantAdmin upgradea de Chica a Mediana; Stripe refleja cambio; webhook actualiza DB.
  - **Depende de:** F7-SUB-06, F7-STRIPE-04
  - **Estimación:** 2 h

- [ ] **F7-SUB-08** — Endpoints `POST /me/subscription/cancel` y `/reactivate`
  - **Salida:** cancel marca `cancel_at_period_end=true` en Stripe (no inmediato); reactivate lo revierte si está dentro del período activo.
  - **Verificar:** TenantAdmin cancela; sigue activo hasta fin de período; puede reactivar.
  - **Depende de:** F7-SUB-06, F7-STRIPE-04
  - **Estimación:** 1.5 h

---

### Módulo F7-LIMIT — Límites por Plan

- [ ] **F7-LIMIT-01** — `PlanLimitsService`
  - **Salida:** servicio con métodos: `getLimit(tenantId, dimension)`, `getCurrentUsage(tenantId, dimension)`, `canCreate(tenantId, dimension)`. Soporta `max_users` y `max_warehouses`.
  - **Verificar:** unit tests con casos: bajo límite, en el límite, sobre el límite.
  - **Depende de:** F7-SUB-03
  - **Estimación:** 2 h

- [ ] **F7-LIMIT-02** — Decorador `@CheckLimit(dimension)`
  - **Salida:** decorator + interceptor de Nest que, antes del handler, llama `canCreate`; si false, lanza `PlanLimitExceededException` (HTTP 422 con `code=PLAN_LIMIT_EXCEEDED` + detalle).
  - **Verificar:** endpoint dummy con `@CheckLimit('max_users')` bloquea cuando se excede.
  - **Depende de:** F7-LIMIT-01
  - **Estimación:** 1.5 h

- [ ] **F7-LIMIT-03** — Integrar `@CheckLimit('max_users')` en `POST /users`
  - **Salida:** decorator agregado al endpoint de crear usuario (creado en F1). **Entrada formal en Bitácora** por ser modificación retroactiva.
  - **Verificar:** tenant en plan Chica con 3 usuarios no puede crear el cuarto.
  - **Depende de:** F7-LIMIT-02
  - **Estimación:** 30 min

- [ ] **F7-LIMIT-04** — Integrar `@CheckLimit('max_warehouses')` en `POST /warehouses`
  - **Salida:** decorator en endpoint de crear almacén. Entrada en Bitácora.
  - **Verificar:** tenant plan Chica con 1 almacén no puede crear el segundo.
  - **Depende de:** F7-LIMIT-02
  - **Estimación:** 30 min

- [ ] **F7-LIMIT-05** — Endpoint `GET /me/usage`
  - **Salida:** devuelve `{users: {current, max}, warehouses: {current, max}}` para que el frontend muestre barras de uso.
  - **Verificar:** TenantAdmin ve uso actual vs límites.
  - **Depende de:** F7-LIMIT-01
  - **Estimación:** 45 min

- [ ] **F7-LIMIT-06** — Modal frontend "Mejorá tu plan"
  - **Salida:** componente `<UpgradeModal>` que se dispara cuando un POST retorna 422 con `code=PLAN_LIMIT_EXCEEDED`. Muestra qué límite se alcanzó y CTA "Ver planes".
  - **Verificar:** intento de crear usuario sobre el límite abre modal en web.
  - **Depende de:** F7-LIMIT-03, F7-VIEW-TA-02
  - **Estimación:** 1.5 h

---

### Módulo F7-STRIPE — Integración Stripe

- [ ] **F7-STRIPE-01** — Setup Stripe SDK + configuración
  - **Salida:** `stripe` npm instalado; `StripeConfig` lee `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` de env. Modo test por default. Keys de producción solo en EC2.
  - **Verificar:** `StripeClient.balance.retrieve()` responde en local.
  - **Depende de:** —
  - **Estimación:** 30 min

- [ ] **F7-STRIPE-02** — Definir `PaymentGatewayPort` (interface)
  - **Salida:** interface en `packages/shared` con métodos: `createCustomer`, `createSubscription`, `updateSubscription`, `cancelSubscription`, `attachPaymentMethod`, `setDefaultPaymentMethod`, `listInvoices`, `verifyWebhookSignature`. Types compilan en API.
  - **Verificar:** types compilan; interface usable desde un mock.
  - **Depende de:** —
  - **Estimación:** 45 min

- [ ] **F7-STRIPE-03** — `StripeAdapter` — Customer + PaymentMethod
  - **Salida:** implementación de `createCustomer`, `attachPaymentMethod`, `setDefaultPaymentMethod`. Errores de Stripe mapeados a excepciones del dominio.
  - **Verificar:** crear customer en Stripe vía test integration; ID persiste.
  - **Depende de:** F7-STRIPE-01, F7-STRIPE-02
  - **Estimación:** 1.5 h

- [ ] **F7-STRIPE-04** — `StripeAdapter` — Subscription lifecycle (con soporte de `subscription_items`)
  - **Salida:** `createSubscription`, `updateSubscription` (cambio de plan con prorating), `cancelSubscription` (con `cancel_at_period_end=true`), `reactivateSubscription`. **Diseñar la subscription con `items: [...]`** (array) desde el inicio, no como `price` único, para preparar add-ons de Fase 9 sin refactor. En MVP el array tiene un solo item (el plan base).
  - **Verificar:** flujo completo: crear subscription → upgrade → cancelar → reactivar, todo reflejado en Stripe. Modelo de datos local soporta múltiples items aunque inicialmente haya 1 solo.
  - **Depende de:** F7-STRIPE-03
  - **Estimación:** 3 h

- [ ] **F7-STRIPE-05** — Endpoint webhook `POST /webhooks/stripe`
  - **Salida:** endpoint que verifica firma con `STRIPE_WEBHOOK_SECRET`, valida idempotency contra `webhook_events`, encola job para procesar. Retorna 200 ASAP (< 5 s).
  - **Verificar:** webhook con firma inválida retorna 401; evento duplicado no se reprocesa.
  - **Depende de:** F7-SUB-02, F7-STRIPE-01
  - **Estimación:** 2 h

- [ ] **F7-STRIPE-06** — Handler de eventos `customer.subscription.*`
  - **Salida:** job worker (BullMQ) que procesa `customer.subscription.created`, `.updated`, `.deleted`, `.trial_will_end`. Sincroniza `subscriptions` local con Stripe.
  - **Verificar:** disparar evento desde Stripe CLI; DB local refleja cambio en < 5 s.
  - **Depende de:** F7-STRIPE-05
  - **Estimación:** 2 h

- [ ] **F7-STRIPE-07** — Handler de eventos `invoice.*`
  - **Salida:** procesa `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`. Crea/actualiza filas en tabla `invoices`. En `payment_failed`, marca `subscription.status='past_due'` y dispara F7-DUNNING.
  - **Verificar:** simular pago fallido con Stripe CLI; subscription pasa a `past_due`; invoice queda registrada.
  - **Depende de:** F7-STRIPE-05, F7-INVOICE-01
  - **Estimación:** 2 h

- [ ] **F7-STRIPE-08** — Stripe CLI configurado para dev local
  - **Salida:** documentar uso de `stripe listen --forward-to localhost:3000/webhooks/stripe` en README del módulo billing. Script `pnpm stripe:listen`.
  - **Verificar:** developer puede recibir webhooks reales en local.
  - **Depende de:** F7-STRIPE-05
  - **Estimación:** 30 min

---

### Módulo F7-INVOICE — Facturas

- [ ] **F7-INVOICE-01** — Schema `invoices` y migration
  - **Salida:** tabla `invoices` con `id`, `tenant_id`, `subscription_id`, `gateway_invoice_id` (unique), `amount_cents`, `currency`, `status` (pending|paid|failed|refunded), `period_start`, `period_end`, `paid_at`, `pdf_url`. RLS por tenant.
  - **Verificar:** migration ok; RLS activa.
  - **Depende de:** F7-SUB-01
  - **Estimación:** 30 min

- [ ] **F7-INVOICE-02** — Sync de invoices desde Stripe (backfill)
  - **Salida:** script `pnpm sync:invoices` que, para cada tenant con suscripción, trae invoices de Stripe y persiste. Idempotente vía `gateway_invoice_id`.
  - **Verificar:** correr script con datos seed; invoices aparecen en DB sin duplicados.
  - **Depende de:** F7-INVOICE-01, F7-STRIPE-04
  - **Estimación:** 1.5 h

- [ ] **F7-INVOICE-03** — Endpoint `GET /me/invoices`
  - **Salida:** lista paginada de invoices del tenant, ordenadas por fecha desc.
  - **Verificar:** TenantAdmin ve historial; otros roles no.
  - **Depende de:** F7-INVOICE-01
  - **Estimación:** 45 min

- [ ] **F7-INVOICE-04** — Endpoint `GET /me/invoices/:id/pdf`
  - **Salida:** redirect a `pdf_url` de Stripe (signed URL temporal). Valida que la invoice pertenezca al tenant del request.
  - **Verificar:** click en "Descargar PDF" abre PDF de Stripe; tenant ajeno recibe 404.
  - **Depende de:** F7-INVOICE-03
  - **Estimación:** 30 min

---

### Módulo F7-TRIAL — Trial de 14 Días

- [ ] **F7-TRIAL-01** — Job de fin de trial
  - **Salida:** job cron diario que verifica suscripciones con `trial_end < now()` y `status='trial'`. Si tienen método de pago: pasa a `active` y dispara primera factura vía Stripe. Si no: pasa a `past_due` (dispara dunning).
  - **Verificar:** correr job manualmente con datos seed.
  - **Depende de:** F7-SUB-04
  - **Estimación:** 1.5 h

- [ ] **F7-TRIAL-02** — Banner "Quedan X días de prueba" en frontend
  - **Salida:** componente `<TrialBanner>` que se muestra en layout principal mientras `subscription.status='trial'`. Muestra días restantes y CTA "Agregar método de pago".
  - **Verificar:** tenant en trial ve banner; tenant active no.
  - **Depende de:** F7-SUB-06
  - **Estimación:** 1 h

- [ ] **F7-TRIAL-03** — Email automático "Tu prueba termina en 3 días"
  - **Salida:** trigger en handler de `customer.subscription.trial_will_end` de Stripe (se dispara 3 días antes) que encola email vía BullMQ.
  - **Verificar:** simular evento con Stripe CLI; email se envía.
  - **Depende de:** F7-STRIPE-06
  - **Estimación:** 1 h

---

### Módulo F7-DUNNING — Manejo de Pagos Fallidos

- [ ] **F7-DUNNING-01** — Transición a `past_due` con grace period
  - **Salida:** cuando `invoice.payment_failed` llega, suscripción pasa a `past_due` con `grace_period_end = now() + 7 days`.
  - **Verificar:** simular pago fallido; subscription queda `past_due` con `grace_period_end` seteado.
  - **Depende de:** F7-STRIPE-07
  - **Estimación:** 1 h

- [ ] **F7-DUNNING-02** — Modo read-only después del grace
  - **Salida:** `SubscriptionStateGuard` (F7-SUB-05) extendido: si `status='past_due'` y `now() > grace_period_end`, todos los POST/PUT/DELETE retornan 402. GET sigue funcionando (read-only). Whitelist de endpoints de billing.
  - **Verificar:** tenant post-grace puede listar pero no crear/editar.
  - **Depende de:** F7-DUNNING-01, F7-SUB-05
  - **Estimación:** 1 h

- [ ] **F7-DUNNING-03** — Emails de recordatorio escalonados
  - **Salida:** job cron diario que envía emails: día 1 ("Tu pago falló, actualizá tu método"), día 4 ("Quedan 3 días"), día 7 ("Mañana entrás en modo solo-lectura"). Tracking de envío para no duplicar.
  - **Verificar:** simular pago fallido; correr cron varios días; verificar emails únicos.
  - **Depende de:** F7-DUNNING-01
  - **Estimación:** 2 h

- [ ] **F7-DUNNING-04** — Banner "Tu pago falló" en frontend
  - **Salida:** banner crítico (rojo) cuando `subscription.status='past_due'`. Muestra días restantes hasta read-only. CTA "Actualizar método de pago".
  - **Verificar:** tenant `past_due` ve banner en toda la app.
  - **Depende de:** F7-DUNNING-01
  - **Estimación:** 1 h

---

### Módulo F7-VIEW-SA — Vistas SuperAdmin

- [ ] **F7-VIEW-SA-01** — Tabla de Tenants con plan/status
  - **Salida:** vista `/admin/tenants` con columnas: tenant, plan actual, status, próximo cobro, MRR contribuído. Filtros por status.
  - **Verificar:** SuperAdmin ve todos los tenants con info de billing.
  - **Depende de:** F7-SUB-01
  - **Estimación:** 2 h

- [ ] **F7-VIEW-SA-02** — Dashboard MRR/ARR simple
  - **Salida:** vista `/admin/billing/dashboard` con cards: MRR actual, ARR proyectado, # tenants activos, # en trial, # past_due. Datos calculados en backend.
  - **Verificar:** números coinciden con queries manuales.
  - **Depende de:** F7-SUB-01, F7-INVOICE-01
  - **Estimación:** 2.5 h

- [ ] **F7-VIEW-SA-03** — Override manual de suscripción
  - **Salida:** SuperAdmin puede asignar plan distinto a un tenant sin pasar por Stripe (caso: cliente VIP, deal especial). Audit log obligatorio (campo `notes` requerido).
  - **Verificar:** SuperAdmin cambia plan de tenant manualmente; queda registro en `audit_logs`.
  - **Depende de:** F7-VIEW-SA-01
  - **Estimación:** 1.5 h

---

### Módulo F7-VIEW-TA — Vistas TenantAdmin

- [ ] **F7-VIEW-TA-01** — Vista "Mi Plan"
  - **Salida:** página `/settings/billing` con plan actual, ciclo, próximo cobro, monto, status, link a comparativa.
  - **Verificar:** TenantAdmin ve su plan; otros roles redirigen.
  - **Depende de:** F7-SUB-06
  - **Estimación:** 1.5 h

- [ ] **F7-VIEW-TA-02** — Vista comparativa de planes
  - **Salida:** página `/settings/billing/plans` con los 3 planes lado a lado, features, precios mensual/anual (toggle), botones "Elegir plan". Plan actual marcado.
  - **Verificar:** TenantAdmin ve comparativa; click en "Elegir" inicia flujo de cambio.
  - **Depende de:** F7-PLAN-04
  - **Estimación:** 2 h

- [ ] **F7-VIEW-TA-03** — Flujo de cambio de plan
  - **Salida:** modal de confirmación que muestra: plan actual → plan nuevo, prorrateo estimado (vía Stripe preview), próximo cobro. Confirmar dispara `POST /me/subscription/change-plan`.
  - **Verificar:** cambio se aplica y refleja inmediatamente en UI.
  - **Depende de:** F7-SUB-07, F7-VIEW-TA-02
  - **Estimación:** 1.5 h

- [ ] **F7-VIEW-TA-04** — Gestión de métodos de pago (Stripe Elements)
  - **Salida:** sección "Método de pago" con tarjeta actual (last4 + brand). Botón "Actualizar" abre Stripe Elements (SetupIntent) para reemplazar tarjeta de forma PCI-compliant.
  - **Verificar:** TenantAdmin actualiza tarjeta; cambio refleja en Stripe; PCI scope queda en Stripe (no toca nuestros servers).
  - **Depende de:** F7-STRIPE-03
  - **Estimación:** 2.5 h

- [ ] **F7-VIEW-TA-05** — Historial de facturas + cancelar/reactivar
  - **Salida:** tabla con facturas (fecha, monto, status, descargar PDF). Botón "Cancelar suscripción" con confirmación (advierte "seguirás activo hasta DD/MM"). Botón "Reactivar" si está cancelada antes del fin de período.
  - **Verificar:** TenantAdmin descarga PDF; cancela y reactiva sin perder data.
  - **Depende de:** F7-INVOICE-03, F7-SUB-08
  - **Estimación:** 2 h

---

### Módulo F7-ONBOARD — Onboarding con Billing

- [ ] **F7-ONBOARD-01** — Crear Stripe Customer al registrar tenant
  - **Salida:** al registrarse, además de crear `Tenant`, crear `Customer` en Stripe y persistir `gateway_customer_id`. Atómico (si falla Stripe, rollback de la transacción).
  - **Verificar:** registrar tenant nuevo; aparece en Stripe Dashboard; si Stripe está caído, tenant no se crea.
  - **Depende de:** F7-STRIPE-03
  - **Estimación:** 1.5 h

- [ ] **F7-ONBOARD-02** — Validar flujo end-to-end de signup → trial activo
  - **Salida:** test manual + checklist. Signup termina con: tenant creado, Stripe Customer creado, Subscription en trial, banner visible. Modificar pantalla post-signup para mostrar "Tu prueba de 14 días empezó".
  - **Verificar:** flujo completo de signup termina con tenant en trial activo y mensajería clara.
  - **Depende de:** F7-SUB-04, F7-ONBOARD-01, F7-TRIAL-02
  - **Estimación:** 1 h

---

### Módulo F7-TEST — Tests End-to-End

- [ ] **F7-TEST-01** — E2E: trial → active → cancel
  - **Salida:** test e2e que: registra tenant → verifica trial → agrega método de pago → simula fin de trial vía Stripe CLI → verifica active → cancela → verifica `cancel_at_period_end`.
  - **Verificar:** test corre verde en CI con Stripe en modo test.
  - **Depende de:** F7-VIEW-TA-05, F7-STRIPE-08
  - **Estimación:** 2 h

- [ ] **F7-TEST-02** — E2E: pago fallido → grace → read-only
  - **Salida:** test e2e que: tenant activo → simula `invoice.payment_failed` → verifica past_due → avanza tiempo > 7 días → verifica read-only (POST falla con 402).
  - **Verificar:** test corre verde.
  - **Depende de:** F7-DUNNING-02
  - **Estimación:** 2 h

- [ ] **F7-TEST-03** — E2E: límite de plan + upgrade
  - **Salida:** test e2e que: tenant plan Chica con 3 usuarios → intenta crear cuarto → recibe 422 → upgradea a Mediana → crea cuarto OK.
  - **Verificar:** test corre verde.
  - **Depende de:** F7-LIMIT-06, F7-VIEW-TA-03
  - **Estimación:** 1.5 h

---

### Módulo F7-DOC — Documentación

- [ ] **F7-DOC-01** — Doc del módulo billing + runbook de webhooks
  - **Salida:** `apps/api/src/billing/README.md` con: arquitectura del módulo, modelo de datos, mapeo de eventos Stripe → handlers, troubleshooting (qué hacer si un webhook falla, cómo reprocesar, cómo resincronizar tenant con Stripe).
  - **Verificar:** doc revisado por el usuario.
  - **Depende de:** F7-TEST-03
  - **Estimación:** 1.5 h

---

**Estimación total Fase 7:** ~3-4 semanas.

---

## Fase 8 — Mobile (futuro)

> Fuera del MVP. Atomizar cuando el negocio lo pida.

- Bootstrap `apps/mobile` con Expo + React Native
- Reutilizar `packages/shared` y `packages/api-client`
- Adaptar UI con biblioteca cross-platform (Tamagui u otra)
- Web Bluetooth → BLE nativo
- Cámara → módulo Expo

---

## Fase 9+ — Extensiones Verticales y Módulos Avanzados (futuro, fuera de MVP)

> Módulos opcionales activables por tenant como **add-ons** sobre el plan base. Se construyen sobre el core sin modificarlo. Atomizar cuando aparezca cliente comprometido por cada vertical.

**Clientes que motivan estos módulos:**
- 👨‍⚕️ Consultorio médico (prospecto) → **F9-VERT-MEDICAL**

> **Nota:** la cafetería (cliente **comprometido**) NO está en Fase 9 — productos compuestos + BOM + stock decimal son **parte del core desde Fase 2** (ver [ARQUITECTURA.md § 3.5](ARQUITECTURA.md#35-modelo-de-productos-unidades-presentaciones-y-composición-bom)). El add-on F9-GASTRO-PRO de abajo es **gastronomía avanzada** (KDS, modificadores, control por turno) — NO el core.

### 9.1 Add-on genérico — Cotizador / Pedidos

- **F9-QUOTE-DB** — Tabla `quotes` (`id`, `tenant_id`, `folio`, `customer_id` nullable, `valid_until`, `status` enum [draft|sent|approved|rejected|expired|converted], `lines[]` con productos del catálogo, `total`, `discount`).
- **F9-QUOTE-API** — CRUD de cotizaciones + endpoint `POST /quotes/:id/convert` (genera venta vinculada).
- **F9-QUOTE-UI** — Vistas: lista de cotizaciones, form de creación/edición, vista pública (link compartible por email/WhatsApp para que el cliente apruebe).
- **F9-QUOTE-POS** — `QuoteLookup` strategy en el input del POS (preparado en F4-CART). Modal "Cargar folio de cotización" → pre-carga carrito.

### 9.2 Add-on — Gastronomía Avanzada (KDS, modificadores, control por turno)

> Productos compuestos + BOM básicos YA están en el core (Fase 2). Este add-on es para gastronomía **avanzada** con necesidades de cocina, modificadores y control fino.

- **F9-GASTRO-KDS** — Kitchen Display System: pantalla en cocina con tickets entrantes ordenados por tiempo, estados (recibido → preparando → listo → entregado), notificación sonora.
- **F9-GASTRO-MOD** — Modificadores de plato: tabla `product_modifiers` (sustituciones, adiciones con costo extra) — "con leche descremada", "extra shot de café".
- **F9-GASTRO-TURN** — Control de porciones por turno: límite diario configurable por producto compuesto. POS bloquea venta cuando se alcanza el límite del turno.
- **F9-GASTRO-COMBOS** — Combos / Menús del día: producto compuesto especial con precio fijo distinto al costeo de ingredientes.
- **F9-GASTRO-REPORTS** — Reportes específicos: tiempo promedio de preparación, productos más demorados, mermas por turno, costo real vs precio de venta.

### 9.3 Add-ons — Verticales con documento clínico

- **F9-CLINICAL-DB** — Tabla genérica `clinical_documents` (`id`, `tenant_id`, `vertical_code`, `folio`, `patient_id`, `professional_id`, `data` JSONB, `lines[]` con productos del catálogo). Tablas `patients` y `professionals` compartidas entre verticales.
- **F9-VERT-MEDICAL** — Vertical Consultorio Médico: receta médica, CIE-10, medicamentos sugeridos.
- **F9-VERT-DENTAL** — Vertical Consultorio Dental: plan de tratamiento, odontograma, materiales.
- **F9-VERT-OPTICAL** — Vertical Óptica: receta oftalmológica con graduación, armazón + cristales del catálogo.
- **F9-VERT-MECHANIC** — Vertical Taller: orden de servicio, vehículo, refacciones + mano de obra.
- **F9-CLINICAL-POS** — `PrescriptionLookup` strategy en input del POS. Modal "Cargar folio clínico" → pre-carga carrito.

### 9.4 Integración transversal

- **F9-SALES-LINK** — Activar `Sale.clinical_document_id` y `Sale.quote_id` (ambas FK reservadas en F4-DB). Reporte de ventas con/sin documento de origen para trazabilidad.
- **F9-MODULES-UI** — Vista `/settings/modules` (TenantAdmin): catálogo de add-ons disponibles con su precio, toggle "Activar". Activación llama a Stripe vía `subscription_item.create`. Desactivación con confirmación (datos del módulo no se borran, solo se ocultan).
- **F9-BILLING-ADDONS** — Extensión de F7-STRIPE para manejar `subscription_items` (1 base + N add-ons). Webhooks de Stripe actualizan estado de cada add-on individual.

**No requiere refactor del core** si:
1. **F4-DB** reserva FK nullables `Sale.clinical_document_id` y `Sale.quote_id`
2. **F4-CART** diseña input con strategy pattern (preparado para futuros lookups)
3. **F7-STRIPE** maneja `subscription_items` en lugar de un solo `subscription_price`

Las 3 previsiones son baratas si se anticipan; caras si se omiten.

---

## 13. Bitácora de Decisiones

> **Índice** de decisiones tomadas durante la implementación. El contenido completo (contexto, razón, trade-offs) vive en **engram** — esto es solo el puntero, igual que el patrón de `MEMORY.md`. Ver [2.5 Sincronización de Fuentes de Verdad](#25-sincronización-de-fuentes-de-verdad).
>
> **Regla:** engram es el dueño canónico de la decisión. Acá va **una línea por decisión**, nunca el texto completo (eso divergiría).

### Formato de entrada (una línea)

```markdown
- **YYYY-MM-DD** — Título breve — `topic_key: sellpoint/xxx` — afecta: F1-AUTH-09 (mod), F1-AUTH-10 (descartada)
```

### Entradas

<!-- Una línea por decisión. El detalle completo se busca en engram por su topic_key. -->

- **2026-07-16** — TS 7 removió `baseUrl`: paths relativos obligatorios en todo tsconfig — `topic_key: sellpoint/ts7-no-baseurl` — afecta: F0-MONO-05 (hecho), F0-SHARED-01, F0-API-01, F0-WEB-01
- **2026-07-16** — ICU/Node 22: USD en locale es NO da `US$` sino `USD 1,234.56` (código ISO + NBSP); expected de tests pineados empíricamente — `topic_key: sdd/format-money/apply-progress` — afecta: F0-I18N-02 (hecho), F0-I18N-04, F4 (display de precios)
- **2026-07-23** — Biome único linter del monorepo: los scaffolds traen el suyo (ESLint en Nest, oxlint en Vite) y se ELIMINA al integrarlos; paquetes sin script `lint` propio — `topic_key: discovery/biome-useimporttype-rompe-la-di-de-nestjs-override-off-en-apps-api` — afecta: F0-API-01 (hecho), F0-WEB-01 (hecho), toda app futura
- **2026-07-23** — Limpieza de residuo de scaffold hecha (Hello World api, landing demo web); convención de módulos por dominio (`api: modules/{dominio}`, `web: features/{dominio}`) se define AL ABRIR F1 con la primera feature como molde — `topic_key: sellpoint/feature-modules-convention` — afecta: F1 (primera tarea), estructura de ambas apps
- **2026-07-23** — i18n api: solo AcceptLanguageResolver (cadena completa la owna F1-LOCALE), DEFAULT_LOCALE desde shared, type-safety de claves diferida, GET /hello canario permanente; api pasó a depender de shared (tsconfig paths→dist, Dockerfile `--filter api...`) — `topic_key: sdd/api-i18n/proposal` — afecta: F0-I18N-03 (hecho), F0-I18N-04, F1-LOCALE
- **2026-07-23** — tsbuildinfo stale en contexto Docker = emit fantasma de tsc sin error (exit 0); `**/*.tsbuildinfo` agregado a .dockerignore — `topic_key: discovery/tsbuildinfo-stale-romp-a-el-build-de-shared-dentro-de-docker-emit-fantasma-sin-error` — afecta: F0-I18N-03 (hecho), todo Dockerfile futuro
- **2026-07-23** — i18n web: claves dotted en namespace único (byte-idénticas al api), JSON estáticos sin http-backend, detector localStorage→navigator (key `sellpoint.locale`), factory `createI18n` hermética para tests + singleton con detector, Suspense off, canario `i18n-check` — `topic_key: sdd/web-i18n/proposal` — afecta: F0-I18N-04 (hecho), F1-LOCALE (selector de idioma y migración a namespaces nativos si hay lazy-load)
- **2026-07-27** — MCPs: Context7 + Playwright instalados en `.mcp.json` (proyecto); Postgres MCP → F1-TENANT, GitHub MCP → F0-CI (opcional), Stripe MCP → F7; rechazados filesystem/git/docker/redis/memory por redundantes — `topic_key: decision/mcps-del-proyecto-context7-playwright-instalados-postgres-github-stripe-diferidos-por-fase` — afecta: F0-CI, F1-TENANT, F7 (notas 🔌 en cada módulo)
- **2026-07-27** — Patrones UI confirmados: container/presentational + `features/{dominio}` + labels SOLO por i18n + estilos por design tokens; atomic design completo y hexagonal-en-front RECHAZADOS; se codifica al abrir F1 con la primera feature como molde — `topic_key: sellpoint/feature-modules-convention` — afecta: F1 (primera tarea), todo componente futuro del web
- **2026-08-03** — Deploy: Vultr HF 2GB CDMX (~$12/mes) + GHCR + pg_dump nocturno a R2 desde F0 (nueva F0-DEPLOY-13); EC2 de Ohio dada de baja ($17/mes por 1GB que no corría el stack); serverless descartado (POS no tolera cold starts); CloudWatch/Parameter Store a reemplazar en F6 — `topic_key: decision/deploy-vultr` — afecta: F0-DEPLOY (reescrito), F5 (resize por workers), F6-LOGS/F6-SECRETS
- **2026-08-03** — Imágenes de catálogo: Cloudflare R2 (egress $0, 10GB free, S3-compatible), NO S3 ni disco del VPS; adapter StorageService + presigned URLs + sharp, bucket separado del de backups — `topic_key: decision/storage-imagenes-r2` — afecta: F2-PROD (implementación), F0-DEPLOY-13 (mismo proveedor)
- **2026-08-04** — Proveedor FINAL tras vuelta completa: **Vultr HF 2GB CDMX ($12/mes)**. Bluehost RECHAZADO (sin DC en México, lock-in anual, teaser). Hetzner RECHAZADO con evidencia de consola (post-suba jun-2026: US $20.49 > Vultr con peor latencia; planes baratos solo-Europa ~150ms). Lección: precios de cloud se verifican EN EL CHECKOUT, no en blogs — `topic_key: decision/deploy-vultr` — afecta: F0-DEPLOY, SERVICIOS.md
- **2026-08-06** — F0-DEPLOY completo: producción viva en laradoc.com (TLS Let's Encrypt, push→prod en 2m05s). Cloudflare quedó PROXY NARANJA (desviación de D7 asumida como deliberada: ACME verificado atravesando CF; revisión formal en F6-CF-PROXY). 2 bugs reales cazados en el camino: stdin del heredoc SSH tragándose el script del deploy (CI verde sin deployar) y POSTGRES_DB equivocada en el backup. Verify PASS_WITH_WARNINGS (0 críticos; W3/W4/W7 → tareas F6) — `topic_key: sdd/f0-deploy/verify-report` — afecta: F0-DEPLOY (cerrado), F6 (3 tareas nuevas)
- **2026-08-06** — F0-CI-03 (branch protection) DIFERIDA: choca con "push a main = deploy" del walking skeleton y con un solo dev no protege nada real (los checks igual frenan el deploy si fallan). Trigger de reactivación: flujo de PRs en uso (chained PRs F1) o segundo dev. **Con esto, Fase 0 queda CERRADA** (todas las tareas hechas o diferidas con nota) — afecta: F0-CI-03 (⏸️), F1 (hereda el trigger)
- **2026-08-06** — RLS real exige DOS usuarios de DB: el superuser del container bypasea RLS aunque haya FORCE (la 1ª verificación fue teatro); `sellpoint` queda para migrate/seed y `sellpoint_app` (sin privilegios) es el runtime de la API — `topic_key: architecture/m-dulo-f1-db-completo...` — afecta: F1-DB-08/09 (hecho), F1-TENANT, todo entorno nuevo
- **2026-08-06** — Producto: **email único GLOBAL** para login (un email = una cuenta = un tenant); sin selector de tenant ni subdominios en MVP; multi-membership queda para F9 — `topic_key: sdd/f1-auth/decision-email-global` — afecta: F1-AUTH (propose), users.email (nueva unique global), F1-WEB-AUTH
- **2026-08-06** — f1-auth proposal cerrado (D1-D8: SECURITY DEFINER quirúrgica para login pre-RLS, RS256 con kid, refresh en cookie httpOnly, MailerPort+Resend, throttler sobre Redis, auth→tenants unidireccional, i18n desde commit 1, permisos en JWT + epoch Redis) + decisiones de Carlos: dominio ES PLACEHOLDER (parametrizar en env, no verificar Resend aún), Resend confirmado, passwords NIST 12+ sin composición — `topic_keys: sdd/f1-auth/proposal, sdd/f1-auth/decisions-carlos` — afecta: F1-AUTH (spec+design siguen), ARQUITECTURA (8 correcciones C1-C8 pendientes), F1-AUTH-17/18 (tareas nuevas)
- **2026-08-07** — El VPS pasa a MULTI-DOMINIO: la app se muda a **`system.laradoc.com`** (mismo origen web+api → D3 de f1-auth intacto, cookie host-only que no ve el sitio PHP); `laradoc.com` y `berrinchitosdent.com` quedan como sitios PHP planos con php-fpm compartido `ondemand`; límites de RAM por contenedor (hoy los 5 usan 127 MB de 1637, sin ningún tope). Proposal SDD ligero con D1-D8 + secuencia de migración sin downtime — `topic_keys: decision/vps-multidominio, sdd/vps-multidominio/proposal, sdd/vps-multidominio/decisions-carlos` — afecta: F0-DEPLOY (evoluciona el edge), F1-AUTH (hereda APP_URL/CORS parametrizados y la decisión de argon2), W3/W7 de f0-deploy (se cierran acá)
- **2026-08-07 (CIERRE)** — `sdd/vps-multidominio` ARCHIVADO: 9 commits (U1-U5 + U6 remedial). Verify FAIL original (C1/C2: RC-1 stdin drain en heredoc SSH) → U6 remediación extracto scripts a archivo + gate de evidence post-reload → run 31142473779 VERDE. Decisiones que quedan como LEY: cookie host-only sin Domain, Redis `volatile-ttl` SIN TTL en epoch, argon2 19456, nginx `-t && reload` (nunca recreate), scripts remotos siempre como archivo (nunca heredoc). **Backlog F6 explícito**: W1 (rsync --delete vs scp -r), W3 (rollback no ejercitado, ahora alcanzable), 7 SUGGESTION del verify, canal sites_ci/rrsync (cuando repos), M4 (API key Resend), ALERT_EMAIL+RESEND_API_KEY en .env del server, Origin Cert CF + resize 4GB. **Reglas de interop f1-auth**: argon2 19456 OBLIGATORIO (R2 del proposal), host-only cookie OBLIGATORIO, COOKIE_DOMAIN="" en prod, REFRESH_COOKIE_PATH=/api/auth. — `topic_key: sdd/vps-multidominio/archive-report` — cierra: W7 y S5 de f0-deploy; afecta: F1-AUTH (hereda argon2/cookie decisión), F6 (backlog)
- **2026-08-12 (CIERRE)** — **`sdd/f1-auth` ARCHIVADO**: registro+verify+login+refresh+logout+forgot+reset+throttle+auditoría, 16/16 tareas [x], desplegado en producción (system.laradoc.com, runs 31602735124→31622774475). Incidente 502 de U1 (DATABASE_URL con superuser) + U1-02 manual de Carlos (password de sellpoint_app) + U1-14 verificación post-deploy. Verify FAIL original (C1: reuso concurrente sin revocar/auditar → rollback de tx; C2: i18n no implementado) → **Remediación 2 commits (1868f53+852c68e)** con Strict TDD RED→GREEN contra Postgres/Redis reales → PASS_WITH_WARNINGS (0 CRITICAL, 8 WARNING, 5 SUGGESTION). Decisiones LEY: argon2id 19456/2/1 (sincronizado con mem_limit 512M VPS), email único global, cookie host-only SIN Domain, perm-epoch:{userId} SIN TTL Redis, backend traduce errores (AllExceptionsFilter + I18nService). **Gates operativos pre-primer-usuario** (no cierran F1-AUTH, cierran el onboarding real): **W3** permissions:[] en prod (cierra F1-RBAC), **W9** SPF/DKIM sin verificar (Resend, cierra F1 si el usuario no recibe mail). **Backlog F1-AUTH**: W1 change-password, W2 auth-ip scope, W4/W5 cobertura e2e, W6 docs C1-C8, W8 orden de guards, S1-S6 sugerencias menores. Commits: 57ab6d1 (U1), c270cd7 (U1 prep CI), e224ad8 (U2), f9126ad (U3+U4), eecf319 (U5), 474b183 (U6), 4604b1a+52459bf (U6 e2e), 1868f53+852c68e (remediación C1+C2). — `topic_key: sdd/f1-auth/archive-report` (#272) — afecta: F1-RBAC (hereda JWT/epoch), F1-TENANT (hereda withTenantContext), F1-WEB-AUTH (hereda login UI + axios interceptor), F6 (backlog W1/W6/W9)

---

*Documento de implementación de SellPoint. Trabajamos punto por punto. Cuando termines una tarea, marca el checkbox y agregá una línea a la Bitácora si hubo algo digno de recordar. Al terminar la Fase 1, atomizamos la Fase 2.*
