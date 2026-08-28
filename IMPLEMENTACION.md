# SellPoint — Plan de Implementación Atomizada

> Documento operativo para construir SellPoint **paso a paso**. Cada tarea es una unidad pequeña, demoable, con criterio de "hecho" claro. Trabajamos punto por punto, marcamos progreso y registramos decisiones en la bitácora del final.

---

## Tabla de Contenidos

1. [Cómo Usar Este Documento](#1-cómo-usar-este-documento)
2. [Convenciones](#2-convenciones) · [2.5 Sincronización de Fuentes de Verdad](#25-sincronización-de-fuentes-de-verdad)
3. [Roadmap General](#3-roadmap-general)
4. [Fase 0 — Setup + Walking Skeleton](#fase-0--setup--walking-skeleton)
5. [Fase 1 — Multi-Tenant + Autenticación](#fase-1--multi-tenant--autenticación)
6. [Fase 2 — Catálogos Dinámicos](#fase-2--catálogos-dinámicos--uom--bom)
7. [Fase 3 — Movimientos de Inventario](#fase-3--movimientos-de-inventario)
8. [Fase 4 — POS PWA](#fase-4--pos-pwa-outline)
9. [Fase 5 — Reportes](#fase-5--reportes-atomizada-2026-08-21)
10. [Fase 6 — Hardening de Producción](#fase-6--hardening-de-producción-outline)
11. [Fase 7 — Planes + Billing + Suscripciones](#fase-7--planes--billing--suscripciones-atomizada-2026-08-27-cobro-manual)
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
- **SDD LIGERO**: F0-DEPLOY, F0-I18N-02/03/04, F2-DB, F2-UOM, F2-SUBCAT, F2-WH, F2-ONBOARD, F3-DB, F3-GUARDS, F3-NAV, F4-UI, F4-TICKET, F4-PWA, F4-DOCS, F5-CORE, F5-KDX, F5-CAT, F5-EXP, F5-HUB, F5-DOCS.
- **SDD COMPLETO**: F1-AUTH, F1-RBAC, F1-LOCALE, F1-TENANT, F1-SCOPE, F2-CAT, F2-SCHEMA, F2-PRESENT, F2-BOM, F2-PROD, F2-IMPORT, F2-SCOPE, F3-CORE, F3-ENTRY, F3-EXIT, F3-TRANSFER, F3-COUNT, F3-KARDEX, F3-LOTS, F3-DOC, F4-DB, F4-CASHBOX, F4-SALE, F4-QUOTE, F4-CART, F5-COST, F5-STK, F5-SALES, F6-*, F7-*, F9-*.

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
| **F0** | Setup + Walking Skeleton | ✅ Completada | 1.5-2 semanas | ✅ Sí |
| **F1** | Multi-Tenant + Auth | ✅ Completada | 2-3 semanas | ✅ Sí |
| **F2** | Catálogos Dinámicos | ✅ Completada | 4-5 semanas | ✅ Sí |
| **F3** | Movimientos de Inventario | ✅ Completada | 5-6 semanas | ✅ Sí |
| **F4** | POS PWA + Cotización | ⬜ Pendiente | 3.5 semanas | ✅ Sí (2026-08-20) |
| **F5** | Reportes | ⬜ Pendiente | ~2 semanas | ✅ Atomizada (2026-08-21, 24 tareas) |
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
  - **Trigger de reactivación (actualizado 2026-08-14):** al **terminar el desarrollo del proyecto** — decisión de Carlos. Reemplaza al trigger original ("flujo de PRs en uso o segundo dev"), que se revisó y se descartó: los únicos PRs abiertos son de Dependabot y sigue habiendo un solo dev, así que exigir PRs hoy solo rompería el "push a main = deploy" sin proteger de nada.
  - **Nota de riesgo asumido:** `main` no tiene NINGUNA protección (verificado 2026-08-14: `branches/main/protection` → 404). Se evaluó una protección mínima (bloquear `force-push` y borrado, sin exigir PRs — no rompía el flujo) y se decidió no aplicarla por ahora. El riesgo vivo es un `push --force` accidental que reescriba la historia.
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

- [x] **F1-LOCALE-07** — Selector de moneda en wizard de onboarding (Paso 1)
  - **Salida:** componente `<CurrencySelector>` en el paso 1 de `/onboarding`. Submit guarda `tenant.currency`.
  - **Verificar:** tenant nuevo termina onboarding con su currency persistida.
  - **Depende de:** F1-WEB-ONBOARD-01, F1-LOCALE-01
  - **Estimación:** 1.5 h
  - **Cerrada retroactivamente (2026-08-21).** Se implementó DENTRO de `F1-WEB-ONBOARD-01` (commit `7aabc2d`, «wizard paso 1 con selector de moneda»), tal como lo anticipó la bitácora del 2026-08-13 — y a nadie le puso la cruz, aunque a su gemela `F1-LOCALE-08` sí. Dos desvíos sobre lo escrito arriba, los dos deliberados y los dos mejores que el plan: **(1)** el default ya no es «MXN» fijo sino **derivado del país** (`getDefaultCurrency`, commit `5bb12b3`); **(2)** el **mensaje de advertencia se RETIRÓ** por decisión de Carlos (commit `8f86df2`, 2026-08-16) — y era correcto entonces, porque `TenantTransactionsGate.hasTransactions()` devolvía `false` siempre: advertía de un bloqueo que no existía. **Ojo, la circunstancia cambió:** desde F3-GUARDS-01 el gate cuenta `stock_movements` de verdad, así que hoy la moneda **sí** se congela con el primer movimiento y la pantalla no lo dice. Carlos decidió **reponerla el 2026-08-21** (commit siguiente): ahora dice la verdad, y un test la sostiene para que no vuelva a desaparecer sin que nadie lo note.

- [x] **F1-LOCALE-08** — Selector de idioma en `/profile` (Mi perfil)
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

- [x] **F1-RBAC-01** — `PermissionsGuard`
  - **Salida:** guard que valida que el JWT tenga los permisos del decorator
  - **Verificar:** endpoint protegido por `@RequirePermissions('users:manage')` rechaza usuario sin ese permiso
  - **Depende de:** F1-AUTH-14
  - **Estimación:** 1 h

- [x] **F1-RBAC-02** — Decorator `@RequirePermissions(...permissions)`
  - **Salida:** decorator que setea metadata leída por el guard
  - **Verificar:** unit test del decorator
  - **Depende de:** F1-RBAC-01
  - **Estimación:** 20 min

- [x] **F1-RBAC-03** — CRUD endpoints de usuarios
  - **Salida:** `POST /users`, `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `POST /users/:id/suspend`, `POST /users/:id/reactivate`
  - **Verificar:** Swagger muestra todos, tests verifican RBAC
  - **Depende de:** F1-RBAC-02
  - **Estimación:** 2 h

- [x] **F1-RBAC-04** — CRUD endpoints de roles
  - **Salida:** `POST /roles`, `GET /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`
  - **Verificar:** swap de permisos en un rol cambia los de todos sus usuarios
  - **Depende de:** F1-RBAC-02
  - **Estimación:** 1.5 h

- [x] **F1-RBAC-05** — Endpoint lectura de permisos disponibles
  - **Salida:** `GET /permissions` devuelve lista agrupada por módulo
  - **Verificar:** frontend puede construir el editor de roles
  - **Depende de:** F1-RBAC-04
  - **Estimación:** 30 min

- [x] **F1-RBAC-06** — Tests de RBAC
  - **Salida:** tests que verifican cada combinación de rol vs endpoint
  - **Verificar:** matriz de permisos cubierta
  - **Depende de:** F1-RBAC-03, F1-RBAC-04
  - **Estimación:** 1.5 h

---

### Módulo F1-SCOPE — Warehouse Scoping (preparación)

> Las tablas de warehouses no existen aún (vienen en F2). Acá dejamos preparada la lógica de scoping.

- [x] **F1-SCOPE-01** — Modelo Prisma `UserWarehouseScope`
  - **Salida:** tabla con `user_id`, `warehouse_id`, `tenant_id`, PK compuesta
  - **Verificar:** migration aplica (warehouse_id sin FK aún)
  - **Depende de:** F1-DB-07
  - **Estimación:** 20 min

- [x] **F1-SCOPE-02** — Activar RLS en `user_warehouse_scopes`
  - **Salida:** policy `tenant_isolation`
  - **Verificar:** sin set_config no devuelve filas
  - **Depende de:** F1-SCOPE-01, F1-DB-09
  - **Estimación:** 15 min

- [x] **F1-SCOPE-03** — `WarehouseScopeMiddleware`
  - **Salida:** middleware que carga `warehouseIds` accesibles del usuario en `req.scope`
  - **Verificar:** unit test verifica que TenantAdmin bypass, otros roles filtran
  - **Depende de:** F1-SCOPE-02, F1-TENANT-01
  - **Estimación:** 1 h

- [x] **F1-SCOPE-04** — Decorator `@CurrentUserScope()`
  - **Salida:** inyecta `{warehouseIds: string[] | 'all'}` en el handler
  - **Verificar:** `@CurrentUserScope() scope` recibe el valor correcto
  - **Depende de:** F1-SCOPE-03
  - **Estimación:** 30 min

---

### Módulo F1-WEB-AUTH — UI de Autenticación

- [x] **F1-WEB-AUTH-01** — Auth store con Zustand
  - **Salida:** `useAuthStore` con `accessToken`, `user`, `setAuth`, `clearAuth`
  - **Verificar:** estado persiste durante navegación, no en localStorage
  - **Depende de:** F0-WEB-08
  - **Estimación:** 30 min

- [x] **F1-WEB-AUTH-02** — Axios interceptor de refresh automático
  - **Salida:** en respuesta 401, intenta `/auth/refresh`, si OK reintenta la request original
  - **Verificar:** test manual con access token expirado refresca y reintenta
  - **Depende de:** F1-WEB-AUTH-01, F1-AUTH-09
  - **Estimación:** 1.5 h

- [x] **F1-WEB-AUTH-03** — Página `/login`
  - **Salida:** form con email + password, validación con Zod + React Hook Form, llama a `/auth/login`
  - **Verificar:** login exitoso navega a `/dashboard`
  - **Depende de:** F1-WEB-AUTH-02, F1-AUTH-07
  - **Estimación:** 1.5 h

- [x] **F1-WEB-AUTH-04** — Página `/register`
  - **Salida:** form de registro de tenant con validación de password en vivo
  - **Verificar:** registro exitoso muestra "revisa tu email"
  - **Depende de:** F1-WEB-AUTH-03, F1-AUTH-03
  - **Estimación:** 1.5 h

- [x] **F1-WEB-AUTH-05** — Página `/verify`
  - **Salida:** lee token de URL, llama API, muestra éxito o error
  - **Verificar:** flujo completo desde registro hasta verificación
  - **Depende de:** F1-AUTH-05
  - **Estimación:** 45 min

- [x] **F1-WEB-AUTH-06** — Página `/forgot-password`
  - **Salida:** form simple con email
  - **Verificar:** request a API funciona, muestra "revisa tu email"
  - **Depende de:** F1-AUTH-11
  - **Estimación:** 30 min

- [x] **F1-WEB-AUTH-07** — Página `/reset-password`
  - **Salida:** form con nuevo password (token de URL)
  - **Verificar:** reset exitoso navega a login
  - **Depende de:** F1-AUTH-12
  - **Estimación:** 45 min

- [x] **F1-WEB-AUTH-08** — Componente `ProtectedRoute`
  - **Salida:** wrapper que redirige a `/login` si no hay sesión
  - **Verificar:** ir a `/dashboard` sin login redirige a `/login`
  - **Depende de:** F1-WEB-AUTH-01
  - **Estimación:** 30 min

- [x] **F1-WEB-AUTH-09** — Layout autenticado (sidebar + header)
  - **Salida:** `AppLayout` con sidebar colapsable y header con menú usuario
  - **Verificar:** se ve el layout en `/dashboard`, sidebar funciona
  - **Depende de:** F1-WEB-AUTH-08
  - **Estimación:** 2 h

- [x] **F1-WEB-AUTH-10** — Página `/profile` (perfil básico)
  - **Salida:** muestra datos del usuario + form de cambiar password + sesiones activas (lista)
  - **Verificar:** cambio de password cierra otras sesiones
  - **Depende de:** F1-WEB-AUTH-09
  - **Estimación:** 1.5 h

- [x] **F1-WEB-AUTH-11** — Logout
  - **Salida:** botón en header llama `/auth/logout`, limpia store, navega a `/login`
  - **Verificar:** después de logout, refresh no funciona
  - **Depende de:** F1-WEB-AUTH-09, F1-AUTH-10
  - **Estimación:** 20 min

---

### Módulo F1-WEB-USERS — UI de Gestión de Usuarios

- [x] **F1-WEB-USERS-01** — Página `/system/users` — lista
  - **Salida:** tabla con TanStack Table, paginación **client-side** (`GET /users` no pagina; server-side queda para cuando duela — decisión del proposal #326), búsqueda
  - **Verificar:** lista de usuarios del tenant visible
  - **Depende de:** F1-RBAC-03, F1-WEB-AUTH-09
  - **Estimación:** 1.5 h

- [x] **F1-WEB-USERS-02** — Form crear usuario (modal o página)
  - **Salida:** form completo con validación, envía invitación
  - **Verificar:** crear usuario lo agrega a la lista, envía email
  - **Depende de:** F1-WEB-USERS-01
  - **Estimación:** 1.5 h

- [x] **F1-WEB-USERS-03** — Form editar usuario
  - **Salida:** misma UI que crear, precargada
  - **Verificar:** cambios persisten
  - **Depende de:** F1-WEB-USERS-02
  - **Estimación:** 45 min

- [x] **F1-WEB-USERS-04** — Acciones: suspender / reactivar / reenviar invitación / reset password
  - **Salida:** menú `⋮` en cada fila con estas opciones
  - **Verificar:** cada acción funciona end-to-end
  - **Depende de:** F1-WEB-USERS-03
  - **Estimación:** 1 h

- [x] **F1-WEB-USERS-05** — Página `/system/roles` — lista y editor de permisos
  - **Salida:** sidebar con roles + checklist de permisos a la derecha
  - **Verificar:** modificar permisos persiste, aplica en próxima request del usuario
  - **Depende de:** F1-RBAC-04, F1-RBAC-05
  - **Estimación:** 2 h

---

### Módulo F1-WEB-ONBOARD — Wizard de Onboarding

- [x] **F1-WEB-ONBOARD-01** — Step 1: datos del negocio
  - **Salida:** form con razón social, RFC/RUT, dirección, zona horaria
  - **Verificar:** datos persisten en `Tenant`
  - **Depende de:** F1-WEB-AUTH-05
  - **Estimación:** 1 h

- [x] **F1-WEB-ONBOARD-02** — Step 2: placeholder de schema (se completa en F2)
  - **Salida:** pantalla con plantillas pero solo "elegir" sin editor aún
  - **Verificar:** decisión guardada en `Tenant.template_choice` (temporal)
  - **Depende de:** F1-WEB-ONBOARD-01
  - **Estimación:** 30 min

- [x] **F1-WEB-ONBOARD-03** — Step 3: placeholder de primer almacén (se completa en F2)
  - **Salida:** pantalla skip con mensaje "lo haremos en el siguiente paso"
  - **Verificar:** continuar funciona
  - **Depende de:** F1-WEB-ONBOARD-02
  - **Estimación:** 20 min

- [x] **F1-WEB-ONBOARD-04** — Step 4: invitar usuarios
  - **Salida:** UI para mandar invitaciones por email (multi)
  - **Verificar:** invitaciones llegan
  - **Depende de:** F1-WEB-ONBOARD-03, F1-WEB-USERS-02
  - **Estimación:** 1 h

- [x] **F1-WEB-ONBOARD-05** — Marcar `Tenant.onboarded = true` al finalizar
  - **Salida:** endpoint + redirect a `/dashboard`
  - **Verificar:** próximos logins van directo a dashboard, no a wizard
  - **Depende de:** F1-WEB-ONBOARD-04
  - **Estimación:** 30 min

---

### ✅ Definición de "Fase 1 completa"

- [x] Un visitante puede registrarse, verificar email, hacer login
- [x] Dos tenants distintos NO ven los datos del otro (test e2e que lo prueba)
- [x] El refresh token rota correctamente y detecta reuse
- [x] Reset de password invalida todas las sesiones
- [x] El TenantAdmin puede crear usuarios, asignarles roles, suspenderlos
- [x] El TenantAdmin puede crear roles custom y asignar permisos granulares
- [x] La UI tiene login, registro, recuperación, layout autenticado, usuarios, roles, perfil
- [x] Throttling activo en `/auth/*`
- [x] Cobertura de tests > 70% en `apps/api/src/modules/auth` y `users`
- [x] Tag `v0.2.0-fase1` creado (en `b68c7fc`, 2026-08-15 — el commit que cierra la bitácora de `f1-web-onboard`, último módulo de la fase; Deploy verde. Cobertura medida el 2026-08-17 antes de taggear: `modules/auth` 98.57 % y `modules/users` 88.54 % de sentencias, ambos sobre el 70 % exigido)

---

## Fase 2 — Catálogos Dinámicos + UOM + BOM

> **Objetivo:** un TenantAdmin de **cualquier** negocio con inventario y venta define la estructura de su catálogo sin tocar código — campos personalizados que él nombra, subcatálogos propios ligados por lookup, productos con presentaciones/precios, composición entre productos y almacenes reales. Atomizada el 2026-08-16 sobre el pedido de Carlos de un **motor de catálogos genérico** (decisiones completas en `topic_key: sellpoint/f2-atomizacion`).
>
> **LEY DE GENERICIDAD (Carlos, 2026-08-16).** Esta fase construye un motor **agnóstico del rubro**. En el código, el schema y la UI no existe ningún concepto de farmacia, cafetería, ferretería ni ningún otro giro: existen *catálogos*, *campos*, *productos*, *componentes*. Que un tenant llame a un campo "Sustancia Activa" o "Tipo de Tueste" es **dato que él carga**, jamás algo que SellPoint traiga definido. Consecuencias duras:
>
> - **Cero campos de negocio en la base de datos.** Ninguna migración, seed o constante del API nombra un campo de un rubro.
> - **Vocabulario neutro en todo el producto**: se dice *composición* y *componente*, nunca *receta* ni *ingrediente* (una óptica arma un lente con armazón + cristales; una ferretería arma un kit; una cafetería prepara un café — el motor es el mismo).
> - Los **Layouts por rubro** (plantillas de campos sugeridas para farmacia, cafetería, etc.) son una funcionalidad **posterior y opcional**, fuera del MVP — ver Fase 9. Fase 2 no los incluye.
>
> Incluye composición + stock decimal + presentaciones desde el core. Ver [ARQUITECTURA.md § 3.3](ARQUITECTURA.md#33-motor-de-catálogos-dinámicos) y [§ 3.5](ARQUITECTURA.md#35-modelo-de-productos-unidades-presentaciones-y-composición-bom).

### Convenciones que esta fase codifica

**El motor, en una frase:** `catalogs` / `catalog_fields` / `catalog_records` son el motor genérico; el **Catálogo de Productos** es un catálogo del sistema (`system_key='products'`, no borrable) cuyas filas viven en la tabla de primera clase `products` (F3/F4/F5 le cuelgan FKs duras) pero cuyos **campos personalizados usan el mismo motor** que cualquier subcatálogo. Campo estándar de todo catálogo: **Código (Nombre Corto)**, único dentro del catálogo, llave visible de los lookups (que internamente guardan el `id`).

**Permisos nuevos** (llegan por migración data-only, patrón `ON CONFLICT DO NOTHING`):

| Code | Qué habilita | TenantAdmin | Manager | POS_Seller | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| `catalogs:read` | Ver catálogos y registros | ✅ | ✅ | ❌ | ✅ |
| `catalogs:write` | CRUD registros de subcatálogos | ✅ | ✅ | ❌ | ❌ |
| `catalogs:manage` | Estructura: catálogos y campos | ✅ | ❌ (`MANAGER_EXCLUDED_CODES`) | ❌ | ❌ |
| `products:read` | Ver productos (ya reservado en seed) | ✅ | ✅ | ✅ | ✅ |
| `products:manage` | CRUD productos/presentaciones/composición | ✅ | ✅ | ❌ | ❌ |
| `warehouses:read` | Ver almacenes | ✅ | ✅ | ❌ | ✅ |
| `warehouses:manage` | CRUD almacenes | ✅ | ✅ | ❌ | ❌ |

Los `catalog:read/write/schema:write` que usaba VISTAS.md quedan renombrados a estos. El módulo de almacenes se llama **F2-WH** en todos lados (la bitácora citó "F2-WARE" una vez; gana el outline).

**Frontend:** el patrón real de F1 se mantiene — `routes/` + `components/{dominio}` + `lib/{dominio}` (la convención `features/{dominio}` de la línea de F1 nunca se materializó y se abandona).

**Decisiones de alcance (LEY de esta atomización):**

| Tema | Decisión |
|---|---|
| Versionado de schema (CU-CAT-01 viejo) | **Diferido** — editor simple con guardas (Carlos, 2026-08-16): quitar campo con datos pide confirmación y archiva (recuperable, no borra valores); cambiar tipo con datos se bloquea |
| Precio/costo | Viven en `product_presentations` (una fuente de verdad); el form de producto los pide y auto-crea la presentación **«Unidad ×1»** — se llenan desde la misma interfaz del catálogo (Carlos, 2026-08-16) |
| Relaciones entre productos | Son la **composición** (BOM). Se captura **cuánto de cada componente lleva UNA unidad** del producto compuesto, y el "alcanza para N" es **resultado calculado en vivo** contra el stock, nunca dato capturado. Ejemplo de Carlos: "1 kg de azúcar alcanza para 50 cafés" se guarda como "el café lleva 20 gr de azúcar" — así el N se recalcula solo cuando cambia el stock, en vez de mentir |
| Vocabulario del dominio | **Neutro, agnóstico del rubro** (LEY de genericidad): *composición* y *componente*, nunca *receta* ni *ingrediente*; *unidades armables*, nunca *porciones*. Aplica a columnas, endpoints, código y copy |
| Plantillas por rubro (Layouts) | **FUERA de F2** — sembrar campos de farmacia/cafetería/ferretería sería meter negocio específico en la base. `Tenant.templateChoice` se sigue registrando como preferencia, pero **no siembra nada**. Los Layouts llegan al final, como catálogo de sugerencias opcional (Fase 9) |
| Validación de atributos | **Sin Ajv**: validador puro derivado de `catalog_fields` (required/tipo/lookup-existe), errores por campo i18n-ables. El JSON Schema draft-07 del diseño viejo muere |
| Racks de almacén (VISTAS §7) | **Fuera de F2** — sin modelo de datos; se decide al llegar stock por ubicación |
| Imágenes de producto (R2) | **Fuera de F2** — ningún CU las exige; la decisión R2 espera a que se necesiten |
| Import async >5MB (CU-CAT-03 5a) | **Simplificado**: límite 5MB síncrono (413); async requiere notificaciones que no existen |
| `StockByWarehouse` | **Nace en F2** (en 0) para que availability de BOM lea stock real; F3 la muta |
| Búsqueda de productos | **pg_trgm/ILIKE** sobre sku+nombre+barcodes de presentaciones; paginación **server-side** (CU-CAT-04) — difiere del client-side de users (D6: "server cuando duela"; miles de productos duelen) |
| Costo unitario de componente | `cost/factor` de su presentación comprable default; F3 lo reemplaza por promedio ponderado |
| Scope sin filas | El interceptor pasa al **default permisivo documentado** (sin filas → todos los almacenes, ARQUITECTURA §3.4); el fail-closed `[]` de F1 era correcto cuando no existían almacenes |
| `units` global | Se queda (el motor de conversiones necesita categorías); el subcatálogo "Unidad de Medida" del ejemplo de Carlos sigue siendo posible como catálogo libre para lookups |

**Clasificación SDD:** F2-CAT, F2-SCHEMA, F2-PROD, F2-PRESENT, F2-BOM, F2-IMPORT, F2-SCOPE = **SDD COMPLETO** · F2-DB, F2-UOM, F2-SUBCAT, F2-WH, F2-ONBOARD = **SDD LIGERO**.

---

### Módulo F2-DB — Modelos y Seguridad de Datos

> Todos los modelos Prisma de la fase + RLS + permisos, con el patrón canónico heredado: PK `gen_random_uuid()`, `@@map` snake_case, `tenant_id` desnormalizado en TODA tabla hija, CHECK/índices a mano en la migración, policy `tenant_isolation` con NULLIF + FORCE.

- [x] **F2-DB-01** — Tabla maestra `units` + seed data-only
  - **Salida:** modelo `Unit` global (code PK VARCHAR(8), name_es, name_en, category CHECK IN ('count','volume','weight','length'), is_active) sin tenant_id ni RLS; migración con INSERT de `unit, ml, l, gr, kg, m, cm, oz, lb` + REVOKE de escritura a `sellpoint_app` (patrón `currencies`)
  - **Verificar:** migración aplica limpia; INSERT como `sellpoint_app` falla por permisos
  - **Depende de:** —
  - **Estimación:** 45 min

- [x] **F2-DB-02** — Modelos `Catalog` y `CatalogField`
  - **Salida:** `Catalog` (tenant_id, name, system_key nullable, is_system, is_active; `@@unique([tenantId, name])` + índice único parcial (tenant_id, system_key) WHERE NOT NULL); `CatalogField` (tenant_id, catalog_id, key, label, field_type ENUM('text','number','lookup'), lookup_catalog_id nullable FK, required, position, is_archived; `@@unique([catalogId, key])`); CHECK SQL: `field_type='lookup'` ⇔ `lookup_catalog_id IS NOT NULL`
  - **Verificar:** CHECK rechaza lookup sin catálogo destino y no-lookup con destino
  - **Depende de:** —
  - **Estimación:** 1 h

- [x] **F2-DB-03** — Modelo `CatalogRecord`
  - **Salida:** (tenant_id, catalog_id, code, attributes JSONB default `{}`, is_active, timestamps; `@@unique([catalogId, code])`); índice GIN sobre attributes en SQL a mano
  - **Verificar:** código repetido dentro del catálogo rechazado, permitido en otro catálogo; GIN existe
  - **Depende de:** F2-DB-02
  - **Estimación:** 45 min

- [x] **F2-DB-04** — Modelo `Product`
  - **Salida:** (tenant_id, sku, name, base_unit FK `units.code` default 'unit', is_composite default false, stock_min DECIMAL(14,4) default 0, attributes JSONB default `{}` + GIN, is_active, timestamps; `@@unique([tenantId, sku])`); extensión `pg_trgm` + índices trigram en sku/name
  - **Verificar:** SKU duplicado en el mismo tenant rechazado, permitido en otro
  - **Depende de:** F2-DB-01
  - **Estimación:** 1 h

- [x] **F2-DB-05** — Modelo `ProductPresentation`
  - **Salida:** (tenant_id, product_id FK CASCADE, name, factor DECIMAL(14,4) CHECK > 0, is_purchasable, is_sellable, is_default_sale, allow_fractional_input, barcode nullable, price DECIMAL(14,2) nullable, cost DECIMAL(14,2) nullable, is_active, timestamps; `@@unique([productId, name])`); índice único **parcial** (tenant_id, barcode) WHERE barcode IS NOT NULL
  - **Verificar:** CHECK factor>0; barcode duplicado en el tenant rechazado, NULL repetido permitido
  - **Depende de:** F2-DB-04
  - **Estimación:** 1 h

- [x] **F2-DB-06** — Modelo `ProductComposition`
  - **Salida:** (tenant_id, parent_product_id FK CASCADE, **component_product_id** FK **RESTRICT**, quantity DECIMAL(14,4) CHECK > 0, waste_percentage DECIMAL(5,2) default 0 CHECK 0-100, notes, timestamps; `@@unique([parentProductId, componentProductId])`; CHECK parent≠component) — nombre neutro por la LEY de genericidad: `component`, nunca `ingredient`
  - **Verificar:** autorreferencia directa rechazada por CHECK; borrar un producto que es componente falla por FK RESTRICT
  - **Depende de:** F2-DB-04
  - **Estimación:** 45 min

- [x] **F2-DB-07** — Modelo `Warehouse` + FK diferida de `user_warehouse_scopes`
  - **Salida:** (tenant_id, name, address TEXT nullable — texto libre internacional, is_active, timestamps; `@@unique([tenantId, name])`); migración agrega `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE` a `user_warehouse_scopes` (**cierra S4 de f1-scope**, sin backfill — no hay filas legacy)
  - **Verificar:** FK activa; insertar scope con warehouse inexistente falla
  - **Depende de:** —
  - **Estimación:** 45 min

- [x] **F2-DB-08** — Modelo `StockByWarehouse`
  - **Salida:** (product_id, warehouse_id, tenant_id, quantity DECIMAL(14,4) default 0 CHECK >= 0, updated_at; PK compuesta product+warehouse) — nace en F2 en 0 para que availability de BOM lea stock real; **F3 la muta**
  - **Verificar:** PK compuesta rechaza duplicado; CHECK rechaza negativo
  - **Depende de:** F2-DB-04, F2-DB-07
  - **Estimación:** 30 min

- [x] **F2-DB-09** — RLS en las 8 tablas nuevas con tenant_id
  - **Salida:** migración SQL: ENABLE + **FORCE** ROW LEVEL SECURITY + policy `tenant_isolation` (patrón NULLIF) en catalogs, catalog_fields, catalog_records, products, product_presentations, product_compositions, warehouses, stock_by_warehouse (`units` queda global sin RLS)
  - **Verificar:** tests de integración canónicos por tabla (contexto propio ve / ajeno 0 filas / sin set_config 0 filas / privilegios de `sellpoint_app`) — molde: `user-warehouse-scope-rls.integration.spec.ts`
  - **Depende de:** F2-DB-02 a F2-DB-08
  - **Estimación:** 2 h

- [x] **F2-DB-10** — Migración data-only de permisos de F2
  - **Salida:** INSERT `ON CONFLICT DO NOTHING` de los 7 codes de la tabla de arriba + asignación a roles base existentes (SQL espejo de `resolveRolePermissionCodes`); `catalogs:manage` entra a `MANAGER_EXCLUDED_CODES` en `role-catalog.ts` con test
  - **Verificar:** `GET /permissions` muestra los nuevos; Manager sin `catalogs:manage`; Viewer con los `:read`; POS_Seller con `products:read`; gotcha documentado: usuarios ya logueados los ven tras su próximo refresh (una migración SQL no bumpea perm-epoch)
  - **Depende de:** —
  - **Estimación:** 1 h

---

### Módulo F2-UOM — Conversiones de Unidades

- [x] **F2-UOM-01** — Tipo `Unit` + catálogo compartido en `packages/shared`
  - **Salida:** `UNIT_CATEGORIES`, tipo `UnitCategory`, catálogo `UNITS` (code, category, factor a la unidad base de su categoría: ml/gr/cm/unit) — misma fuente para API y web (patrón `ISO_COUNTRY_CODES`)
  - **Verificar:** test de contrato: todo code del seed SQL de F2-DB-01 existe en el catálogo shared y viceversa
  - **Depende de:** F2-DB-01
  - **Estimación:** 45 min

- [x] **F2-UOM-02** — Helper `convertUnits()` misma-categoría
  - **Salida:** `convertUnits(value, from, to)` en shared; conversión solo dentro de la categoría (`l↔ml`, `kg↔gr`, `m↔cm`, `oz↔gr`, `lb↔kg`); categorías distintas lanzan (densidad = responsabilidad del usuario)
  - **Verificar:** tests RED→GREEN de la matriz de conversiones + el cruce de categorías que lanza
  - **Depende de:** F2-UOM-01
  - **Estimación:** 45 min

---

### Módulo F2-CAT — Motor de Catálogos (API)

> El corazón de la fase. CRUD de catálogos, campos y registros con las guardas de la LEY (confirmación al archivar campo con datos, tipo bloqueado con datos, lookup con integridad a nivel servicio).

- [x] **F2-CAT-01** — Catálogo del sistema «products» por tenant
  - **Salida:** `TenantsService.provision()` crea `Catalog { systemKey: 'products', isSystem: true }` en la misma tx que los roles base; migración data-only de backfill para los tenants existentes en producción
  - **Verificar:** e2e: registrar tenant nuevo → el catálogo existe; test de la migración de backfill
  - **Depende de:** F2-DB-02
  - **Estimación:** 1 h

- [x] **F2-CAT-02** — CRUD de catálogos (subcatálogos)
  - **Salida:** módulo `catalogs` (controller+service+DTOs zod): `POST/GET/PATCH /catalogs` (`catalogs:manage` escribe, `catalogs:read` lee); crear subcatálogo (name único por tenant → 409), renombrar, archivar; el catálogo del sistema **no** se archiva ni renombra (409); audit log en la misma tx
  - **Verificar:** e2e del ciclo + archivar el de productos falla + cross-tenant no ve
  - **Depende de:** F2-CAT-01, F2-DB-10
  - **Estimación:** 2 h

- [x] **F2-CAT-03** — CRUD de campos con guardas
  - **Salida:** endpoints de campos (`catalogs:manage`): agregar (key derivada del label, única por catálogo), editar label/required/position, **archivar con datos exige `confirm: true` y NO borra valores** (is_archived, restaurable), **cambiar field_type con datos → 409**, lookup exige catálogo destino vivo del tenant
  - **Verificar:** unit + e2e de cada guarda, RED→GREEN
  - **Depende de:** F2-CAT-02
  - **Estimación:** 3 h

- [x] **F2-CAT-04** — Validador derivado de campos (función pura)
  - **Salida:** `validateRecordAttributes(fields, attributes)` → errores por campo con claves i18n; reglas: required, text=string, number=finito, lookup=uuid; campos archivados se ignoran; claves desconocidas se rechazan; **sin Ajv**
  - **Verificar:** suite unit exhaustiva de la matriz tipo×regla (pura, sin DB)
  - **Depende de:** F2-DB-02
  - **Estimación:** 2 h

- [x] **F2-CAT-05** — CRUD de registros de subcatálogos
  - **Salida:** endpoints (`catalogs:write` escribe, `catalogs:read` lee): crear/editar/archivar registro; **code único por catálogo (409)**; attributes validado con F2-CAT-04 + existencia del registro lookup destino (vivo y del catálogo declarado en el campo); archivar un registro **referenciado por lookup** de otro registro o producto → 409 con la referencia (query GIN inversa)
  - **Verificar:** e2e del ciclo completo, el 409 de referencia y el lookup cross-catálogo rechazado
  - **Depende de:** F2-CAT-03, F2-CAT-04
  - **Estimación:** 3 h

- [x] **F2-CAT-06** — Opciones de lookup para pickers
  - **Salida:** `GET /catalogs/:id/records?query=` (`catalogs:read`): id, code, display (primer campo texto activo o el code), solo activos, limitado/paginado
  - **Verificar:** e2e: filtra por query sobre code+display; no lista archivados
  - **Depende de:** F2-CAT-05
  - **Estimación:** 1 h

---

### Módulo F2-SCHEMA — Editor de Campos (UI)

> `/catalog/schema` generalizado: edita los campos de CUALQUIER catálogo (el de productos y los subcatálogos). Acá nace `DynamicForm`, que reusan F2-SUBCAT y F2-PROD.

- [x] **F2-SCHEMA-01** — Ruta `/catalog/schema` + nav Catálogo + namespace i18n
  - **Salida:** ruta con gates compuestos (`PermissionGate need="catalogs:manage"`); grupo nav "Catálogo" (Productos → `products:read`, Subcatálogos → `catalogs:read`, Schema → `catalogs:manage`); selector de catálogo; namespace `catalogs` (es/en, copy neutro) cableado en `i18n/index.ts`
  - **Verificar:** sin permiso → panel del gate, no redirect; test por routeTree real
  - **Depende de:** F2-CAT-06
  - **Estimación:** 1.5 h

- [x] **F2-SCHEMA-02** — Lista de campos + agregar campo
  - **Salida:** lista (label, tipo, required, badge archivado) + alta: label, tipo Texto/Numérico/Lookup, catálogo destino si lookup, required; los **campos estándar se muestran fijos y sin botones** (Código/nombre en todos; en productos además precio, costo, unidad base, stock mínimo)
  - **Verificar:** alta llama al API y refresca; estándar no editable
  - **Depende de:** F2-SCHEMA-01
  - **Estimación:** 2 h

- [x] **F2-SCHEMA-03** — Guardas de edición en UI
  - **Salida:** editar label/required; archivar con datos → dialog con conteo ("N registros tienen este campo; se ocultará, no se borra") → `confirm: true`; restaurar archivado; cambio de tipo deshabilitado con datos (motivo visible)
  - **Verificar:** el flujo de confirmación manda `confirm`; 409 mapeado a mensaje
  - **Depende de:** F2-SCHEMA-02
  - **Estimación:** 2 h

- [x] **F2-SCHEMA-04** — Componente `DynamicForm`
  - **Salida:** `components/catalog/dynamic-form.tsx`: campos → TextField (text), TextField numérico (number), picker de lookup (opciones de F2-CAT-06); integrado con react-hook-form; errores por campo i18n; **reusado por F2-SUBCAT y F2-PROD**
  - **Verificar:** tests por decisión (render por tipo, required, lookup carga opciones) — no copy
  - **Depende de:** F2-SCHEMA-01
  - **Estimación:** 3 h

- [x] **F2-SCHEMA-05** — Preview del form
  - **Salida:** panel de previsualización: `DynamicForm` en vivo con los campos vigentes del catálogo elegido
  - **Verificar:** agregar campo → aparece en preview
  - **Depende de:** F2-SCHEMA-02, F2-SCHEMA-04
  - **Estimación:** 1 h

---

### Módulo F2-SUBCAT — Registros de Subcatálogos (UI)

- [x] **F2-SUBCAT-01** — Ruta de registros con tabla dinámica
  - **Salida:** ruta `/catalog/lists` con selector de subcatálogo (gate `catalogs:read`); tabla con columnas generadas de los campos activos (Código + dinámicos), lookup mostrado por code+display, filtro global client-side
  - **Verificar:** las columnas reflejan los campos del catálogo elegido (afirmado por key)
  - **Depende de:** F2-SCHEMA-04, F2-CAT-06
  - **Estimación:** 2 h

- [x] **F2-SUBCAT-02** — Alta/edición de registros
  - **Salida:** form con campo estándar Código + `DynamicForm` (gate `catalogs:write`); remount por `key` en edición (lección C1 de f1-web-users); 409 de código duplicado mapeado al campo
  - **Verificar:** ciclo alta/edición con lookup elegido de otro catálogo
  - **Depende de:** F2-SUBCAT-01
  - **Estimación:** 2 h

- [x] **F2-SUBCAT-03** — Archivar registro + manejo del 409 de referencia
  - **Salida:** acción archivar con confirmación; si el API devuelve 409 (referenciado por lookup), mensaje que nombra dónde se usa
  - **Verificar:** el 409 se muestra, el registro no desaparece de la tabla
  - **Depende de:** F2-SUBCAT-02
  - **Estimación:** 1 h

---

### Módulo F2-WH — Almacenes

- [x] **F2-WH-01** — API CRUD de almacenes
  - **Salida:** módulo `warehouses` (`warehouses:read`/`warehouses:manage`): crear (name único por tenant → 409), listar, editar, desactivar; dirección texto libre; audit log; el guard de "no desactivar con stock" queda para F3 (documentado en el service)
  - **Verificar:** e2e del ciclo + cross-tenant no ve
  - **Depende de:** F2-DB-07, F2-DB-10
  - **Estimación:** 2 h

- [x] **F2-WH-02** — UI lista `/warehouses` + nav
  - **Salida:** ruta con gates (`warehouses:read`), tabla nombre/dirección/estado, grupo nav "Almacenes", estado vacío con CTA de creación, namespace i18n `warehouses`
  - **Verificar:** test por routeTree real; sin permiso → panel del gate
  - **Depende de:** F2-WH-01
  - **Estimación:** 1.5 h

- [x] **F2-WH-03** — UI form alta/edición + desactivar
  - **Salida:** form (nombre requerido, dirección multiline opcional — internacional, sin colonia/alcaldía MX-only) con gate `warehouses:manage`; desactivar con dialog de confirmación
  - **Verificar:** ciclo completo contra API mockeado; 409 de nombre mapeado
  - **Depende de:** F2-WH-02
  - **Estimación:** 1.5 h

---

### Módulo F2-PROD — Productos (API + UI)

- [x] **F2-PROD-01** — API alta/edición de producto
  - **Salida:** módulo `products` (`products:manage`): `POST /products` {sku, name, baseUnit, stockMin, isComposite, attributes, price?, cost?} — valida attributes contra los campos del catálogo products (F2-CAT-04 + existencia de lookups); sku único → 409; **auto-crea la presentación «Unidad ×1»** (factor 1, is_default_sale, allow_fractional_input derivado de la categoría, price/cost del form — decisión Carlos); `PATCH` edita; **cambio de base_unit → 409 si stock > 0 o es componente de otro** (validación §3.5 #2)
  - **Verificar:** e2e: alta crea producto + presentación base con precio; validación dinámica rechaza; RED→GREEN
  - **Depende de:** F2-CAT-04, F2-CAT-01, F2-DB-05
  - **Estimación:** 3 h

- [x] **F2-PROD-02** — API lista con búsqueda server-side
  - **Salida:** `GET /products?query&page&pageSize` (`products:read`): pg_trgm/ILIKE sobre sku, name y **barcodes de cualquier presentación**; filtros por campos dinámicos (`attributes @>` con GIN); cada fila trae precio de la presentación default + flag compuesto; paginación server-side
  - **Verificar:** e2e: encuentra por barcode de presentación; filtro dinámico filtra
  - **Depende de:** F2-PROD-01
  - **Estimación:** 2.5 h

- [x] **F2-PROD-03** — API detalle + borrado/desactivación
  - **Salida:** `GET /products/:id` (presentaciones incluidas); `DELETE` (`products:manage`) **bloqueado si es componente de otro** (FK RESTRICT → 409 nombrando a los padres, validación §3.5 #3); alternativa is_active
  - **Verificar:** e2e: borrar componente usado → 409 con los padres; desactivar funciona
  - **Depende de:** F2-PROD-01
  - **Estimación:** 1.5 h

- [x] **F2-PROD-04** — UI lista `/catalog/products`
  - **Salida:** tabla server-side (paginación manual de TanStack Table — primera de la app), búsqueda, filtro "Compuestos", columna precio (formato `formatMoney` con currency del tenant), acciones por permiso; namespace i18n `products`
  - **Verificar:** cambio de página dispara request con page; sin `products:manage` no hay acciones de edición
  - **Depende de:** F2-PROD-02
  - **Estimación:** 2.5 h

- [x] **F2-PROD-05** — UI form alta/edición
  - **Salida:** campos estándar (Código/SKU, nombre, unidad base — selector desde `UNITS` de shared —, stock mínimo, toggle compuesto, precio/costo) + `DynamicForm` para los dinámicos; en edición precio/costo **editan la presentación «Unidad ×1»** (misma interfaz, decisión Carlos); tabs Presentaciones/Composición como placeholder hasta sus módulos
  - **Verificar:** alta manda attributes correctos; edición de precio persiste en la presentación default
  - **Depende de:** F2-PROD-04, F2-SCHEMA-04
  - **Estimación:** 3 h

- [x] **F2-PROD-06** — Guardas de edición en UI
  - **Salida:** base_unit deshabilitada con motivo cuando el API lo bloquearía; borrar con 409 → mensaje que nombra los productos padre
  - **Verificar:** los estados deshabilitados derivan de datos del producto, no de copy
  - **Depende de:** F2-PROD-05
  - **Estimación:** 1 h

---

### Módulo F2-PRESENT — Presentaciones

- [x] **F2-PRESENT-01** — API CRUD de presentaciones
  - **Salida:** endpoints anidados en products (`products:manage`): validaciones factor>0, nombre único por producto, **barcode único por tenant → 409 nombrando al producto dueño**, `is_default_sale` exclusivo por producto (transacción), **`allow_fractional_input` derivado server-side** de `units.category` (count→false, resto→true) con override permitido; inactivar en vez de borrar
  - **Verificar:** e2e de cada validación; el default derivado y su override
  - **Depende de:** F2-PROD-01
  - **Estimación:** 3 h

- [x] **F2-PRESENT-02** — UI tab Presentaciones (tabla inline)
  - **Salida:** tab en el producto: filas editables (nombre, factor → unidad base, comprable, vendible, default radio, solo-enteros, barcode, precio, costo) + agregar fila; sin wizards ni drag-and-drop
  - **Verificar:** alta/edición inline contra API mockeado; el radio default es exclusivo
  - **Depende de:** F2-PRESENT-01, F2-PROD-05
  - **Estimación:** 3 h

- [x] **F2-PRESENT-03** — Derivación visible del solo-enteros + equivalencias
  - **Salida:** el toggle solo-enteros nace del estado derivado del server (badge "override" si difiere); línea de equivalencia por factor ("1 Caja = 1,000 ml") — sin stock (eso llega en F3)
  - **Verificar:** producto count → toggle activado por defecto; volume → apagado; override persiste
  - **Depende de:** F2-PRESENT-02
  - **Estimación:** 1.5 h

- [x] **F2-PRESENT-04** — Guardas UI: inactivar + 409 de barcode
  - **Salida:** inactivar con confirmación (la fila queda atenuada, no desaparece); 409 de barcode mapeado al campo con link al producto dueño
  - **Verificar:** ambos flujos por estado, no por copy
  - **Depende de:** F2-PRESENT-02
  - **Estimación:** 1.5 h

---

### Módulo F2-BOM — Composición de Productos (Relaciones entre Productos)

> **El "apartado de relaciones entre productos" de Carlos**, en vocabulario neutro: un producto compuesto se arma con N componentes del mismo catálogo. Sirve igual a una óptica (armazón + cristales → lente armado), una ferretería (kit), una papelería (paquete) o una cafetería (café + leche + azúcar). Se captura **cuánto lleva UNA unidad** del compuesto y el "alcanza para N" se calcula en vivo — ver Convenciones. UI: tabla + picker, sin wizards.

- [x] **F2-BOM-01** — API de composición con DFS anti-recursión
  - **Salida:** `GET/PUT /products/:id/composition` (`products:manage`): filas {componentId, quantity en base_unit del componente, wastePercentage, notes}; par único; **DFS sobre el grafo** rechaza recursión directa e indirecta (A→B→C→A) con mensaje que nombra el ciclo; composición vacía es válida (no vendible hasta F4)
  - **Verificar:** unit del DFS con ciclo indirecto RED→GREEN; e2e del PUT
  - **Depende de:** F2-DB-06, F2-PROD-01
  - **Estimación:** 3 h

- [x] **F2-BOM-02** — API availability + cost-estimate
  - **Salida:** `GET /products/:id/availability` → unidades armables = `floor(min(stock_total_i / (qty_i × (1 + waste_i))))` + componente limitante (composiciones anidadas se expanden); `GET /products/:id/cost-estimate` → Σ(costo unitario × qty) con desglose, costo unitario = `cost/factor` de la presentación comprable default del componente (F3 lo reemplaza por promedio ponderado); **contrato con stock 0 → 0 unidades** (F2 no tiene movimientos)
  - **Verificar:** unit de ambos cálculos con stock sembrado a mano en tests; anidado expande
  - **Depende de:** F2-BOM-01, F2-DB-08, F2-PRESENT-01
  - **Estimación:** 3 h

- [x] **F2-BOM-03** — UI tab Composición
  - **Salida:** tab visible solo si `is_composite`: picker con autocompletado server-side (reusa `GET /products?query`), fila con cantidad + unidad precargada no editable (base_unit del componente) + merma % + quitar
  - **Verificar:** la unidad de la fila deriva del componente elegido; agregar/quitar actualiza
  - **Depende de:** F2-BOM-01, F2-PROD-05
  - **Estimación:** 2.5 h

- [x] **F2-BOM-04** — UI resumen en vivo
  - **Salida:** panel bajo la composición: costo estimado con desglose + **"alcanza para N unidades"** + componente limitante (el ejemplo azúcar/café de Carlos, ahora calculado); error de recursión del API mostrado con claridad
  - **Verificar:** el resumen re-consulta al editar filas; render del limitante por id de producto
  - **Depende de:** F2-BOM-02, F2-BOM-03
  - **Estimación:** 1.5 h

- [x] **F2-BOM-05** — Filtro "Compuestos" con unidades armables
  - **Salida:** en `/catalog/products`: filtro compuestos + columna unidades armables y componente limitante (CU-CAT-07)
  - **Verificar:** el filtro pide al server; la columna solo aparece filtrando compuestos
  - **Depende de:** F2-BOM-02, F2-PROD-04
  - **Estimación:** 1.5 h

---

### Módulo F2-IMPORT — Importación desde Excel

- [x] **F2-IMPORT-01** — Generación de plantilla
  - **Salida:** `GET /products/import/template` (`products:manage`): xlsx con columnas estándar + campos dinámicos vigentes del catálogo products + hoja de presentaciones referidas por SKU (librería a elegir en el propose del módulo)
  - **Verificar:** la plantilla refleja los campos del momento (agregar campo → columna nueva)
  - **Depende de:** F2-CAT-03, F2-PROD-01
  - **Estimación:** 2 h

- [x] **F2-IMPORT-02** — Validación previa (dry-run)
  - **Salida:** `POST /products/import?dryRun=true`: valida fila por fila (validador F2-CAT-04, SKUs y barcodes duplicados dentro del archivo y contra la DB) → resumen n válidas / m con error y detalle por fila; **límite 5 MB → 413** (async diferido)
  - **Verificar:** e2e con archivo mixto válidas+errores; el 413
  - **Depende de:** F2-IMPORT-01
  - **Estimación:** 3 h

- [x] **F2-IMPORT-03** — Importación real
  - **Salida:** `POST /products/import` (+`skipErrors`): inserta válidas con sus presentaciones (filas fallidas no bloquean válidas), reporte final, audit log
  - **Verificar:** e2e: mixto importa las válidas y reporta las fallidas; todo-o-nada sin `skipErrors`
  - **Depende de:** F2-IMPORT-02
  - **Estimación:** 2.5 h

- [x] **F2-IMPORT-04** — UI modal de importación
  - **Salida:** modal en `/catalog/products`: descargar plantilla → dropzone → resumen del dry-run → checkbox "saltar filas con error" → resultado con descarga de errores
  - **Verificar:** el flujo llama dry-run antes del import; estados por datos
  - **Depende de:** F2-IMPORT-03, F2-PROD-04
  - **Estimación:** 2.5 h

- [x] **F2-IMPORT-05** — `.xlsx` real, plantilla con lo ya cargado y upsert *(agregado el 2026-08-16 a pedido de Carlos)*
  - **Salida:** capa `spreadsheet.ts` (CSV/XLSX sobre las mismas filas, xlsx en base64); `GET /products/import/template?format=xlsx|csv` devuelve **los productos existentes** además de los encabezados; la importación pasa a **UPSERT** (SKU existente actualiza, y el reporte separa `created`/`updated`); UI con los dos botones de plantilla y el control de archivo como botón (input real `sr-only` + label)
  - **Verificar:** e2e de round-trip binario (descargar xlsx → volver a subirlo → `updated: 1`), xlsx corrupto → 400, plantilla con SKU y precio del producto existente; test web de que el `.xlsx` viaja en base64
  - **Depende de:** F2-IMPORT-04
  - **Estimación:** 3 h

- [x] **F2-IMPORT-06** — Los lookups viajan por **código**, no por id *(corrección de Carlos, 2026-08-16)*
  - **Salida:** la planilla escribe el `code` del registro destino y lo resuelve de vuelta al id al importar (índice `id ↔ código` en una sola query por catálogo destino; coincidencia exacta y, si no la hay, sin distinguir mayúsculas cuando el código es inequívoco); código inexistente → error de FILA con el campo señalado; `attributes` sigue guardando el **id**
  - **Verificar:** e2e: la plantilla contiene `ACME` y NO el uuid; subir `ACME` deja el id adentro; `acme` resuelve igual; `NO-EXISTE` falla la fila con `catalogs.lookup_value_not_found`
  - **Depende de:** F2-IMPORT-05
  - **Estimación:** 1.5 h

- [x] **F2-PROD-07** — Escala de los importes: 2 decimales *(pedido de Carlos, 2026-08-16)*
  - **Salida:** `hasValidMoneyScale` + `MONEY_DECIMALS` en `@sellpoint/shared` (la regla la usan los dos lados); `moneyAmount()` de Zod en el API cableado en las **cuatro puertas** (crear/editar producto, crear/editar presentación) más la **quinta**, la importación por planilla (error de fila); en el front, `step="0.01"`, error en vivo bajo el campo y submit bloqueado; claves i18n `products.too_many_decimals` y `products.composition_cycle` (esta última salía cruda en pantalla)
  - **Verificar:** unit en shared (incluye `1.15`, que rompe a cualquier validación hecha con `× 100`, y `1e-7`); e2e: alta y PATCH de producto con 3 decimales → 400; presentación con 3 decimales → 400; fila de planilla → `products.too_many_decimals` con el campo señalado
  - **Depende de:** F2-PROD-01, F2-PRESENT-01, F2-IMPORT-03
  - **Estimación:** 2 h

---

### Módulo F2-SCOPE — Alcance por Almacén

> Chico pero toca seguridad (el interceptor con 2 CRITICAL históricos): SDD COMPLETO.

- [x] **F2-SCOPE-01** — Interceptor al default permisivo documentado
  - **Salida:** `WarehouseScopeInterceptor`: usuario sin filas en `user_warehouse_scopes` → `warehouseIds: "all"` (ARQUITECTURA §3.4 — el fail-closed `[]` de F1 era correcto sin almacenes); con filas → esas; bypass TenantAdmin intacto (por catálogo de permisos, nunca por rol); docblock actualizado con la historia
  - **Verificar:** tests del interceptor actualizados (los 3 estados) + e2e con usuario scoped
  - **Depende de:** F2-DB-07
  - **Estimación:** 2 h

- [x] **F2-SCOPE-02** — API de asignación de alcance
  - **Salida:** `GET/PUT /users/:id/warehouse-scope` (`users:manage`): lista de warehouseIds del tenant, vivos; reemplazo completo transaccional; audit
  - **Verificar:** e2e: asignar/quitar; warehouse ajeno o muerto → 422
  - **Depende de:** F2-SCOPE-01, F2-WH-01
  - **Estimación:** 1.5 h

- [x] **F2-SCOPE-03** — UI de alcance en el form de usuario
  - **Salida:** sección "Alcance por almacén" en `UserForm` (CU-SYS-04): checklist de almacenes; **deshabilitada si el usuario tiene rol TenantAdmin** con leyenda de acceso total; vacío = todos (leyenda del default permisivo)
  - **Verificar:** estados derivados de datos (rol, filas), no de copy
  - **Depende de:** F2-SCOPE-02
  - **Estimación:** 2 h

---

### Módulo F2-ONBOARD — Wizard: Pasos 2 y 3 Reales

> **LEY de genericidad aplicada:** el paso 2 **no siembra campos de ningún rubro**. El tenant arranca con los campos estándar y define los suyos, con sus propios nombres. Las plantillas por rubro (Layouts) son una funcionalidad posterior y opcional — ver Fase 9.

- [x] **F2-ONBOARD-01** — Paso 2 real: definir campos del catálogo
  - **Salida:** el paso deja de ser un placeholder de plantillas: muestra los campos estándar del Catálogo de Productos y permite agregar campos personalizados ahí mismo (reusa `DynamicForm`/editor de F2-SCHEMA), con opción **"Definir después"** que avanza sin bloquear; `Tenant.templateChoice` se conserva como preferencia registrada (alimenta los Layouts futuros) pero **no dispara ninguna siembra**
  - **Verificar:** e2e: completar el paso sin agregar campos avanza; agregar un campo lo deja creado; ninguna migración ni constante del API nombra un rubro (`rg -i "pharmacy|farmacia|cafeteria|hardware|grocery" apps/api/src apps/api/prisma` sin resultados)
  - **Depende de:** F2-CAT-03, F2-SCHEMA-02
  - **Estimación:** 2 h

- [x] **F2-ONBOARD-02** — Retiro del catálogo de plantillas del wizard
  - **Salida:** `TEMPLATE_CHOICES` (`step-template.tsx`) deja de ofrecer rubros como si trajeran campos; el paso explica que los campos los define el negocio; copy neutro en es/en
  - **Verificar:** no queda copy que prometa campos precargados por rubro
  - **Depende de:** F2-ONBOARD-01
  - **Estimación:** 1 h

- [x] **F2-ONBOARD-03** — Paso 3 real: primer almacén
  - **Salida:** form mínimo (nombre) que crea el almacén vía API; la derivación del paso en `lib/tenant/steps.ts` pasa a "¿existe ≥1 almacén?" (muere el paso skip de F1); tests de derivación actualizados
  - **Verificar:** tenant sin almacén cae al paso 3; con almacén avanza; RED del cambio de derivación
  - **Depende de:** F2-WH-01
  - **Estimación:** 2 h

- [x] **F2-ONBOARD-04** — Limpieza de residuos del placeholder
  - **Salida:** eliminar el valor legacy `"retail-basico"` de tests (`lib/tenant/steps.test.ts`), revisar copy neutro de los pasos, actualizar los textos "lo haremos en el siguiente paso"
  - **Verificar:** rg de `retail-basico` sin resultados; guardián de voseo verde
  - **Depende de:** F2-ONBOARD-02, F2-ONBOARD-03
  - **Estimación:** 45 min

---

### ✅ Definición de "Fase 2 completa"

- [x] Un TenantAdmin de **cualquier rubro** define campos personalizados de su Catálogo de Productos (texto, numérico, lookup) sin tocar código
- [x] Crea subcatálogos (ej. "Unidad de Medida": `kg` → "kilogramos"), los llena y liga productos por lookup
- [x] Los campos estándar (Código, nombre, precio, costo, unidad base) no se pueden eliminar; el Código no se repite dentro de un catálogo
- [x] Crea productos simples, a granel (stock decimal) y compuestos, con presentaciones y precios desde la misma interfaz del catálogo
- [x] La composición de un compuesto muestra "alcanza para N unidades" + componente limitante y bloquea recursión (directa e indirecta)
- [x] **Genericidad verificable:** ni el schema, ni las migraciones, ni el código del API nombran un rubro (`rg -i "pharmacy|farmacia|cafeteria|hardware|grocery|receta|ingredient"` sobre `apps/api` y `apps/web/src` sin resultados de dominio)
- [x] Importa productos por Excel con validación previa y reporte de errores por fila
- [x] Dos tenants NO ven catálogos/productos/almacenes del otro (tests de integración RLS por tabla)
- [x] El alcance por almacén se asigna desde el form de usuario y el interceptor lo respeta (default permisivo documentado)
- [x] El wizard de onboarding funciona de punta a punta con pasos 2 y 3 reales
- [x] Suites verdes (api unit+e2e, web, shared) + tsc + Biome + deploy verde
- [x] Tag `v0.3.0-fase2` creado (en `3d5af37`, 2026-08-16 — **no** en `fe970ec`: ese dejó el Deploy en **rojo** por el hueco de tipos del front. El tag va en el primer commit donde TODOS los checks son demostrablemente ciertos, mismo criterio que `v0.1.0-fase0`)

**Estimación: 4-5 semanas** (el motor de catálogos genérico suma ~1 semana sobre el outline previo).

---

## Fase 3 — Movimientos de Inventario

> **Objetivo:** el stock deja de ser un número en cero y pasa a tener **historia**: todo cambio de existencias entra por un movimiento append-only con motivo, usuario y momento, dentro de una transacción atómica que no permite oversell ni stock negativo. Con eso, un negocio de **cualquier rubro** registra compras, ajustes, mermas, consumos, devoluciones y traspasos entre almacenes con confirmación en destino, hace inventario físico por planilla (por lote cuando el producto lo pide) y consulta el kardex de cualquier producto. **Toda operación que toca stock es un DOCUMENTO con folio y estado**: nace en **borrador** al pulsar «Crear» desde el listado de su serie (`ENT`, `SAL`, `INV`), se carga a mano o por Excel **guardándose sola**, se puede cerrar el sistema y **retomar buscándola por su folio**, muestra el stock resultante antes de confirmar, y al confirmarse escribe los movimientos y se baja en **PDF** firmable. Los productos con lote salen **FEFO** (primero el que vence antes) desde el ledger, así que el POS de F4 lo hereda. Atomizada el 2026-08-17 (decisiones completas en `topic_key: sellpoint/f3-atomizacion` y `sellpoint/f3-lots-fefo`).
>
> **LEY DE GENERICIDAD (Carlos, 2026-08-16).** Esta fase mueve *productos* entre *almacenes* por *motivos*. Nada en el schema, el código ni la UI nombra un rubro ni un concepto propio de uno: no hay «producción», «receta», «ingrediente» ni «porción» — hay *composición*, *componente* y *unidades armables*. **Lote, caducidad y ubicación SÍ están** (Carlos, 2026-08-17, sobre un Excel real de cliente): son conceptos **genéricos** de inventario —los usa una farmacia, una tienda de alimentos, una refaccionaria, una ferretería con rollos— y entran como **opt-in por producto** (`tracks_lots`): quien no los necesita no ve un lote jamás. Lo que la LEY prohíbe son los *campos de rubro* («Sustancia Activa», «Tipo de Tueste»), no las dimensiones del stock. Que un tenant use el motivo `consumption` para "insumos de limpieza" o `expired` para "vencidos" es uso suyo del vocabulario neutro. Verificable por grep (ver Definición de fase completa).
>
> Incluye entradas y salidas con motivo, traspasos en dos pasos con estado `in_transit`, inventario físico por planilla con reconciliación, kardex y stock por almacén respetando el alcance del usuario, y las guardas que F2 dejó preparadas para esta fase. Ver [ARQUITECTURA.md § 6 — Fase 3](ARQUITECTURA.md#fase-3--movimientos-de-inventario-5-6-semanas), [CASOS_DE_USO.md § 3.5](CASOS_DE_USO.md#35-movimientos-de-inventario), [VISTAS.md § 8](VISTAS.md#8-movimientos) y [FLUJOS.md § 5 y § 7](FLUJOS.md#5-movimientos-de-inventario).

### Convenciones que esta fase codifica

**El modelo, en una frase:** `stock_movements` es la **única fuente de la historia** (append-only, blindada por privilegios: la app no puede hacer UPDATE ni DELETE) y `stock_by_warehouse` es su **proyección** (saldo actual por producto y almacén, la que lee el POS y la BOM); para los productos con `tracks_lots`, `stock_lots` es la **segunda proyección** (saldo por lote, almacén y ubicación) cuya suma **siempre** iguala a la primera; toda operación tiene un **encabezado** en `inventory_documents` (folio, tipo, estado, almacén, motivo, quién y cuándo) con sus líneas capturadas en `inventory_document_lines` — **ambas mutables mientras el documento está en `draft`**; al **confirmar** nacen los `stock_movements` (esos sí, append-only para siempre) y recién ahí se mueve el saldo; y toda escritura pasa por UN servicio (`StockLedgerService.apply`) que agrupa líneas, bloquea filas con `FOR UPDATE` en orden determinista, valida, inserta movimientos y actualiza saldos en la misma transacción — entradas, salidas, recepción de traspaso, conteo físico y, en F4, la venta, son **llamadores** de ese servicio, nunca escritores propios.

**Primera vez del proyecto en dos cosas** — y por eso F3-CORE es el módulo crítico: hasta hoy no hay un solo `SELECT … FOR UPDATE` ni `$queryRaw` en código de negocio del API, y ningún service usa `Prisma.Decimal` (F2 pasa los Decimals por `Number()`). F3 introduce concurrencia real y aritmética decimal exacta. Ambas cosas se prueban con tests de integración contra Postgres real, no con mocks.

**Permisos nuevos** (llegan por migración data-only, patrón `ON CONFLICT DO NOTHING`):

| Code | Qué habilita | TenantAdmin | Manager | POS_Seller | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| `inventory:read` | Kardex, stock por almacén, traspasos (ver), stock en tránsito | ✅ | ✅ | ❌ | ✅ (automático por `:read`) |
| `inventory:movement` | Entradas, salidas, confirmar recepción, plantilla y reconciliación de conteo | ✅ | ✅ | ❌ | ❌ |
| `inventory:manage` | Cancelar traspaso, **aprobar** inventario físico | ✅ | ❌ (`MANAGER_EXCLUDED_CODES`) | ❌ | ❌ |

POS_Seller no recibe ninguno: F4 decide qué necesita el POS (`POS_SELLER_CODES` es un set explícito). Gotcha heredado: la migración no bumpea el perm-epoch — los usuarios logueados los ven tras su próximo refresh.

**Motivos (`reason_code`) — el enum nace completo:**

| `reason_code` | Dirección | Qué exige la API | Quién lo emite |
|---|---|---|---|
| `invoice` | entry | `reference` (nº de documento) + `unitCost` por línea | F3-ENTRY |
| `adjustment` | entry / exit | `reasonNote` (`authorizedBy` opcional) | F3-ENTRY / F3-EXIT |
| `transfer` | exit (despacho) / entry (recepción) | `linkedWarehouseId`; en recepción además `transferId` | F3-EXIT / F3-TRANSFER-03 |
| `customer_return` | entry | `reasonNote` (`reference` opcional: referencia externa) | F3-ENTRY |
| `loss` | exit | `reasonNote` | F3-EXIT |
| `consumption` | exit | `reference` (área / concepto) | F3-EXIT |
| `expired` | exit | `reasonNote` | F3-EXIT |
| `physical_count` | entry + exit | interno: solo lo emite la aprobación del conteo | F3-COUNT-03 |
| `sale` | exit | **reservado F4** (los endpoints directos lo rechazan con 422 `inventory.reason_not_allowed`) | F4 (llama al ledger) |
| `sale_return` | entry | **reservado F4** (anulación / devolución ligada a venta; `customer_return` queda para la devolución manual sin venta) | F4 |

La lista, la dirección válida de cada motivo y las reglas de campos viven en `packages/shared` (`REASONS_BY_DIRECTION`, `REASON_RULES`) y son la misma fuente para el enum Prisma, el CHECK SQL, el `superRefine` de los DTOs y los formularios reactivos del front — con **test de contrato** para que no diverjan (patrón `UNITS` vs tabla `units`).

**Códigos HTTP de esta fase:** `400` = forma inválida (Zod, errores por ruta `lines.0.quantity`) · `422` = regla de negocio sobre cantidades/estado del stock (stock insuficiente, presentación solo-enteros, almacén inactivo, motivo reservado) · `409` = conflicto de estado o unicidad (compuesto sin stock, traspaso ya cerrado, presentación en uso) · `403` = almacén fuera del alcance del usuario · `404` = no existe o no visible.

**Frontend:** `routes/` + `components/inventory` + `lib/inventory` (la convención `features/` se abandonó en F2). Rutas nuevas: `/movements/entries`, `/movements/exits`, `/movements/counts` (los tres son **listados con buscador por folio, filtro de estatus y botón de crear**, tres montajes del mismo componente), `/movements/documents/$id` (captura del borrador y detalle del confirmado) y `/movements/transfers`; tabs **Kardex** y **Stock por almacén** dentro del detalle de producto (`/catalog/products`).

**Decisiones de alcance (LEY de esta atomización):**

| Tema | Decisión |
|---|---|
| Lote / caducidad / ubicación | **Entran en F3** (Carlos, 2026-08-17, revirtiendo un diferimiento previo tras mostrar un Excel real de cliente: KY6 con lotes st30/st10/st60 y el requisito "al vender, resta del que vence el 01/07"). Modelo de **dos niveles**: `stock_by_warehouse` sigue siendo el total; `stock_lots` es el detalle **solo** para productos con `products.tracks_lots = true`. El jabón nunca ve un lote; la aspirina ve tres filas. Se descartó "lote en la PK de `stock_by_warehouse` con un default para los que no lo usan": un `00-00-00` en caducidad es un string mentiroso (no ordena, no alerta), todos los tenants pagarían la granularidad y el día que uno quiera lotes tendría miles de filas con el default fantasma que migrar |
| Caducidad | Propiedad **del lote**, no de la fila: `product_lots (product_id, lot_code, expires_at DATE NULL)` `UNIQUE(product_id, lot_code)`. El mismo lote en dos almacenes comparte fecha (así funciona un lote de fabricante) |
| Ubicación | **Parte el stock**: `stock_lots (lot_id, warehouse_id, location) → quantity` — "hay 5 en A-3 y 15 en B-1" son dos filas. Texto libre `VARCHAR(64)`, `''` = sin ubicación; **sin catálogo de racks** (se normaliza después si hace falta) |
| FEFO | En **salida** de un producto con lote, `StockLedgerService.apply` elige el lote con `expires_at` más próximo (`NULLS LAST`), desempate por `lot_code`; si un lote no alcanza, sigue con el siguiente en la misma tx (una línea de entrada puede volverse N movimientos, uno por lote). El usuario puede **forzar** un lote explícito (`lotId` en la línea) — el POS de F4 no lo hace, hereda FEFO. Invariante verificada por test: `Σ stock_lots(product, warehouse) == stock_by_warehouse(product, warehouse)` |
| Conteo con lotes | Una **sola** plantilla: los productos con `tracks_lots` ocupan **una fila por (lote, ubicación)** con `lot_code`, `expires_at`, `location`; los demás una fila con esas columnas vacías. Un `lot_code` **nuevo** en la planilla contada se **crea** (mercancía recibida sin registrar) — pide `expires_at` si el producto lo exige |
| Enum `reason_code` | Nace **completo** con `sale` y `sale_return` reservados para F4 (agregar valores a un enum Postgres después es una migración más y F4 ya sabe que los necesita); **`production` se elimina** |
| Productos compuestos | **Nunca tienen stock persistido**: entrada de compuesto → 409 `inventory.composite_has_no_stock`; salida `consumption`/`expired` **expande** componentes; cualquier otro motivo → 409; excluidos de la plantilla de conteo y de traspasos |
| Expansión de composición en salida | `cantidad × qty_i × (1 + waste_i)`, anidados en recursión — la **misma fórmula** que `availability` para que "alcanza para N" y lo que realmente se descuenta coincidan; cada movimiento generado guarda `parent_product_id` (el compuesto que lo originó) para que el kardex lo explique |
| Costo promedio ponderado | **F5.** F3 solo **registra** `unit_cost` (obligatorio en `invoice`), como lo tecleó el usuario: costo por unidad de la presentación capturada, `DECIMAL(14,2)` con `moneyAmount()`; F5 lo lleva a base_unit con el `factor` de la presentación referenciada. `cost-estimate` de BOM sigue con `cost/factor` (solo cambia su nota) |
| Bloqueo de almacén durante conteo | **No** (Carlos): la aprobación es una tx con `FOR UPDATE` que relee el teórico; si algo se movió entre reconciliación y aprobación queda como **drift auditado**, el saldo final es igual el contado |
| Desempate cronológico del kardex | `stock_movements.seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE`: `now()` es el del inicio de la tx (las N líneas de una factura comparten `created_at`) y UUID v4 no ordena → sin `seq`, el `balanceAfter` por window function daría saldos intermedios **falsos** entre líneas del mismo lote (el bug del ORDER BY de F2-PRESENT, en su peor forma). Orden total del kardex: `created_at DESC, seq DESC`. `seq` no se expone como dato de negocio (el cursor de paginación puede ir opaco) |
| **Folio: lo lleva TODO movimiento** (Carlos, 2026-08-18) | **TRES series por tenant**: `ENT` Entrada · `SAL` Salida · `INV` Inventario físico. `VTA` **reservada para F4**. El motivo (factura, merma, ajuste, **traspaso**) viaja **dentro** del documento, no en el folio. **Corrección del mismo día, a pedido de Carlos:** la primera versión tenía 5 series con `TRA` y `REC` propias — y eso **contradecía la regla**, porque un traspaso *es* una Salida con `reason_code='transfer'` y su recepción *es* una Entrada con el mismo motivo (así está el modelo desde CU-MOV-01/03). Un traspaso es `SAL-000019` y su recepción `ENT-000043`; se encuentran filtrando por motivo. Formato `${prefix}-${n.padStart(6,'0')}`, crece más allá de 6 dígitos sin romper |
| Secuencia del folio | Tabla `tenant_sequences (tenant_id, key, next_value)` con `INSERT … ON CONFLICT DO UPDATE … RETURNING`; único por `(tenant_id, folio)`. Se descartó `MAX+1` (lock de tabla) y `SEQUENCE` global (revela volumen entre tenants). Se toma **al crear el borrador, en una transacción corta de milisegundos** — no dentro de la transacción del ledger: el lock de la fila `(tenant, key)` se suelta enseguida en vez de sostener todo el posteo. **Esto suaviza el gotcha que se había anotado para F4**: el POS puede tomar su folio al abrir el carrito, no al cobrar |
| El folio se asigna al **crear el borrador** (Carlos, 2026-08-18) | Es lo que permite retomar un movimiento a medio cargar buscándolo por su número. La serie **igual no pierde números**: un borrador abandonado no desaparece, queda `canceled` con su folio — quien audita ve qué pasó con cada uno |
| `discrepancies JSONB` en `Transfer` | **Se elimina**: la diferencia se **deriva** de `quantity_sent − quantity_received` en `transfer_lines` (una sola verdad); la nota explicativa es una por traspaso → `transfers.discrepancy_note TEXT` obligatoria si alguna línea recibió menos; el detalle por línea queda en el audit log |
| Campos contextuales del outline (nº documento, proveedor, autorizador, referencia de venta, área/concepto) | Genérico: `reference VARCHAR(120)` (nº de documento, orden, concepto, referencia externa) + `authorized_by UUID NULL` FK `users` + el resto en `reason_note`; **sin FK a proveedor** (no existe catálogo de proveedores; un tenant puede armar el suyo como subcatálogo y F5+ decide si se liga) |
| Agrupación de una operación | **`inventory_documents` es el ENCABEZADO** y `stock_movements.document_id` (FK RESTRICT) la línea. F3-DB-01 nació con `batch_id UUID` —un agrupador implícito, sin fila propia donde colgar folio, tipo, motivo o autorizador (hoy esos campos se repiten en CADA línea)— y **F3-DOC-01 lo reemplaza por `document_id`**: tener las dos cosas sería la misma verdad escrita dos veces. La tabla está **vacía en producción**, así que la migración es limpia |
| Estados del documento (Carlos, 2026-08-18) | `draft → confirmed` (escribe movimientos y mueve stock) o `draft → canceled` (queda el folio, sin stock). **Un confirmado nunca vuelve a borrador**: corregirlo es registrar otro movimiento. Todas las FK en `RESTRICT`, incluidas las opcionales (regla de F3-DB-01) |
| Inmutabilidad de lo confirmado | El documento **ya no puede blindarse con `REVOKE UPDATE, DELETE`** — un borrador se edita. La garantía pasa a un **trigger `BEFORE UPDATE OR DELETE` que revienta si `OLD.status <> 'draft'`**; sería el **primer trigger del proyecto** y es el único modo honesto de sostener la promesa. `stock_movements` **sí conserva el REVOKE**: nace al confirmar y no se toca nunca más |
| Líneas capturadas vs movimientos | `inventory_document_lines` (mutable) guarda **lo que el usuario capturó**; `stock_movements` (append-only) **lo que el ledger hizo**. No es duplicación: la línea dice *"3 cajas de PAR-500"* y los movimientos dicen *"36 unidades del lote st10 + 12 del st30"* — FEFO parte una línea en N movimientos y un compuesto la expande en componentes. Se conservan las dos: la línea explica el papel, el movimiento explica el saldo |
| Continuar el borrador de otro | Cualquiera con `inventory:movement` sobre ese almacén puede retomarlo. **Es la razón de que el borrador viva en el servidor y no en el navegador**: que el del turno siguiente termine lo que quedó a medias. Sin bloqueo de edición (last-write-wins); el `confirm` usa `UPDATE … WHERE status='draft'` con `rowCount = 1` como lock lógico → dos confirmaciones simultáneas dan una 201 y una 409 |
| Vista previa = el borrador | **No hay endpoint de previa aparte.** El detalle del borrador (`GET /inventory/documents/:id`) ya devuelve las filas resueltas con **`stockBefore` y `stockAfter`** (el corazón del pedido: ver la suma al stock antes de que ocurra), `newLot`, la expansión de compuestos, el reparto FEFO que se aplicaría, `summary` y `errors[]` por línea. Un concepto menos y sin duplicar validaciones. **Corrección del 2026-08-18:** la primera versión definía un `POST …/preview` stateless "sin tabla de borradores" — incompatible con retomar por folio, que es lo que Carlos necesita. El Excel pasa a `POST /inventory/documents/:id/lines/import`, que **agrega líneas al borrador** |
| PDF del documento | Renderizado **en el servidor** con **`pdfmake`**: la tabla tiene que **paginar sola con encabezado repetido** (un inventario físico son 500 líneas) y `pdfmake` lo hace declarativo donde `pdfkit` exigiría paginar a mano; server y no browser para que el papel salga idéntico venga de donde venga y para que F4/F5 puedan mandarlo por mail sin reescribir el layout. Contenido (Carlos): encabezado con `legalName` + `taxId` del tenant, folio, tipo, almacén, fecha, quién registró, motivo, referencia y nota; tabla de líneas; pie con firmas **Entregó / Recibió / Autorizó**. **Sin logo** (exige almacenamiento de archivos, fuera de F3). **Sin total de unidades**: sumar 36 unidades + 2.5 kg + 400 ml da un número que no significa nada — el pie muestra total de LÍNEAS y la cantidad va por línea con su unidad. Encabezado y pie comunes, **cuerpo por tipo** (una entrada muestra presentación y costo; un conteo muestra teórico/contado/diferencia). Un borrador sale marcado **«BORRADOR»** y un anulado **«ANULADO»**: un papel sin marca es un papel que alguien va a firmar |
| Entrega del PDF | Binario `application/pdf` con `Content-Disposition`, **no** base64 en JSON: es el patrón que ya usa `downloadImportTemplate()` (`apps/web/src/lib/products/import-api.ts`) con axios `responseType: 'blob'`, porque un `<a href>` plano iría **sin el Bearer** (el access token es solo-memoria) y devolvería 401 |
| Fecha editable de los mockups (`Fecha *`) | **Sin backdating en F3**: `created_at = now()`; el kardex es cronología real; el campo no se renderiza. Si un caso lo pide, se evalúa en F5 con `effective_at` separado |
| Traspaso: cuándo se mueve el stock | La salida `transfer` **descuenta el origen al despachar** (crea `Transfer in_transit`); la entrada al **confirmar** suma al destino lo **recibido**; el traspaso **cancelado NO devuelve stock** (queda como pérdida del origen hasta un `adjustment` explícito) |
| Entrada `transfer` sin `transferId` (CU-MOV-01 4a, "huérfana") | **No permitida en F3** (422 `inventory.transfer_entry_requires_transfer`): la corrección de un traspaso mal registrado se hace con `adjustment`, que sí queda explicada; el motivo `transfer` no aparece en el form de entrada — se llega por la vista de traspasos |
| Recepción de traspaso | Cantidades en **base_unit** (sin presentación: `quantity_sent` ya está en base); **todas** las líneas del traspaso deben venir; `0 ≤ recibido ≤ enviado` — recibido > enviado **bloqueado** (el excedente entra como `adjustment`); una recepción cierra el traspaso, no hay recepciones parciales |
| Kardex | `GET /products/:id/kardex` (es una vista **del producto**, coincide con la tab de VISTAS §8.5 y CU-MOV-06; el controller vive en el módulo `inventory`); paginación server-side con orden total `created_at desc, seq desc`; **`balanceAfter` server-side** (window function por almacén sobre TODO el histórico del producto en scope, antes de filtrar y paginar) — un `SUM() OVER` es barato y sin saldo el kardex no sirve para auditar |
| Stock en tránsito | Endpoint chico **incluido** (`GET /inventory/in-transit`, agregado por producto de líneas de traspasos `in_transit` con origen en scope) y mostrado como fila en la tab «Stock por almacén»; el reporte completo con exportación es F5 |
| Tab «Stock por almacén» (VISTAS L425) | **Incluida**: `GET /products/:id/stock` por almacén dentro del scope + total + en tránsito + badge bajo `stock_min` |
| Idempotencia (`Idempotency-Key`) | **No en F3** — deuda anotada para F4/POS, donde el doble tap importa |
| Concurrencia | `SELECT … FOR UPDATE` sobre `stock_by_warehouse` **ordenado por (product_id, warehouse_id)** en TODA transacción del ledger (evita deadlocks entre operaciones cruzadas); líneas del mismo (producto, almacén) se **suman antes de validar**; fila inexistente → **upsert** (`INSERT … ON CONFLICT DO NOTHING`) antes del lock; el CHECK `>= 0` de F2 es la red, el guard es el service. `withTenantContext` (tx interactiva, timeout 10 s) alcanza: el `FOR UPDATE` va por `tx.$queryRaw` dentro; facturas grandes con **un** `createMany`, nunca N `create`; aislamiento READ COMMITTED (con REPEATABLE READ el `FOR UPDATE` daría errores de serialización en vez de esperar) |
| Cantidades | `DECIMAL(14,4)`; máximo **4 decimales** en la entrada (`QUANTITY_DECIMALS` + `hasValidQuantityScale` en shared, misma regla en el form y en el DTO — patrón de `money`); `> 0` siempre; en servicios SIEMPRE `Prisma.Decimal` (`.plus/.minus/.lt`), nunca `Number()`; `$queryRaw` devuelve NUMERIC como string → envolver |
| Inventario físico | **Sin tabla de sesiones de conteo** (stateless: `template` → `reconcile` puro/dry-run → `approve` transaccional); filas con `counted` vacío = "no contado" (se omiten y se reportan); solo las líneas con diferencia generan movimientos: **salida `physical_count` del teórico total + entrada `physical_count` del contado** (una lectura clara en el kardex; las iguales quedan como coincidencias en el audit) |
| Alcance por almacén | Primer consumidor real de `@CurrentUserScope()`: helper único `assertWarehouseInScope` (403) + `warehouseScopeWhere`; el **destino** de un traspaso NO exige scope del emisor (se puede enviar a un almacén que no se administra); almacén inactivo → 422 en cualquier movimiento; `GET /warehouses?scoped=true` devuelve activos ∩ scope para los selectores |
| UI de alcance por almacén en usuarios | **Se incluye en F3** (F3-NAV-03): F2-SCOPE-03 quedó solo en API y sin ella la demo "el Manager solo ve su almacén" no existe; son 2 h sobre un endpoint terminado |
| Append-only | Reforzado por **privilegios**: `REVOKE UPDATE, DELETE ON stock_movements FROM sellpoint_app` (patrón `units`/`currencies`), además de que ningún service lo intente. FKs `ON DELETE RESTRICT` desde movimientos hacia productos, presentaciones y almacenes: el histórico no se borra |
| Deudas F2 que se pagan acá | `assertDeletable` de presentaciones, "no desactivar almacén con stock", `products.remove` con movimientos, `TenantTransactionsGate`, `availability` con scope, comentario "su receta" en `products.service.ts:328` (LEY) |

**Herencias de F2 que esta fase honra:**

- `stock_by_warehouse` **ya existe** (F2-DB-08, PK `(product_id, warehouse_id)`, `quantity DECIMAL(14,4) CHECK >= 0`, RLS): F3 la **muta**, no la crea.
- `product_presentations.factor` / `.allow_fractional_input` / `.is_purchasable` son la fuente de la conversión a base_unit y de la validación de enteros; el nombre de la presentación viaja en el error 422.
- `presentations.service.ts#assertDeletable(tx, id)` es el punto ÚNICO de extensión para "presentación en uso" (409 `products.presentation_in_use`).
- `warehouses` no tiene DELETE (desactivar); la guarda "no desactivar con stock" (CU-ALM-02) está documentada como pendiente de F3 en `warehouses.service.ts`.
- `composition.service.ts#availability` suma todos los almacenes sin scope y `costEstimate` usa `cost/factor` con nota "F3 lo reemplaza": F3 aplica scope al primero y solo corrige la nota del segundo (→ F5).
- `tenant-transactions.gate.ts#hasTransactions()` devuelve `false` con `TODO(F3-F4)`: F3 lo implementa (`stock_movements` > 0 bloquea cambio de currency).
- `@CurrentUserScope()` (`UserScope { warehouseIds: string[] | "all" }`) existe sin consumidores; `products.service.ts#assertBaseUnitChangeable` ya cuenta stock > 0; `products.remove` no verifica movimientos.
- Patrón RLS canónico (ENABLE + FORCE, `tenant_isolation` con NULLIF, `tenant_id` desnormalizado, 4 canarios por tabla — molde `f2-rls.integration.spec.ts` con `RLS_TABLES`); patrón permisos (migración data-only + `resolveRolePermissionCodes()` + test); orden TOTAL en listas; `ZodValidationPipe` con errores por ruta; guardián `message-keys.spec.ts` (toda clave emitida existe en es/en); e2e por módulo con `registerAndLogin()`; web con routeTree real + api mockeada.
- Helpers a reusar: `lib/field-errors.ts#fieldErrorsOf`, `components/common/confirm-dialog.tsx`, `lib/products/money.ts` (`MONEY_STEP`, `moneyScaleError`) y `apps/api/.../products/money.ts#moneyAmount()`, `packages/shared/units.ts` (`unitName`, `convertUnits`), `spreadsheet.ts` (CSV/XLSX, base64) — **se muda de `modules/products/` a `common/spreadsheet/` en F3-DOC-05**: la usan conteo, entradas y salidas, ya no es detalle de un módulo, `composition-graph.ts` para la expansión.

**Clasificación SDD:** F3-CORE, F3-ENTRY, F3-EXIT, F3-TRANSFER, F3-COUNT, F3-KARDEX, F3-LOTS, F3-DOC = **SDD COMPLETO** (F3-DOC sube a completo: el ciclo de vida del documento y el trigger de inmutabilidad son reglas de negocio sobre datos críticos) (feature de negocio sobre datos críticos, concurrencia y traspasos) · F3-DB, F3-GUARDS, F3-NAV = **SDD LIGERO** (modelado mecánico con patrón heredado, puntos de extensión ya documentados y wiring de UI) — matiza el "F3-* todos" de §1.1 con el mismo criterio que F2 aplicó a DB/UOM/WH.

---

### Módulo F3-DB — Modelos, Seguridad de Datos y Permisos

> Patrón canónico heredado: PK `gen_random_uuid()`, `@@map` snake_case, `tenant_id` desnormalizado en TODA tabla, CHECK/índices/REVOKE a mano en la migración, RLS ENABLE + FORCE con `tenant_isolation`. Los CHECKs son la red; el guard de verdad vive en F3-CORE. Índices parciales, CHECKs, IDENTITY y REVOKE no viven en el schema Prisma: documentarlos en la migración y cubrirlos con el test de schema (mismo riesgo asumido en F2 con el UNIQUE parcial de barcode).

- [x] **F3-DB-01** — Enums + modelo `StockMovement` (append-only)
  - **Salida:** enums Prisma `MovementDirection { entry, exit }` y `MovementReason { invoice, adjustment, transfer, customer_return, sale, sale_return, loss, consumption, expired, physical_count }`; modelo `StockMovement` → tabla `stock_movements`: id, **`seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE`** (desempate cronológico, en migración), tenant_id, batch_id UUID NOT NULL, product_id FK **RESTRICT**, warehouse_id FK **RESTRICT**, presentation_id UUID NULL FK **RESTRICT**, parent_product_id UUID NULL FK RESTRICT (compuesto que originó una salida expandida), direction, reason_code, reason_note TEXT NULL, reference VARCHAR(120) NULL, authorized_by UUID NULL FK users, linked_warehouse_id UUID NULL FK warehouses, transfer_id UUID NULL (FK se agrega en F3-DB-02), quantity DECIMAL(14,4), unit_cost DECIMAL(14,2) NULL, created_by UUID FK users, created_at timestamptz default now(); **sin `updated_at`**; CHECK `quantity > 0`; CHECK `unit_cost IS NULL OR unit_cost >= 0`; CHECK dirección×motivo (`entry` ∈ {invoice, adjustment, transfer, customer_return, sale_return, physical_count}; `exit` ∈ {adjustment, transfer, sale, loss, consumption, expired, physical_count}); CHECK `(reason_code = 'transfer') = (linked_warehouse_id IS NOT NULL)`; CHECK `linked_warehouse_id IS DISTINCT FROM warehouse_id`; índices `(tenant_id, product_id, created_at DESC, seq DESC)`, `(tenant_id, warehouse_id, created_at DESC)`, `(tenant_id, batch_id)` (→ `(document_id)` en F3-DOC-01), `(presentation_id)`, `(transfer_id) WHERE transfer_id IS NOT NULL`
  - **Verificar:** `inventory-schema.integration.spec.ts`: CHECK rechaza `quantity <= 0`, `entry`+`loss`, `transfer` sin `linked_warehouse_id`, `linked = warehouse`; FK RESTRICT impide borrar un producto o presentación con movimientos; `seq` es creciente entre dos inserts de la misma transacción; `prisma migrate` aplica limpia
  - **Depende de:** —
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-18, migración `20260818013308_f3_stock_movements`, 32 tests en `inventory-schema.integration.spec.ts`). Dos desvíos del plan, ambos hacia arriba: (a) **todas** las FK van `RESTRICT`, también las opcionales — Prisma les pone `SetNull` por defecto y en una tabla append-only eso es un UPDATE silencioso de la historia; (b) `created_at` usa `transaction_timestamp()` vía `dbgenerated`, porque con `@default(now())` **el timestamp lo genera el CLIENTE** (verificado con contraprueba) y la hora del asiento tiene que venir de la base. El `@unique` de `seq` se declara en el schema, no solo en el SQL: `migrate diff` probó que si no, el próximo `migrate dev` lo borra. **`batch_id` Y `transfer_id` los reemplaza `document_id` en F3-DOC-01** (decisión de folios y borradores del 2026-08-18): los dos son datos de CABECERA y esta tabla nació con un agrupador implícito; pasa a colgar de un encabezado con folio, estado y su propio `transfer_id`. La migración es limpia porque la tabla está vacía en producción

- [x] **F3-DB-02** — Modelos `Transfer` y `TransferLine`
  - **Salida:** enum `TransferStatus { in_transit, completed, canceled }`; `Transfer` → `transfers`: id, tenant_id, **sin `folio` propio** (el folio del traspaso ES el de su documento de despacho, un `SAL-…` — un folio, una fuente), origin_warehouse_id FK RESTRICT, destination_warehouse_id FK RESTRICT, status default in_transit, created_by/created_at, received_by/received_at NULL, canceled_by/canceled_at/cancel_reason NULL, discrepancy_note TEXT NULL, **sin punteros a documentos** (se descartaron `dispatch_document_id`/`receipt_document_id`: eran el reverso de `inventory_documents.transfer_id` —dos punteros al mismo hecho— y además **imposibles de rellenar**, porque el documento se confirma después de crear el traspaso; el único enlace es el del documento, con UNIQUE parcial `(transfer_id, type)` que garantiza a lo sumo un despacho y una recepción); CHECK `origin_warehouse_id <> destination_warehouse_id`; CHECK `(status = 'completed') = (received_at IS NOT NULL AND received_by IS NOT NULL)`; CHECK `(status = 'canceled') = (canceled_at IS NOT NULL AND cancel_reason IS NOT NULL)`; índices `(tenant_id, status, created_at DESC)`, parciales `(origin_warehouse_id) WHERE status = 'in_transit'` y `(destination_warehouse_id) WHERE status = 'in_transit'`. `TransferLine` → `transfer_lines`: id, tenant_id, transfer_id FK CASCADE (los transfers nunca se borran; cascade inocuo), product_id FK RESTRICT, quantity_sent DECIMAL(14,4) CHECK > 0, quantity_received DECIMAL(14,4) NULL CHECK `>= 0 AND <= quantity_sent`; `@@unique([transferId, productId])`; índice `(product_id)`. **Sin `discrepancies JSONB`** (se deriva). La FK `transfer_id` la crea F3-DOC-01 sobre `inventory_documents`, no sobre `stock_movements` — por eso **esta tarea va ANTES de F3-DOC-01** (era un ciclo de FKs sin declarar: se resolvió dejando un solo puntero)
  - **Verificar:** integración: origen = destino rechazado; `quantity_received > quantity_sent` rechazado; `canceled` sin `cancel_reason` rechazado; `completed` sin `received_by` rechazado
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h
  - **Hecho** (2026-08-18, migración `20260818032302_f3_transfers`, 13 tests nuevos en `inventory-schema.integration.spec.ts` → 45 en el archivo). Un desvío del plan: los CHECK de estado se escribieron como **equivalencia** (`(status='completed') = (received_at IS NOT NULL AND received_by IS NOT NULL)`) y no como implicación, así que también rechazan el caso inverso — un `in_transit` con fecha de recepción. El test lo fija. Se agregó un **guardián** de que `transfers` no tenga `folio`, `dispatch_document_id`, `receipt_document_id` ni `discrepancies`: son las cuatro columnas que el diseño descartó y que sería fácil reponer sin querer

- [x] **F3-DB-03** — Tabla `tenant_sequences` + `nextFolio()`
  - **Salida:** modelo `TenantSequence` → `tenant_sequences` (tenant_id, key VARCHAR(32), next_value BIGINT default 0; PK `(tenant_id, key)`); helper `nextFolio(tx, tenantId, key, prefix)` en `apps/api/src/modules/inventory/folio.ts` que ejecuta `INSERT … VALUES (tenant, key, 1) ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = tenant_sequences.next_value + 1 RETURNING next_value` y formatea `${prefix}-${n.padStart(6,'0')}` (crece más allá de 6 dígitos sin romper; **sin huecos**: al ser una tabla y no un `SEQUENCE`, un ROLLBACK deshace el incremento — la Salida decía antes 'huecos aceptados', resto del diseño previo que contradecía a su propio Verificar); las **3 series** vienen de `FOLIO_PREFIXES` en `packages/shared` (F3-DOC-03): `ENT`, `SAL`, `INV`, con `VTA` reservada para F4. **Docblock obligatorio con el gotcha del lock**: el `ON CONFLICT DO UPDATE` toma la fila `(tenant, key)` y no la suelta hasta el COMMIT — por eso `createDraft` lo llama en una **transacción corta propia** y NO dentro de la del ledger: así el lock dura milisegundos en vez de todo el posteo. El mismo patrón le sirve a F4 para tomar el folio al abrir el carrito
  - **Verificar:** integración: 20 llamadas concurrentes en transacciones separadas producen 20 folios distintos y consecutivos; dos tenants arrancan ambos en `ENT-000001`; series distintas del mismo tenant no se pisan (`ENT-000001` y `SAL-000001` conviven); una tx que hace rollback **no** deja hueco en la serie; el lock se libera antes de que arranque cualquier posteo
  - **Depende de:** —
  - **Estimación:** 1 h
  - **Hecho** (2026-08-18, migración `20260818...f3_tenant_sequences`, 6 tests en `folio.integration.spec.ts`). Un hallazgo: **`@updatedAt` de Prisma también es del lado del CLIENTE**, igual que `@default(now())` — como esta tabla la escribe solo `nextFolio` por `$queryRaw`, el atributo se salteaba y el `NOT NULL` reventaba con 23502. Se modeló honesto: `@default(dbgenerated("transaction_timestamp()"))` sin `@updatedAt`, y el helper refresca la columna en el UPDATE. El test de 20 transacciones simultáneas pasa y es el que justifica el `ON CONFLICT DO UPDATE … RETURNING` frente a leer-y-actualizar

- [x] **F3-DB-04** — RLS + append-only en las tablas de la fase
  - **Salida:** migración SQL: ENABLE + **FORCE** ROW LEVEL SECURITY + policy `tenant_isolation` (NULLIF) en `stock_movements`, `inventory_documents`, `inventory_document_lines`, `transfers`, `transfer_lines`, `tenant_sequences` — **`product_lots` y `stock_lots` traen la suya en la migración que las crea** (F3-DB-06), no acá; `REVOKE UPDATE, DELETE ON stock_movements FROM sellpoint_app` — **solo sobre movimientos**: el documento y sus líneas se editan mientras son borrador, así que su inmutabilidad la sostiene el trigger de F3-DOC-02, no el privilegio (guardado con `IF EXISTS pg_roles`, patrón `units`; llega DESPUÉS del `ALTER DEFAULT PRIVILEGES` de F1, por eso hay que revocar explícito); `f3-rls.integration.spec.ts` con `RLS_TABLES = ['stock_movements','inventory_documents','inventory_document_lines','transfers','transfer_lines','tenant_sequences']` y los 4 canarios por tabla (propio ve / ajeno 0 / sin `set_config` 0 / WITH CHECK rechaza) + guardián estructural de FORCE
  - **Verificar:** la suite de integración pasa; UPDATE y DELETE sobre `stock_movements` como `sellpoint_app` fallan con 42501; sobre un `inventory_documents` en `draft` funcionan y sobre uno `confirmed` fallan (trigger, F3-DOC-02); INSERT funciona; `tenant_sequences` sí admite UPDATE
  - **Depende de:** F3-DB-01, F3-DB-02, F3-DB-03, F3-DOC-02
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-18, migración `20260818150000_f3_enable_rls`, 10 tests en `f3-rls.integration.spec.ts`). **Cambió el alcance y la dependencia:** el tablero juntaba el aislamiento de las 8 tablas acá, lo que obligaba a esperar a F3-DB-06/07 (lotes) y dejaba a las 6 tablas ya creadas **viviendo sin RLS mientras tanto** — hueco que se hizo visible cuando un test de F3-DOC-03 probó que un usuario de otro tenant podía anular un documento ajeno. Ahora esta tarea cubre las 6 que existen y **cada tabla nueva trae su RLS en la migración que la crea**. Contraprueba del FORCE hecha: se le quitó a `transfers` y el guardián estructural lo detectó (los canarios funcionales NO lo ven, porque `sellpoint_app` no es owner)

- [x] **F3-DB-05** — Migración data-only de permisos de F3
  - **Salida:** INSERT `ON CONFLICT DO NOTHING` de `inventory:read`, `inventory:movement`, `inventory:manage` (módulo `inventory`) + asignación a roles base existentes (SQL espejo de `resolveRolePermissionCodes`: TenantAdmin los 3, Manager read+movement, Viewer read, POS_Seller ninguno); `inventory:manage` entra a `MANAGER_EXCLUDED_CODES` en `role-catalog.ts` con su test; docblock con el gotcha perm-epoch
  - **Verificar:** `role-catalog.spec.ts` fija las 4 filas; e2e `permissions`: `GET /permissions` muestra los 3; Manager sin `inventory:manage`; Viewer con `inventory:read`
  - **Depende de:** —
  - **Estimación:** 1 h
  - **Hecho** (2026-08-18, migración `20260818160000_f3_permissions`). El test de `role-catalog` salió **rojo antes de tocar nada**: `inventory:manage` le caía a Manager por la regla implícita ("todo code que no esté en `MANAGER_EXCLUDED_CODES` es suyo"), que es justo la trampa que advierte el comentario del archivo. Quedó excluido con su porqué: cancelar un traspaso y aprobar un conteo son las dos operaciones de inventario que **no se deshacen solas**

- [x] **F3-DB-06** — Lotes: `products.tracks_lots` + modelos `ProductLot` y `StockLot` (con su RLS)
  - **Salida:** columna `products.tracks_lots BOOLEAN NOT NULL DEFAULT false` (opt-in por producto; **no** se puede apagar si el producto tiene filas en `stock_lots` con saldo > 0 — guarda en F3-LOTS-01); `ProductLot` → `product_lots`: id, tenant_id, product_id FK RESTRICT, lot_code VARCHAR(64), expires_at DATE NULL, created_at; `@@unique([productId, lotCode])`; índice `(tenant_id, product_id, expires_at)` (FEFO ordena por acá). `StockLot` → `stock_lots`: lot_id FK RESTRICT, warehouse_id FK RESTRICT, tenant_id, location VARCHAR(64) NOT NULL DEFAULT '' (`''` = sin ubicación; NOT NULL para que entre en la PK), quantity DECIMAL(14,4) default 0 CHECK >= 0, updated_at; `@@id([lotId, warehouseId, location])`; índices `(tenant_id)`, `(warehouse_id)`. Docblocks: caducidad es del LOTE (mismo lote en dos almacenes comparte fecha); ubicación PARTE el stock; `stock_by_warehouse` sigue siendo el total y `Σ stock_lots == stock_by_warehouse` es invariante del ledger, no de la DB
; **la misma migración enciende ENABLE + FORCE y la policy `tenant_isolation` en las dos tablas nuevas** y las suma a `RLS_TABLES` del spec de F3-DB-04 — una tabla no debería existir ni un commit sin aislamiento (lección de F3-DOC-03)
  - **Verificar:** integración: `lot_code` repetido en el mismo producto rechazado y permitido en otro producto; `(lot, warehouse, location)` duplicado rechazado; CHECK rechaza negativo; FK RESTRICT impide borrar un lote con saldo
  - **Depende de:** —
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-18, migración `20260818145604_f3_lots`, 10 tests en `lots-schema.integration.spec.ts`). Las dos tablas **nacen con su RLS en la misma migración** — primera aplicación de la regla que dejó F3-DB-04

- [x] **F3-DB-07** — `stock_movements` gana `lot_id` y `location`
  - **Salida:** columnas `lot_id UUID NULL FK product_lots RESTRICT` y `location VARCHAR(64) NULL` en `stock_movements` (qué lote y ubicación movió cada línea; NULL para productos sin lote); índice `(lot_id) WHERE lot_id IS NOT NULL`; CHECK `(lot_id IS NULL) OR (location IS NOT NULL)` (si hay lote, la ubicación viene siempre, aunque sea `''`); `transfer_lines` gana `lot_id UUID NULL FK` (un traspaso de producto con lote mueve un lote concreto) y su `@@unique` pasa a `[transferId, productId, lotId]`
  - **Verificar:** integración: movimiento con `lot_id` y `location NULL` rechazado; FK RESTRICT impide borrar un lote referenciado por un movimiento
  - **Depende de:** F3-DB-01, F3-DB-02, F3-DB-06
  - **Estimación:** 1 h
  - **Hecho** (2026-08-18, migración `20260818170000_f3_movement_lots`, 3 tests más → 13). **El `@@unique` de `transfer_lines` salió del schema a la migración, partido en DOS índices parciales**: agregar `lot_id` a un unique normal lo debilitaba en silencio, porque Postgres trata dos NULL como DISTINTOS y un producto **sin** lote podía repetirse en el mismo traspaso. Los parciales dicen la regla tal cual es — sin lote, un producto una vez; con lote, uno por lote (mismo gotcha que el unique de `barcode` en F2). Lo cazó un test de F3-DB-02 que se puso rojo al cambiar el índice

---

### Módulo F3-DOC — Documentos, Borradores, Folios y PDF

> **Todo movimiento es un documento con estado.** Nace en **borrador** con su folio al pulsar «Crear» desde el listado de su serie, se carga sola (a mano o por Excel), se puede retomar por folio después de que se cierre el sistema, y al **confirmar** escribe los movimientos y mueve el stock. Abandonarla la deja **anulada con su folio**: la serie nunca pierde un número. Tres series y nada más: `ENT`, `SAL`, `INV` — el traspaso es una `SAL` con motivo, su recepción una `ENT` con motivo.

- [x] **F3-DOC-01** — Tablas `inventory_documents` e `inventory_document_lines`
  - **Salida:** enums Prisma `InventoryDocumentType { entry, exit, physical_count }` y `DocumentStatus { draft, confirmed, canceled }`; `InventoryDocument` → `inventory_documents`: id, tenant_id, `folio VARCHAR(20)`, type, **status default `draft`**, warehouse_id FK **RESTRICT**, linked_warehouse_id UUID NULL FK RESTRICT, reason_code `MovementReason` NULL (se elige dentro del borrador), reference VARCHAR(120) NULL, reason_note TEXT NULL, authorized_by UUID NULL FK users RESTRICT, **transfer_id UUID NULL FK `transfers` RESTRICT** (el ÚNICO puntero entre documento y traspaso — ver nota de abajo), confirmed_at/confirmed_by NULL, canceled_at/canceled_by/cancel_reason NULL, created_by FK users RESTRICT, created_at, **`updated_at`** (un borrador cambia); `@@unique([tenantId, folio])`; CHECK `(status='confirmed') = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)`; CHECK `(status='canceled') = (canceled_at IS NOT NULL)`; CHECK `status <> 'confirmed' OR reason_code IS NOT NULL`; índices `(tenant_id, type, status, created_at DESC)`, `(tenant_id, folio)`, `(tenant_id, warehouse_id, created_at DESC)`, `(tenant_id, created_by, status)`, y **UNIQUE parcial `(transfer_id, type) WHERE transfer_id IS NOT NULL`** (un traspaso tiene a lo sumo un despacho y una recepción). `InventoryDocumentLine` → `inventory_document_lines`: id, tenant_id, document_id FK **CASCADE** (borrar un borrador se lleva sus líneas), line_no INT, product_id FK RESTRICT, presentation_id UUID NULL FK RESTRICT, quantity DECIMAL(14,4) NULL (un borrador admite una línea a medio llenar), unit_cost DECIMAL(14,2) NULL, lot_code VARCHAR(64) NULL, expires_at DATE NULL, location VARCHAR(64) NULL, counted/theoretical DECIMAL(14,4) NULL (solo `physical_count`), created_at, updated_at; `@@unique([documentId, lineNo])`; índice `(product_id)`. Migración: `stock_movements` **pierde `batch_id` Y `transfer_id`** (los dos son datos de cabecera: ya viven en el documento — misma regla que motivó toda la tabla) y **gana `document_id` UUID NOT NULL FK RESTRICT**; se cae el índice parcial de `transfer_id` y `(tenant_id, batch_id)` pasa a `(document_id)`. Limpia porque `stock_movements` está **vacía** en producción (verificar con `SELECT count(*)` antes de escribirla)
  - **Verificar:** `inventory-schema.integration.spec.ts` crece: folio repetido en el mismo tenant rechazado y permitido en otro; un documento `confirmed` sin `confirmed_by` rechazado; dos documentos de despacho para el mismo traspaso rechazados por el UNIQUE parcial; borrar un borrador borra sus líneas (CASCADE) y borrar un producto con líneas falla (RESTRICT); `stock_movements` ya no tiene `batch_id` ni `transfer_id` y no admite INSERT sin `document_id`; `prisma migrate diff` sin drift (ritual de F3-DB nacido en F3-DB-01)
  - **Depende de:** F3-DB-01, F3-DB-02
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-18, migración `20260818034546_f3_inventory_documents`, 16 tests nuevos → 61 en el archivo). La verificación de "tabla vacía" se hizo **probando que no existe un solo escritor** (`rg stockMovement.create` sobre `apps/api/src` sin `.spec.ts` → nada; el módulo `inventory` no existe), que es más fuerte que contar filas en un momento dado. El `ADD COLUMN document_id NOT NULL` **falla si hay filas** y eso queda documentado como deliberado: mejor que la migración se caiga a inventar un documento contenedor. Dos cosas que cazaron los tests: el `VARCHAR(20)` del folio rechazó unos fixtures de 25 caracteres (el formato real, `ENT-000042`, son 10), y **`otherTenantId` era una variable libre que ts-jest transpiló sin chistar** — el recordatorio de por qué existe `typecheck:full`

- [x] **F3-DOC-02** — Inmutabilidad de lo confirmado: trigger
  - **Salida:** migración con el **primer trigger del proyecto**: función `inventory_document_is_immutable()` que hace `RAISE EXCEPTION` con `ERRCODE = '42501'` si `OLD.status <> 'draft'`, y trigger `BEFORE UPDATE OR DELETE ON inventory_documents FOR EACH ROW`; el gemelo sobre `inventory_document_lines` mira el `status` de su documento. Docblock que explica **por qué acá no alcanza el `REVOKE`** que usan `stock_movements`, `units` y `currencies`: un borrador se edita, así que el privilegio no puede ser la barrera y el estado tiene que serlo
  - **Verificar:** integración: UPDATE sobre un documento `draft` funciona; el mismo UPDATE sobre uno `confirmed` falla con 42501; DELETE de una línea de un confirmado falla; DELETE de una línea de un borrador funciona; pasar de `confirmed` a `draft` es imposible (lo bloquea el mismo trigger)
  - **Depende de:** F3-DOC-01
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18, migración `20260818041500_f3_document_immutability`, 10 tests nuevos → 71 en el archivo). Dos desvíos hacia arriba: **(a) el trigger de líneas cubre también `INSERT`**, no solo UPDATE/DELETE — sin eso el encabezado quedaba intocable pero se le podía agregar una línea a un documento ya confirmado e impreso, que es el agujero más fácil de dejar abierto; **(b)** usa `SELECT … WHERE status <> 'draft'` + `IF FOUND` en vez de comparar un escalar, porque en el borrado en cascada de un borrador el padre ya no existe cuando corre el trigger de la línea, y así la regla se lee tal cual es ("frená solo si ENCONTRÁS un documento que ya no es borrador") en vez de razonar sobre un NULL. **Consecuencia con nombre para el confirm** (F3-ENTRY-01, F3-EXIT-01, F3-COUNT-03): el trigger mira `OLD.status`, así que la transición pasa pero **toda escritura posterior en la misma tx ya ve el documento confirmado** — si hay que tocar las líneas (el teórico de un conteo, por ejemplo) va ANTES de sellar. El título decía "trigger + RLS": la RLS de estas dos tablas vive en F3-DB-04, no acá

- [x] **F3-DOC-03** — `FOLIO_PREFIXES` + ciclo de vida del documento
  - **Salida:** en `packages/shared` `FOLIO_PREFIXES: Record<InventoryDocumentType, string>` = `{ entry: 'ENT', exit: 'SAL', physical_count: 'INV' }` + `RESERVED_FOLIO_PREFIXES = ['VTA']` (F4), con **test de contrato** que falla si el enum gana un tipo sin prefijo o si dos comparten prefijo (patrón `UNITS` vs tabla `units`); `documents.service.ts`: `createDraft(user, { type, warehouseId })` → **transacción corta** que toma `nextFolio` y crea el documento vacío (el lock de la serie se suelta enseguida, no espera al posteo); `cancel(user, id, reason?)` (solo `draft`); `assertDraft(id)`. El `confirm` vive en cada módulo (F3-ENTRY-01, F3-EXIT-01, F3-COUNT-03) porque cada tipo valida distinto, pero todos usan `markConfirmed(tx, id)` que hace `UPDATE … WHERE id = ? AND status = 'draft'` y exige `rowCount = 1` (lock lógico; 409 `inventory.document_not_draft` si 0)
  - **Verificar:** unit del contrato de prefijos (3 tipos, sin repetidos, `VTA` sin asignar); integración: dos `createDraft` del mismo tipo dan folios consecutivos; tipos distintos avanzan series independientes; dos `markConfirmed` concurrentes sobre el mismo borrador → uno pasa y el otro da 409; cancelar un confirmado → 409
  - **Depende de:** F3-DOC-02, F3-DB-03
  - **HUECO DETECTADO (2026-08-18):** no hay ninguna tarea que exponga `createDraft` ni `cancel` por HTTP. El tablero tiene `POST …/lines`, `…/lines/import` y `…/confirm`, pero **falta `POST /inventory/documents`** — y sin él el botón «Crear entrada» de F3-DOC-08 no tiene a qué llamar. Va a **F3-DOC-06**, que ya es dueño del `DocumentsController`, cuando existan el módulo (F3-CORE-02) y los permisos (F3-DB-05)
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-18: `packages/shared/src/inventory.ts`, `documents.service.ts`, 10 tests de integración + 5 de contrato). **`markConfirmed` y `assertDraft` reciben `tenantId`** (el tablero decía `markConfirmed(tx, id)`): un test probó que sin filtrar por tenant un usuario de OTRO tenant podía anular el documento ajeno — yo me había apoyado en una RLS que **todavía no existe** (llega en F3-DB-04), y el molde del proyecto es filtrar por `tenantId` **además** de la RLS (`warehouses.service.ts`). Contraprueba hecha: se quitó el filtro y el test volvió a rojo. El guardián `message-keys.spec.ts` obligó a crear `i18n/{es,en}/inventory.json` en el mismo commit

- [x] **F3-DOC-04** — CRUD de líneas del borrador
  - **Salida:** `DocumentLinesController` (`inventory:movement`, scope del almacén del documento, **solo si `status='draft'`** → 409 si no): `POST /inventory/documents/:id/lines` (agrega, devuelve la línea con `lineNo`), `PATCH …/lines/:lineId`, `DELETE …/lines/:lineId`, `PUT …/lines` (reemplazo masivo, para el pegado desde la tabla). Un producto que ya está en el borrador **con la misma presentación y lote** suma en vez de duplicar. Guarda **sin validar de fondo**: un borrador admite una línea a medio llenar (cantidad nula, lote vacío) — la validación dura es del `confirm`, y las advertencias las muestra la previa
  - **Verificar:** `document-lines.e2e-spec.ts`: agregar 3 líneas y releer el borrador las devuelve en orden; agregar el mismo producto+presentación suma; sobre un documento `confirmed` → 409; fuera de scope → 403; cross-tenant 404; una línea sin cantidad se guarda (es un borrador) pero el `confirm` la rechaza
  - **Depende de:** F3-DOC-03
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `document-lines.service.ts` + `documents.controller.ts`, 12 tests e2e). **Se adelantaron acá `POST /inventory/documents` y `POST /:id/cancel`** (el hueco que detectó F3-DOC-03 y que estaba agendado en F3-DOC-06): sin ellos, un controller de líneas no se puede ejercitar de punta a punta y la tarea no sería demoable (§2.3). `createDraft` gana además la validación de scope y de almacén activo — un borrador contra un almacén desactivado no se podría confirmar nunca, mejor frenarlo antes de que alguien cargue 80 líneas

- [x] **F3-DOC-05** — Importar líneas desde Excel/CSV al borrador
  - **Salida:** **muda `spreadsheet.ts`** de `modules/products/` a `common/spreadsheet/` (la usan conteo, entradas y salidas; deja de ser detalle de un módulo) y actualiza los imports de productos; `GET /inventory/documents/template?type=entry|exit|physical_count&format=xlsx|csv` — columnas por tipo (`entry`: `sku, presentacion, cantidad, costo_unitario, lote, caducidad, ubicacion` · `exit`: igual sin costo · `physical_count`: `sku, lote, caducidad, ubicacion, contado`) con una fila de ejemplo; `POST /inventory/documents/:id/lines/import` (`{ file, format, mode: 'replace' | 'append' }`): > 5 MB → 413, ilegible → 400; resuelve `sku` → `productId` y el nombre de presentación → `presentationId`; **las filas con error igual entran como líneas** con su problema anotado, para que el usuario las corrija en pantalla en vez de volver a subir el archivo entero
  - **Verificar:** `document-import.e2e-spec.ts`: subir el Excel del cliente carga N líneas al borrador; `mode: 'replace'` reemplaza y `append` suma; una fila con sku inexistente entra marcada y no aborta las demás; csv y xlsx dan el mismo resultado (round-trip por `parseSpreadsheet`); sobre un confirmado → 409
  - **Depende de:** F3-DOC-04, F3-COUNT-01
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `document-import.service.ts`, 6 tests e2ec más → 18; `spreadsheet.ts` y `csv.ts` mudados a `common/spreadsheet/`). **Diferencia deliberada con el import de F2**: allá una fila con error aborta el archivo o exige `skipErrors`; acá **entra igual, marcada**. El destino es un BORRADOR, que existe para corregirse en pantalla — devolver un archivo de 200 filas porque tres tienen el sku mal obliga a editar en Excel y volver a subir

- [x] **F3-DOC-06** — `DocumentsController`: crear, anular, listar y ver el detalle
  - **Salida:** `DocumentsController` (módulo inventory, scope) (crear y anular se adelantaron a F3-DOC-04, que los necesitaba para ser demoable); acá el listado (`inventory:read`) con filtros `type` (obligatorio en las tres pantallas), **`status`** (default: `draft` + `confirmed`; los anulados entran con un chip), `warehouseId`, `from`, `to`, `createdBy` y **`folio`** (búsqueda parcial case-insensitive: se busca por el número que trae el papel en la mano); `page/pageSize`; orden `created_at DESC, folio DESC`; fila `{ id, folio, type, status, warehouse, reasonCode, reference, lineCount, createdAt, createdBy, confirmedAt }`. **El detalle ES la vista previa**: devuelve la cabecera + `rows: [{ lineNo, productId, sku, name, baseUnit, presentation, quantityInput, quantityBase, unitCost, lotCode, expiresAt, location, newLot, available, stockBefore, stockAfter, fefoPlan?, expand?, errors: [{ field, message, code }] }]` + `summary { lines, products, newLots, errors }`, resolviendo contra el saldo del momento **sin escribir nada**; si el documento está `confirmed`, las filas se leen de los `stock_movements` ya asentados (lo que realmente pasó) en vez de recalcularse
  - **Verificar:** `inventory-documents.e2e-spec.ts`: crear devuelve `ENT-000001` y el segundo `ENT-000002`; crear fuera de scope → 403; anular un borrador lo deja `canceled` CON su folio y anular uno confirmado → 409; `folio=000019` encuentra el borrador; el default no trae anulados y con el chip sí; el detalle de un borrador de 3 cajas ×12 sobre saldo 10 devuelve `stockBefore: 10` y `stockAfter: 46` **y el saldo real sigue en 10**; una línea sin cantidad aparece con su error y `summary.errors = 1`; el detalle de un confirmado muestra los movimientos reales (incluida la partición FEFO en dos lotes); Manager con scope [A] no ve nada de B (404)
  - **Depende de:** F3-DOC-04, F3-CORE-03, F3-CORE-04, F3-CORE-08
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-18: listado con búsqueda por folio + el detalle convertido en VISTA PREVIA, 8 tests e2e más → 26). **`resolveLines` ganó un modo `preview`** que no tira el primer error sino que los junta POR LÍNEA, y **no crea lotes** (los marca `newLot`): mirar la previa no puede dejar lotes fantasma en la base, y quien cargó 80 líneas necesita ver las cinco que están mal de una vez. Que sea la MISMA función que usa el confirm es toda la garantía de que lo previsualizado sea lo que se asienta. El `stockAfter` se calcula **encadenado** por producto: dos líneas del mismo producto no pueden partir las dos del mismo saldo

- [x] **F3-DOC-07** — Render PDF + `GET /inventory/documents/:id/pdf`
  - **Salida:** dependencia `pdfmake` (server-side; elegido sobre `pdfkit` porque **pagina la tabla solo y repite el encabezado**, y un conteo son 500 líneas); `document-pdf.renderer.ts` con encabezado y pie **comunes** y **cuerpo por tipo**: cabecera con `tenant.legalName ?? tenant.name` + `tenant.taxId`, el tipo en grande y el **folio**; **marca de agua «BORRADOR» o «ANULADO»** según estado (un papel sin marca es un papel que alguien va a firmar); bloque de datos (almacén — y destino si el motivo es traspaso —, fecha, quién registró, motivo, referencia, nota, autorizó); tabla `entry`/`exit`: `# · SKU · Producto · Presentación · Cantidad (con equivalencia en base_unit) · Lote/Caducidad/Ubicación si aplica · Costo unitario solo con `invoice``; tabla `physical_count`: `# · SKU · Producto · Teórico · Contado · Diferencia`; pie con **total de LÍNEAS** (nunca un total de unidades: sumar 36 unidades + 2.5 kg no significa nada) y tres líneas de firma **Entregó / Recibió / Autorizó**; labels por `nestjs-i18n` con el locale del usuario; endpoint (`inventory:read`, mismo scope que el detalle) → `application/pdf` + `Content-Disposition: attachment; filename="SAL-000019.pdf"`
  - **Verificar:** `documents-pdf.e2e-spec.ts`: 200 con `content-type: application/pdf`, el buffer arranca con `%PDF-` y el `filename` es el folio; el PDF de un borrador contiene la marca de agua y el de un confirmado no; un documento de 300 líneas produce **más de una página** (se cuenta `/Type /Page`); en `en` los labels salen en inglés; fuera de scope 404. Unit del renderer: el `docDefinition` de un `physical_count` trae teórico/contado/diferencia y el de una entrada no; **ningún tipo emite un total de unidades**
  - **Depende de:** F3-DOC-06
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-18: `document-pdf.renderer.ts` con 11 unit + `document-pdf.service.ts` con 3 e2e). **Se instaló `pdfmake@0.2`, no la 0.3**: la 0.3 es una reescritura orientada al navegador y su singleton no expone `createPdfKitDocument`; el printer de servidor vive en la 0.2, que además es la que describen los tipos. Los tipos publicados cubren solo la API del navegador, así que el printer se declara en `pdfmake-printer.d.ts` — se prefirió eso a un `as any` para que el contrato quede escrito. Las fuentes son las **estándar de PDF** (Helvetica y familia): vienen dentro de todo visor, así que no suman megas a la imagen. El e2e verifica el BINARIO —que arranque con `%PDF-` y que un documento de 120 líneas produzca más de una página— porque paginar solo es justamente la razón por la que se eligió `pdfmake` sobre `pdfkit`

- [x] **F3-DOC-08** — UI: listado por serie (montado 3 veces) + crear
  - **Salida:** `components/inventory/document-list.tsx` **reusable, parametrizado por `type`**, montado en `/movements/entries`, `/movements/exits` y `/movements/counts` con gate `inventory:read`: buscador por folio con debounce, chips de estatus (Borradores / Confirmados / Anulados), `WarehouseSelect` scoped, rango de fechas y usuario; tabla folio (mono, link), **badge de estatus**, almacén, motivo, fecha, líneas, quién; paginación server-side; estado vacío distinto para "todavía no hay" y "sin resultados"; botón **«Crear entrada / salida / conteo»** (gate `inventory:movement`) que llama a `createDraft` y **navega al borrador recién creado**; `lib/inventory/documents-api.ts` + hooks
  - **Verificar:** `routes/movements-documents.test.tsx` (routeTree real): las tres rutas montan el mismo componente con distinto `type` en el request; escribir en el buscador manda `folio`; el chip de anulados cambia el filtro `status`; el botón de crear postea y navega al id devuelto; sin `inventory:movement` el botón no existe pero el listado sí
  - **Depende de:** F3-DOC-06, F3-NAV-02
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-18: `components/inventory/document-list.tsx` montado en las tres rutas, 10 tests por routeTree real). Se agregó de paso la ruta `/movements/documents/$documentId` como placeholder porque el botón de crear navega ahí: **crear un borrador y caer en un 404 sería peor que no poder crearlo**. Dos detalles con su porqué: las **chips van en PLURAL** y el badge de la fila en singular —una chip filtra un conjunto, un badge nombra un documento, y el plural es un dato, no una regla derivable (misma lección que las presentaciones de F2)—; y el botón de crear **no existe** sin `inventory:movement` en vez de estar deshabilitado, porque deshabilitado sugiere que falta un clic, no un permiso. Biome cazó un `label` sin `htmlFor` sobre el `WarehouseSelect`: un lector de pantalla habría anunciado el desplegable sin decir qué elige

- [x] **F3-DOC-09** — UI: pantalla del documento (captura del borrador y detalle del confirmado)
  - **Salida:** ruta `/movements/documents/$documentId`, **una sola pantalla que cambia de cara según el estado**. En `draft`: cabecera editable (motivo y campos contextuales según `REASON_RULES`, `WarehouseSelect`, autoriza, referencia, nota) + tabla de líneas contra el CRUD de F3-DOC-04 con **autoguardado** (debounce, indicador "guardado") + botón de importar Excel + **panel de previa en vivo** con `stockBefore → stockAfter`, lotes nuevos y errores por línea + **«Confirmar»** (deshabilitado con errores, con `ConfirmDialog`) + «Anular». En `confirmed`/`canceled`: solo lectura con lo que realmente pasó. Siempre: `components/inventory/download-document-button.tsx` reusable que pide el PDF con axios `responseType: 'blob'` y dispara la descarga (mismo helper que `downloadImportTemplate`: un `<a href>` iría sin el Bearer y daría 401)
  - **Verificar:** test web: editar una línea dispara el PATCH con debounce y muestra el indicador; el panel de previa refleja `stockAfter` tras cambiar la cantidad; con un error de línea el botón de confirmar está deshabilitado y el mensaje sale sobre la fila; un documento `confirmed` no renderiza inputs ni el botón de confirmar; el botón de PDF nombra el archivo con el folio
  - **Depende de:** F3-DOC-08, F3-DOC-05, F3-DOC-07
  - **Estimación:** 4 h
  - **Hecho** (2026-08-18: `document-detail.tsx` + `download-document-button.tsx`, 9 tests por routeTree real). El autoguardado **no dispara en el primer render** (montar la fila no es editarla) y usa debounce de 400 ms: sin él, escribir «1500» haría cuatro requests y la previa parpadearía con saldos intermedios que nunca existieron. Tras guardar se **invalida el documento**, porque el stock resultante lo calcula el servidor y no la pantalla. El PDF se baja con `inventory:read` aunque no se pueda editar: **auditar es leer**. Confirmar pasa por `ConfirmDialog` con el cuerpo diciendo cuántas líneas se asientan y que no hay vuelta atrás. **Quedan para sus tareas**: agregar líneas con buscador de producto (F3-ENTRY-02/F3-EXIT-02, que traen los campos por motivo) e importar Excel desde la pantalla (F3-DOC-05 ya tiene el endpoint)

---

### Módulo F3-CORE — El Ledger: Servicio de Aplicación de Movimientos

> **El corazón de la fase.** Una sola transacción reusable — resolver líneas (presentación → base_unit, enteros, compuestos), bloquear en orden, validar, insertar movimientos, actualizar saldos, auditar — que consumen entradas, salidas, recepción, conteo y, en F4, la venta. Módulo `apps/api/src/modules/inventory/`. Es la primera concurrencia real y el primer `Prisma.Decimal` del proyecto: SDD COMPLETO, y F3-CORE-05 se prueba con transacciones concurrentes de verdad.

- [x] **F3-CORE-01** — Catálogo compartido de motivos y reglas en `packages/shared`
  - **Salida:** `packages/shared/src/inventory.ts`: `MOVEMENT_DIRECTIONS`, `MOVEMENT_REASONS`, `REASONS_BY_DIRECTION` (la tabla de Convenciones), `SELECTABLE_ENTRY_REASONS` (`invoice|adjustment|customer_return`) y `SELECTABLE_EXIT_REASONS` (`adjustment|loss|consumption|expired|transfer`) para los formularios, `REASON_RULES[reason] = { requiresReference, requiresNote, requiresUnitCost, requiresLinkedWarehouse }`, `QUANTITY_DECIMALS = 4`, `hasValidQuantityScale()`, `TRANSFER_STALE_DAYS = 7`, `TRANSFER_STATUSES`; exportado desde `index.ts`
  - **Verificar:** `inventory.test.ts` en shared (reglas y escala, incluye `1.00005` y `1e-7`); test de contrato en el API: todo valor de `MovementReason`/`MovementDirection`/`TransferStatus` de Prisma existe en shared y viceversa, y el CHECK dirección×motivo de la migración coincide con `REASONS_BY_DIRECTION` (patrón F2-UOM-01)
  - **Depende de:** F3-DB-01, F3-DB-02
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-18: `packages/shared/src/inventory.ts` + 10 tests, y `reasons-contract.integration.spec.ts` con 4). El test de contrato más valioso **lee el CHECK real de la base** (`pg_get_constraintdef`) y lo compara combinación por combinación con `REASONS_BY_DIRECTION`: sin él, agregar un motivo a shared sin tocar la migración dejaría al front ofreciendo algo que la base rechaza con un 500 al confirmar

- [x] **F3-CORE-02** — Módulo `inventory` + DTOs Zod + namespace i18n
  - **Salida:** `InventoryModule` registrado en `app.module.ts` (importa Prisma, Audit); `dto/movement-line.dto.ts` (`quantityAmount()`: positivo, ≤ `QUANTITY_DECIMALS`, ≤ 9 999 999 999.9999; `unitCost` con `moneyAmount()`; `productId`/`presentationId` uuid); `dto/create-entry.dto.ts` y `dto/create-exit.dto.ts` con `superRefine` que aplica `REASON_RULES` (errores por ruta: `reference`, `reasonNote`, `linkedWarehouseId`, `lines.N.unitCost`), `lines` no vacío (máx. 500); `apps/api/src/i18n/{es,en}/inventory.json` con TODAS las claves de la fase; controller vacío con `@ApiTags('inventory')`
  - **Verificar:** unit de los schemas: `invoice` sin `unitCost` en la línea 1 → error en `lines.1.unitCost`; `consumption` sin `reference` → error en `reference`; `message-keys.spec.ts` verde con el namespace nuevo
  - **Depende de:** F3-CORE-01, F3-DB-05
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18: `inventory.module.ts`, `dto/movement.dto.ts` con 13 tests, `i18n/{es,en}/inventory.json` con las 30 claves de la fase). El `superRefine` aplica **la misma `REASON_RULES` de shared** que hace reactivo al formulario: una sola definición para los dos lados, así el API no pide un campo que la pantalla nunca mostró

- [x] **F3-CORE-03** — Alcance por almacén: helper único + `GET /warehouses?scoped=true`
  - **Salida:** `apps/api/src/modules/inventory/warehouse-scope.helpers.ts`: `assertWarehouseInScope(scope, warehouseId)` → 403 `inventory.warehouse_out_of_scope`; `warehouseScopeWhere(scope)` → `{}` con `"all"` o `{ id: { in } }`; `assertActiveWarehouse(tx, tenantId, id)` → 404 `warehouses.not_found` / 422 `inventory.warehouse_inactive`; `WarehousesController.list` acepta `?scoped=true` (activos ∩ `@CurrentUserScope()`) — **primer consumidor real del decorator**
  - **Verificar:** unit del helper (3 estados del scope); e2e `warehouse-scope-security`: Manager con scope [A] pide `?scoped=true` y recibe solo A; sin flag recibe todos (comportamiento F2 intacto)
  - **Depende de:** —
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18: `warehouse-scope.helpers.ts` con 7 unit + 2 e2e). Primer consumidor real de `@CurrentUserScope()`, que existía desde F1-SCOPE sin usarse. El helper distingue explícitamente `[]` de `all`: la lista vacía es el fail-closed del interceptor y tratarla como "todos" abriría el inventario entero

- [x] **F3-CORE-04** — Resolución de líneas (`resolveLines`)
  - **Salida:** función `resolveLines(tx, tenantId, lines, { direction, reasonCode })` en `line-resolver.ts` — recibe las **líneas del borrador** (`inventory_document_lines`), y la MISMA función alimenta la previa del detalle (F3-DOC-06) y el confirm, que es lo que garantiza que lo previsualizado y lo asentado se validen igual: carga productos y presentaciones del tenant en 1 query cada uno; producto inexistente → 404 `inventory.product_not_found`; inactivo → 422 `inventory.product_inactive`; presentación ajena al producto o inactiva → 422 `inventory.presentation_invalid`; **`quantity × factor` → base_unit** (`Prisma.Decimal`, sin float); `allow_fractional_input=false` con decimales → 422 `inventory.integer_only_presentation` `{ presentationName, lineIndex }`; compuesto → 409 `inventory.composite_has_no_stock` salvo `direction='exit'` con `consumption|expired` (los devuelve marcados `expand: true` para F3-CORE-06); **lotes**: la línea acepta `lotCode?`, `expiresAt?`, `location?`, `lotId?`; si el producto tiene `tracks_lots` → en `entry` exige `lotCode` (422 `inventory.lot_required`) y crea/resuelve el `ProductLot` (si `expiresAt` viene y el lote ya existe con otra fecha → 409 `inventory.lot_expiry_mismatch`); en `exit` los datos de lote son opcionales (sin ellos, FEFO decide en F3-CORE-08); si el producto NO tiene `tracks_lots` y la línea trae lote → 422 `inventory.lot_not_tracked`; devuelve `ResolvedLine { productId, presentationId, quantityBase, quantityInput, unitCost, expand, lotId?, location? }`
  - **Verificar:** `line-resolver.spec.ts` (mock de tx): matriz presentación×decimal×dirección×motivo RED→GREEN; 2 líneas del mismo producto con presentaciones distintas convierten independientes; `0.1 + 0.2` en Decimal no produce `0.30000000000000004`
  - **Depende de:** F3-CORE-02, F3-DB-06
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-18: `line-resolver.ts` con 18 tests de integración contra Postgres real, no mocks — lo que se prueba depende de los datos, no de la forma de las llamadas). Incluye el test que justifica `Prisma.Decimal`: `0.1 + 0.2` da `0.3` exacto y no `0.30000000000000004`

- [x] **F3-CORE-05** — `StockLedgerService.apply()` — la transacción atómica
  - **Salida:** `stock-ledger.service.ts#apply(tx, { tenantId, userId, direction, reasonCode, warehouseId, lines: ResolvedLine[], header: { reasonNote, reference, authorizedBy, linkedWarehouseId, transferId, documentId } })`: (1) agrupa por `(productId, warehouseId)` sumando `quantityBase`; (2) `INSERT INTO stock_by_warehouse … ON CONFLICT DO NOTHING` para las filas faltantes (una sentencia con `unnest`); (3) `SELECT … FOR UPDATE` en UNA query `WHERE (product_id, warehouse_id) IN (…) ORDER BY product_id, warehouse_id` (`$queryRaw` tipado; NUMERIC llega como string → `new Prisma.Decimal`); (4) en `exit`, disponible ≥ solicitado agrupado → si no, 422 `inventory.insufficient_stock` `{ productId, sku, available, requested }` (la primera que falle, con `lineIndex`); (5) `createMany` de `stock_movements` con `document_id` común (uno por línea original, no por grupo); (6) `UPDATE stock_by_warehouse SET quantity = quantity ± Δ`; **(7) lotes**: para las líneas con `lotId` hace lo mismo sobre `stock_lots` (upsert de `(lot, warehouse, location)` + `FOR UPDATE` en el **mismo** orden determinista, después de las filas de `stock_by_warehouse`; en `exit` valida el saldo **del lote** además del total; los movimientos llevan `lot_id`/`location`) — así la invariante `Σ stock_lots == stock_by_warehouse` se sostiene por construcción en cada tx; devuelve `{ documentId, movements[], stock: [{ productId, warehouseId, quantity }], lots?: [{ lotId, warehouseId, location, quantity }] }`. `apply` **nunca abre transacción**: recibe la `tx` del llamador (mismo contrato que `AuditService.record`)
  - **Verificar:** `stock-ledger.integration.spec.ts` (Postgres real): dos salidas concurrentes de 60 sobre stock 100 → una 201 y otra 422, saldo 40; dos transacciones con órdenes cruzados (A,B) y (B,A) terminan sin deadlock; primer movimiento sobre producto sin fila crea la fila; entrada + salida en la misma tx dejan `stock_movements` = líneas y saldo correcto; **test de reconciliación**: tras N movimientos aleatorios (entradas, salidas, traspasos, con y sin lote) `stock_by_warehouse.quantity == Σentries − Σexits` por (product, warehouse) **y** `Σ stock_lots == stock_by_warehouse` para los productos con lote — es LA propiedad central de la fase
  - **Depende de:** F3-CORE-04, F3-DB-04, F3-DB-07
  - **Estimación:** 4 h
  - **Hecho** (2026-08-18: `stock-ledger.service.ts`, 9 tests de integración contra Postgres real). **Contraprueba del `FOR UPDATE` hecha**: se lo quitó al SELECT de saldos y el test de dos salidas concurrentes de 60 sobre 100 se puso rojo al instante; restaurado, verde. Sin él las dos transacciones leen 100 antes de que cualquiera escriba y el almacén queda en −20. El orden del lock (`ORDER BY product_id`) tiene su propio test con dos transacciones cruzadas

- [x] **F3-CORE-06** — Expansión de compuestos para salida (`expandComposition`)
  - **Salida:** `composition-expander.ts#expand(tx, tenantId, lines)`: para cada línea `expand: true` carga el grafo de composición del tenant (reusa `composition-graph.ts`), recorre en recursión (anidados) y produce líneas de componente con `quantityBase = qty × cantidad_i × (1 + waste_i/100)`, agregadas por componente, cada una con `parentProductId` = compuesto raíz y `presentationId = null`; compuesto sin composición → 409 `inventory.composite_without_composition`
  - **Verificar:** `composition-expander.spec.ts`: compuesto anidado (A → B → C) descuenta C con el producto de cantidades y mermas; el resultado coincide con lo que `availability` habría permitido; ciclo residual en datos → corta sin colgar
  - **Depende de:** F3-CORE-04
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18: `composition-expander.ts`, 8 tests). Recorre en recursión porque un compuesto puede llevar otro: el combo lleva 2 cafés y cada café 22 gr de azúcar; nadie captura «44 gr», se deduce. Corte por profundidad (20) como red ante un ciclo heredado — colgar el proceso sería peor que descontar de menos

- [x] **F3-CORE-07** — Audit por lote de movimientos
  - **Salida:** `movement-audit.ts#recordMovementAudit(tx, auditService, { user, action, documentId, folio, warehouseId, reasonCode, lines: [{ productId, quantity, balanceAfter, parentProductId? }], extra? })` con `resourceType: 'inventory_document'`, `resourceId: documentId` y el **folio** en el payload (es lo que una persona busca cuando audita); acciones canónicas `inventory.entry`, `inventory.exit`, `inventory.transfer_dispatch` (una salida con motivo traspaso), `inventory.transfer_receive`, `inventory.transfer_cancel`, `inventory.physical_count_approve`
  - **Verificar:** unit: el `after` incluye saldo posterior por línea; se llama DENTRO de la tx (mock verifica el mismo `tx`)
  - **Depende de:** F3-CORE-05
  - **Estimación:** 45 min
  - **Hecho** (2026-08-18: `movement-audit.ts`, 5 tests). Se ancla en el DOCUMENTO y lleva el **folio** en el payload aunque sea derivable: es el único dato que una persona tiene en la mano cuando pregunta qué pasó con una entrada

- [x] **F3-CORE-08** — FEFO: resolución de lote en salida (`resolveLotsFefo`)
  - **Salida:** `lot-fefo.ts#resolveLotsFefo(tx, tenantId, warehouseId, lines)` invocado por `apply` **antes** del lock, para cada línea `exit` de producto con `tracks_lots` que NO trae `lotId`: lee los `stock_lots` del producto en ese almacén con saldo > 0 ordenados por `expires_at ASC NULLS LAST, lot_code ASC, location ASC` y **reparte** la cantidad en orden (una línea de usuario → N sublíneas, una por `(lote, ubicación)`, hasta cubrirla); si el total no alcanza → el mismo 422 `inventory.insufficient_stock` de siempre; si el usuario **forzó** `lotId` (y opcionalmente `location`) → se respeta y se valida el saldo de ese lote (422 `inventory.insufficient_lot_stock` `{ lotCode, available, requested }`); el reparto se hace **dentro** de la tx y las filas elegidas entran al mismo `FOR UPDATE` que el resto (una carrera entre dos salidas FEFO del mismo producto la resuelve el lock, y la segunda relee). Documentado como el punto que F4 (POS) consume sin tocar
  - **Verificar:** `lot-fefo.spec.ts` + integración: el ejemplo de Carlos — lotes st30 (vence 01/10, 20), st10 (01/07, 10), st60 (01/12, 1); salida de 1 → baja st10 a 9; salida de 12 → st10 a 0 y st30 a 18 (dos movimientos, un `document_id`); lote sin `expires_at` va al final; forzar `lotId=st30` salta a st30; dos salidas FEFO concurrentes de 8 sobre st10=10 → una pasa, la otra relee y toma 2 de st10 + 6 de st30
  - **Depende de:** F3-CORE-05, F3-DB-07
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `lot-fefo.ts`, 7 tests). **El primer test es literalmente el Excel del cliente**: lotes st30/st10/st60 y «salida de 1 → baja st10 a 9». Los lotes SIN caducidad van al final y no primero: no corren riesgo de vencerse. Desempate por `lot_code` para que dos corridas con los mismos datos den el mismo reparto — uno no determinista sería imposible de auditar

---

### Módulo F3-ENTRY — Entradas

> La maquinaria (borrador, líneas, importación, previa, PDF) es de F3-DOC y la comparten los tres tipos. Acá vive **lo que hace distinta a una entrada**: sus motivos, el costo unitario y la validación dura del confirm.

- [x] **F3-ENTRY-01** — `POST /inventory/documents/:id/confirm` para `type='entry'`
  - **Salida:** rama de entrada del `DocumentsConfirmController` (`inventory:movement`): el documento debe ser `draft`, de tipo `entry` y su almacén ∈ scope (403) y activo (422); motivos aceptados `SELECTABLE_ENTRY_REASONS` + `transfer` (solo con `transferId`, delega en F3-TRANSFER-03); `sale_return`/`physical_count` → 422 `inventory.reason_not_allowed`; `authorizedBy` debe ser usuario del tenant (422 `inventory.authorizer_invalid`); **acá es donde la validación se pone dura** sobre las líneas del borrador: sin líneas → 422 `inventory.document_empty`, línea sin cantidad → 400 en `lines.N.quantity`, `invoice` sin `unitCost` → 400 en `lines.N.unitCost`; en UNA tx: `resolveLines` (sobre `inventory_document_lines`) → `ledger.apply` → `markConfirmed` → `recordMovementAudit('inventory.entry')`; 201 `{ document: { id, folio, type, status }, movements, stock }`
  - **Verificar:** `inventory-entries.e2e-spec.ts`: borrador con presentación ×12 y 3 cajas → saldo 36, `unit_cost` guardado y documento `confirmed`; confirmar dos veces → la segunda 409 `inventory.document_not_draft` y el saldo NO se duplica; borrador vacío → 422 y sigue `draft`; presentación solo-enteros con `1.5` → 422 nombrando la presentación y el documento sigue editable; compuesto → 409; producto con `tracks_lots` sin `lotCode` → 422 `inventory.lot_required`; lote nuevo crea el `ProductLot` y la fila `(lot, warehouse, location)`; el folio es el que ya tenía el borrador (confirmar **no** pide uno nuevo); Manager fuera de scope → 403; Viewer → 403; cross-tenant 404
  - **Depende de:** F3-DOC-03, F3-DOC-06, F3-CORE-05, F3-CORE-07
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `confirm.service.ts` + `PATCH /inventory/documents/:id`, 11 tests e2e). **Faltaba el PATCH de cabecera**: el borrador nacía vacío y no había forma de setear motivo, referencia ni autorizador, así que el confirm no tenía qué validar — se agregó acá (autoguardado, sin validar reglas: elegir «Factura» y todavía no tener el número es normal mientras se carga). **`markConfirmed` va ÚLTIMO** en la transacción, como avisaba el docblock de F3-DOC-02: el trigger congela el documento apenas cambia el estado. **Dos hallazgos:** (a) el filtro de excepciones **no pasaba `args` al traducir** el mensaje general — un bug latente desde F2 que salía a pantalla como «La presentación «{presentationName}» solo acepta…»; corregido y `args` ya no viaja en la respuesta; (b) los tests de lote por HTTP se **difirieron a F3-LOTS-01**: `tracks_lots` existe en la base pero ningún endpoint lo setea, así que no se pueden ejercitar sin fingir el dato — la lógica sí está cubierta en `line-resolver.integration.spec.ts`

- [x] **F3-ENTRY-02** — Especialización de la UI para entrada
  - **Salida:** en la pantalla del documento (F3-DOC-09), la cara de `type='entry'`: selector de motivo desde `SELECTABLE_ENTRY_REASONS` con labels i18n neutros, campos que aparecen/desaparecen según `REASON_RULES` (referencia, nota, autoriza — select de usuarios vía `GET /users`), **columna Costo unitario visible solo con `invoice`** (`MONEY_STEP`, con total calculado) y la equivalencia por línea ("3 Caja = 36 unidad" con `unitName`); panel de éxito tras confirmar con el folio y `DownloadDocumentButton`; `lib/inventory/entry-schema.ts` (Zod compartido con las mismas reglas)
  - **Verificar:** `routes/movements-entries.test.tsx`: elegir `invoice` muestra Referencia y la columna de costo, y oculta Autoriza; elegir `adjustment` exige Nota y esconde el costo; cambiar la presentación recalcula la equivalencia; el 422 de solo-enteros se pinta sobre su fila
  - **Depende de:** F3-ENTRY-01, F3-DOC-09
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `document-header-form.tsx`, `add-line-form.tsx`, `lib/inventory/entry-schema.ts` y la pantalla del documento cableada; 13 tests de ruta + 16 del schema + 2 de integración en el API). **La tarea no era solo de UI: faltaba el dato.** La fila del documento no traía ni el nombre del producto ni la unidad base ni el nombre de la presentación, así que la equivalencia «3 Caja = 36 unidades» que pedía la tarea era imposible de pintar. Se agregó `products` al detalle —el catálogo de lo que YA está en el documento, con presentaciones y factor— en **una query junto con las demás**: resolverlo por fila haría que un documento de 80 líneas hiciera 80 viajes desde el navegador solo para una frase. **Un bug que cazó el test de ruta:** el schema del front usaba `.optional()`, que acepta `undefined` pero **no `null`** — y el documento llega del API con los campos vacíos en `null`, así que cada uno sumaba un error de TIPO y el confirmar quedaba trabado sin decir por qué. Se pasó a `.nullish()`, igual que el DTO, y se cubrió con su propio test unitario. **`REASONS_WITH_AUTHORIZATION` vive en el front y NO en `REASON_RULES`**: `authorizedBy` es opcional en el API y ningún motivo lo exige, así que es una regla de PRESENTACIÓN (a quién tiene sentido ofrecerle firmar), y meterla en la tabla que consume el DTO haría creer que el servidor la valida. **Los textos de error de FILA se copiaron del API al front**, byte por byte: viajan dentro de un 200 (`row.errors[].code`), así que NO pasan por el filtro que traduce, y sin las claves el usuario veía `inventory.integer_only_presentation` crudo. `useProducts` ganó `enabled` para que el buscador no traiga medio catálogo al abrir la pantalla. **Pendiente menor:** el buscador todavía ofrece productos compuestos en una entrada; la previa los marca con `composite_has_no_stock`, pero conviene filtrarlos cuando F3-EXIT-02 defina el caso inverso (en salida por consumo SÍ son válidos)

---

### Módulo F3-EXIT — Salidas (incluye el despacho de traspaso)

> Misma maquinaria que la entrada. Lo propio de una salida: los motivos de salida, la validación de stock, la expansión de compuestos, FEFO y el **despacho de traspaso**, que es una salida con `reason_code='transfer'` — no un tipo de documento aparte.

- [x] **F3-EXIT-01** — `confirm` para `type='exit'` (incluye despacho de traspaso)
  - **Salida:** rama de salida del confirm (`inventory:movement`): motivos `SELECTABLE_EXIT_REASONS`; `sale`/`physical_count` → 422 `inventory.reason_not_allowed`; scope + almacén activo; compuestos: `consumption|expired` → `expandComposition` y salidas de componentes en la misma tx, otros motivos → 409; **`transfer`**: `linkedWarehouseId` obligatorio, activo, del tenant, ≠ origen (422 `inventory.transfer_same_warehouse`), **sin exigir scope sobre el destino**; en la tx, y en este orden: crear el `Transfer { status: in_transit }` con sus `TransferLine` (agrupadas por producto en base_unit, `quantity_sent`) → `UPDATE inventory_documents SET transfer_id = …` (todavía es `draft`, así que el trigger lo permite; **por eso el traspaso se crea antes de marcar confirmado**) → `ledger.apply` → `markConfirmed`; audit `inventory.exit`, o `inventory.transfer_dispatch` si el motivo es traspaso; 201 `{ document: { id, folio, type, status }, movements, stock, transfer?: { id } }`
  - **Verificar:** `inventory-exits.e2e-spec.ts`: salida > stock → 422 `{ sku, available, requested }`, saldo intacto y documento sigue `draft`; salida de producto con lote sin `lotId` → FEFO (el ejemplo de Carlos: baja st10 a 9); con `lotId` forzado → ese lote; `transfer` de producto con lote → `transfer_lines` con `lot_id` y la recepción entra al **mismo lote** en el destino; `consumption` de compuesto descuenta componentes con `parent_product_id` y el compuesto no tiene saldo; `loss` de compuesto → 409; `transfer` crea el `Transfer` `in_transit`, el documento queda `SAL-000019` con `transfer_id` puesto, baja el origen y NO toca el destino; `transfer` a sí mismo → 422; Manager con scope [A] despacha de A hacia B (fuera de su scope) → 201
  - **Depende de:** F3-ENTRY-01, F3-CORE-06, F3-CORE-08, F3-DB-02
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-18: rama de traspaso en `confirm.service.ts`, 9 tests e2e). **Stock, compuestos y FEFO ya funcionaban** desde F3-ENTRY-01 —el confirm era genérico— así que lo único nuevo fue el traspaso. **Se creó ANTES de asentar y de sellar**, y por dos razones: el documento todavía es `draft`, así que el trigger permite ponerle el `transfer_id`; y si el ledger rechazara por falta de stock, la transacción se deshace entera y no queda un traspaso huérfano apuntando a un despacho que nunca salió. **Hallazgo:** elegir el propio almacén como destino, o uno inexistente, devolvía **500** — el CHECK y la FK de la base rechazaban sin que nadie los manejara, después de que el usuario cargó todas las líneas. Se valida ahora en el `PATCH` de cabecera (al ELEGIR el destino, no al confirmar): no es un estado «a medio llenar» sino imposible. Las líneas del traspaso se agrupan por (producto, lote) en unidad base: quien recibe cuenta unidades, no las cajas que otro tecleó

- [x] **F3-EXIT-02** — Especialización de la UI para salida
  - **Salida:** la cara de `type='exit'` en la pantalla del documento: motivos de `SELECTABLE_EXIT_REASONS`; `transfer` muestra **Almacén destino** (`WarehouseSelect` de todos los activos menos el origen, no scoped) + leyenda "queda EN TRÁNSITO hasta que el destino confirme"; `consumption` muestra Área/Concepto (`reference`); `adjustment|loss|expired` muestran Autoriza + Nota; el panel de previa suma **Disponible** por línea (en base_unit y en la presentación elegida: "120 unidad = 10 Caja"), marca en rojo las líneas que exceden el disponible **sumando las líneas del mismo producto**, y en productos con lote muestra el **reparto FEFO** que se aplicaría ("saldrá 1 del lote st10, vence 01/07/2026") con un selector opcional de "forzar lote"; compuesto → leyenda "se descontarán sus componentes" con las unidades armables como techo
  - **Verificar:** `routes/movements-exits.test.tsx`: elegir `transfer` muestra el destino y excluye el origen; disponible 10 con cantidad 11 → error y confirmar deshabilitado; dos líneas del mismo producto 6 + 5 sobre 10 → error; el reparto FEFO aparece por línea; el éxito de un traspaso enlaza a `/movements/transfers`
  - **Depende de:** F3-EXIT-01, F3-ENTRY-02
  - **Estimación:** 3.5 h
  - **PARCIAL** (2026-08-18). **Entregado y verde**: motivos de `SELECTABLE_EXIT_REASONS`; `transfer` muestra **Almacén destino** (`WarehouseSelect` sin scope, excluyendo el origen) + la leyenda de que queda EN TRÁNSITO, y sin destino no se confirma; `consumption` pide **Área o concepto** con su propia etiqueta y placeholder (reusar "Referencia" dejaba a quien registra un consumo de limpieza buscando qué número inventar); `adjustment|loss|expired` piden Nota y ofrecen Autoriza; el **disponible por línea** sale en unidad base y en la presentación elegida ("Disponible: 120 unidades = 10 Caja", redondeado HACIA ABAJO cuando la presentación no admite fracciones: de 125 salen 10 cajas, no 10.4167, porque el decimal invitaría a teclear algo que el API rechaza); las líneas que exceden el disponible se marcan **sumando las del mismo producto** (el `available` ya viene encadenado del servidor: la segunda línea parte del saldo que dejó la primera); el panel de éxito de un traspaso enlaza a `/movements/transfers`. **Bug de paso, con test determinista:** `WarehouseSelect` auto-selecciona cuando hay una sola opción, y ni `onChange` ni `excludeIds` son estables entre renders — si el PATCH que dispara ese aviso FALLA, `value` se queda en null para siempre y el efecto vuelve a avisar en cada render, martillando el servidor con el mismo PATCH que ya falló. Se agregó un guardia por `ref` (avisa una vez por montaje). Se descubrió como "Maximum update depth exceeded" al cablear el destino. **Otro hallazgo: un test sin dientes** — "una merma no muestra almacén destino" pasaba aun con el destino renderizado SIEMPRE, porque `queryByLabelText` devuelve null mientras el selector muestra "Cargando…" (la etiqueta apunta a un `<select>` que todavía no existe); se pasó a buscar por TEXTO y la contraprueba ahora sí lo tumba
  - **CERRADA** (2026-08-18, segunda vuelta tras F3-LOTS-01/02). **El reparto FEFO de la previa sale del MISMO `allocateFefo` que usa el confirm.** Para eso se extrajo de `resolveLotsFefo` una función PURA —no consulta, no tira, no escribe— que devuelve de qué lote sale cada línea y cuánto faltó; el `confirm` la usa y aborta ante faltante, la previa la usa y junta los problemas sin cortar. **La contraprueba es la prueba de que sirve:** invertir el orden del allocator tumba a la vez los tests de la previa Y los del confirm, que es justo la propiedad buscada — si fueran dos repartos podrían elegir lotes distintos y la previa mentiría en el único dato por el que existe. **El techo de un compuesto es POR ALMACÉN**: `CompositionService.availability` ganó un `warehouseId` opcional; sin él sumaba todos, correcto para la ficha del producto pero mentira como techo de una línea — la contraprueba lo mostró crudo: **53 unidades armables en vez de 3**. **Un bug de zona horaria que el test destapó:** un lote que vence el **1 de julio** se mostraba como **30/6** en CDMX, porque `expires_at` es una columna `DATE` y formatearla con el huso local la corre un día hacia atrás en toda América. No es cosmético — es el número por el que alguien decide tirar mercancía buena o vender una vencida. Se resolvió con `lib/inventory/format-date.ts` (`timeZone: "UTC"`, 4 tests) y **el helper NO se usa para `createdAt`/`confirmedAt`**, que sí son instantes y deben verse en hora local. **Sigue pendiente el selector de «forzar lote»**: los datos ya existen (`GET /products/:id/lots?withStock=true&warehouseId=` de F3-LOTS-02), pero el borrador guarda `lotCode` por línea y falta cablear el `PATCH` — queda anotado para F3-LOTS-03/04, que ya tocan esa pantalla
  - **PENDIENTE menor**: (1) **reparto FEFO por línea** ("saldrá 1 del lote st10, vence 01/07/2026") y (2) **selector de "forzar lote"** — los dos necesitan que el API corra FEFO en modo previa (hoy `resolveLotsFefo` solo vive en el `confirm` y **tira excepción** ante stock insuficiente, así que no sirve tal cual para una previa que debe juntar errores sin cortar) y que exponga los lotes con saldo por producto. Y sobre todo: **F3-LOTS-01 no está hecha**, así que ningún endpoint pone `tracks_lots` en true y hoy no existe producto con lotes — sería UI para una capacidad que no se puede encender. (3) **Techo de unidades armables de un compuesto**: `CompositionService.availability` suma stock de **TODOS los almacenes** (`groupBy` por `productId` sin filtro), y como techo de una línea mentiría — diría que podés armar 10 cuando el stock está en otra bodega. Necesita una disponibilidad **por almacén**, que es cálculo nuevo. **(1) y (3) quedaron RESUELTOS arriba**; queda solo el selector de forzar lote

---

### Módulo F3-TRANSFER — Ciclo de Vida del Traspaso

> El traspaso nace en F3-EXIT-01 (despacho), que es una **Salida con motivo traspaso** — no un tipo de documento propio (corrección de Carlos, 2026-08-18). Acá vive el resto: listar según scope, ver detalle, **confirmar recepción** (que es un borrador de **Entrada** con motivo traspaso, precargado), cancelar. El traspaso no tiene folio propio: el suyo es el de su documento de despacho. Recibido > enviado bloqueado; el cancelado no devuelve stock.

- [x] **F3-TRANSFER-01** — `GET /transfers`
  - **Salida:** `TransfersController` (`inventory:read`) en el módulo inventory: filtros `status` (default `in_transit`), `direction=incoming|outgoing` (incoming = destino ∈ scope; outgoing = origen ∈ scope; sin filtro = cualquiera de los dos; con scope `"all"` ambos tabs ven todo), `originWarehouseId`, `destinationWarehouseId`, `from`, `to`, `olderThanDays`; `page/pageSize`; orden `created_at desc, id desc`; fila `{ id, folio (el de su documento de despacho, un `SAL-…`), status, origin: {id,name}, destination: {id,name}, createdAt, createdBy: {id,name}, lineCount, daysInTransit, isStale (> TRANSFER_STALE_DAYS) }`; `meta { incomingCount, outgoingCount }` para los contadores de las tabs
  - **Verificar:** `transfers.e2e-spec.ts`: Manager con scope [B] ve el traspaso A→B como incoming y no como outgoing; `olderThanDays=7` filtra; paginación estable con dos filas del mismo instante
  - **Depende de:** F3-EXIT-01, F3-CORE-03
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-19: `transfers.service.ts` + `transfers.controller.ts`, 12 e2e en `transfers.e2e-spec.ts`). **`direction` sale del ALCANCE, no de un parámetro del cliente**: "entrante" significa "hacia un almacén que YO administro", y si lo mandara el cliente cualquiera podría pedir la bandeja de otro. Con alcance `"all"` no se filtra —no hay "mi almacén" contra el que contrastar— y los dos tabs ven todo; el alcance VACÍO sigue sin ver nada (fail-closed del interceptor). Sin `direction`, un traspaso entra si el usuario está en cualquiera de las dos puntas. **El folio es el del documento de DESPACHO**, filtrando `documents` por `type='exit'`: un traspaso tiene dos documentos (la salida que lo despacha y la entrada que lo recibe) y tomar cualquiera daría el folio equivocado apenas exista la recepción. **Bug que cazó el test:** `daysInTransit` daba **-1** en un traspaso recién despachado. `created_at` lo pone la BASE con `transaction_timestamp()`, y bastan unos milisegundos de desfase entre el reloj de la app y el del contenedor de Postgres para que `Math.floor` de un negativo diminuto devuelva -1. Se resolvió con `Math.max(0, …)`: salir en el futuro no es un estado posible. **La base me corrigió a mí:** el test ponía `status='completed'` a mano y el CHECK `transfers_completed_check` lo rechazó — el estado y sus campos (`received_by`, `received_at`) van juntos, y esa invariante vive en la migración. **Límite honesto del test de orden:** no logra caer si se le quita el desempate por `id`, porque con el índice `(tenant_id, status, created_at DESC)` que ya existe Postgres devuelve las filas en un orden que coincide con `id DESC`. La garantía del desempate —el mismo orden en dos consultas distintas— no se puede forzar desde un e2e; queda anotado en el propio test para que nadie lo lea como más fuerte de lo que es

- [x] **F3-TRANSFER-02** — `GET /transfers/:id`
  - **Salida:** (`inventory:read`) cabecera completa (origen, destino, estado, created/received/canceled by+at con nombres, `cancelReason`, `discrepancyNote`) + `lines: [{ productId, sku, name, baseUnit, quantitySent, quantityReceived, difference }]` (difference derivada, null hasta confirmar); visible si origen **o** destino ∈ scope, si no 404
  - **Verificar:** e2e: usuario del destino lo ve; usuario con scope ajeno a ambos → 404; `difference` = sent − received tras confirmar
  - **Depende de:** F3-TRANSFER-01
  - **Estimación:** 1 h
  - **Hecho** (2026-08-19: `TransfersService.detail`, 7 e2e). **`difference` se DERIVA de `sent - received` y no se guarda** — una sola verdad, la misma decisión que tomó F3-DB-02 al descartar un JSONB de discrepancias. Y es `null` mientras nadie recibió, porque **`null` no es 0**: recibir cero significa "llegó vacío", una pérdida total que hay que ver, y confundirlos la borraría del reporte. Hay contraprueba: cambiar el `null` por `?? 0` tumba su test. **404 y no 403** para quien no está en ninguna de las dos puntas: ese traspaso no existe para él, y un 403 confirmaría que sí — de paso revelando que hay movimiento entre dos bodegas que no le tocan. **Las DOS puntas lo ven**: al destino le importa que le llegue y al origen que llegue, porque sigue siendo su mercancía hasta que alguien la confirme. **Se agregó `lot` a la línea**, fuera del contrato del tablero: la RECEPCIÓN necesita saber a qué lote entra lo recibido (F3-TRANSFER-03 dice "lo recibido entra al mismo lote"), y omitirlo obligaría a tocar este endpoint otra vez en la tarea siguiente. **Otro test sin dientes cazado por contraprueba:** solo probaba el lado del DESTINO, así que restringir la guarda a `destination` no rompía nada — faltaba el caso del ORIGEN

- [x] **F3-TRANSFER-03** — Recepción: `POST /inventory/entries` con `reasonCode='transfer'` + `transferId`
  - **Salida:** `POST /transfers/:id/receipt-draft` (`inventory:movement`) crea un **borrador de Entrada** (`ENT`) con motivo `transfer`, almacén = destino, `transferId` puesto y **las líneas precargadas con lo enviado** (el usuario solo corrige lo que llegó de menos) — así la recepción usa exactamente la misma pantalla que cualquier entrada. Al confirmarlo, la rama de `transfer` del confirm llama a `TransfersService.receive(tx, …)`: `transferId` obligatorio (sin él → 422 `inventory.transfer_entry_requires_transfer`); transfer del tenant y `in_transit` — se toma **primero** con `UPDATE … WHERE status='in_transit'` y `rowCount = 1` como lock lógico (409 `inventory.transfer_not_in_transit` si 0); `warehouseId` = destino (422 `inventory.transfer_wrong_destination`) y ∈ scope; `linkedWarehouseId` se completa server-side con el origen; líneas **sin presentación** (422), en base_unit, **todas** las del traspaso y ninguna ajena (identificadas por `productId` + `lotId` cuando la línea tiene lote: lo recibido entra al mismo lote y el usuario indica `location` en destino) (422 `inventory.transfer_lines_incomplete` / `inventory.transfer_line_unknown`); `0 ≤ received ≤ sent` (422 `inventory.received_exceeds_sent` `{ productId, sent, received }`); alguna < → `reasonNote` obligatoria (400 en `reasonNote`) → `discrepancy_note`; en la tx: `ledger.apply` solo con líneas > 0, `quantity_received` por línea, `status='completed'` y `received_by/at` (el vínculo con el documento de entrada lo lleva `inventory_documents.transfer_id`, no una columna en `transfers`); audit `inventory.transfer_receive` con `{ folio, lines: [{ productId, sent, received, difference }], discrepancyNote }`; 201 con `document: { id, folio, type, status }` (un `ENT-…`) y `transfer: { id, status, dispatchFolio }`. La diferencia sent−received simplemente **no entra** al destino (ya salió del origen): no se crea un `loss` automático
  - **Verificar:** e2e: pedir el borrador de recepción dos veces devuelve el MISMO (lo garantiza el UNIQUE parcial `(transfer_id, type)`); recepción exacta → destino sube, `completed`, y el documento de entrada `ENT-000043` queda ligado al mismo traspaso que el `SAL-000019` del despacho; con faltante y nota → `discrepancy_note` guardada, audit con la diferencia; faltante sin nota → 400; recibido > enviado → 422 y nada cambia; dos recepciones concurrentes → una 201 y otra 409; línea con presentación → 422
  - **Depende de:** F3-ENTRY-01, F3-EXIT-01, F3-DOC-04
  - **Estimación:** 3 h
  - **Hecho** (2026-08-19: `createReceiptDraft` + `receive` en `transfers.service.ts`, enganchado al `confirm`; 9 e2e nuevos, 28 en el spec). **La recepción es una ENTRADA normal**: el borrador nace con motivo `transfer`, el almacén destino y las líneas precargadas, así que se completa en la misma pantalla que cualquier entrada. El `linkedWarehouseId` (el origen) lo pone el SERVIDOR — quien recibe no tiene por qué saber de dónde vino, y dejarlo elegir sería dejarlo equivocarse. Idempotente **por el UNIQUE parcial `(transfer_id, type)`**, no por un guard. **`assertReason` tuvo que distinguir "qué se puede ELEGIR" de "qué es VÁLIDO"**: `transfer` en una entrada no está en `SELECTABLE_ENTRY_REASONS` (un humano no lo elige) pero el borrador de recepción lo lleva legítimamente porque lo creó el sistema — se acepta solo si trae `transferId`. **La diferencia enviado−recibido NO entra al destino y NO genera merma automática**: ya salió del origen, y qué pasó en el camino lo decide una persona con un ajuste explícito; inventar el asiento sería adivinar la causa. **BUG DE PRODUCCIÓN destapado por este e2e:** el `PATCH /documents/:id/lines/:lineId` pide un **uuid** y el front mandaba `String(row.lineNo)` — cada autoguardado de cantidad daba **500**. Los tests del front no lo cazaban porque mockean `updateDocumentLine` y solo verifican que se llamó: el clásico punto ciego del borde mockeado. La fila del documento ni siquiera exponía su `id`; se agregó al DTO y el front ahora lo usa. **Otro test sin dientes:** "dos recepciones simultáneas" pasa igual sin el lock del traspaso, porque lo que ejercita es el lock del DOCUMENTO (`markConfirmed`). El del traspaso protege otra cosa —que el traspaso cambie de estado ENTRE crear el borrador y confirmarlo— y hubo que escribir ese caso (cancelado a mitad → 409) para que la contraprueba mordiera

- [x] **F3-TRANSFER-04** — `POST /transfers/:id/cancel`
  - **Salida:** (`inventory:manage`) body `{ reason }` obligatoria (min 5); solo `in_transit` (409 `inventory.transfer_not_in_transit`); `status='canceled'`, `canceled_by/at`, `cancel_reason`; **el stock NO vuelve al origen** (docblock explica el porqué: la salida ya ocurrió y es historia; el reingreso es un `adjustment` explícito y auditado); audit `inventory.transfer_cancel`
  - **Verificar:** e2e: TenantAdmin cancela → `canceled` y saldo del origen intacto; Manager → 403; sin `reason` → 400; cancelar uno `completed` → 409
  - **Depende de:** F3-EXIT-01, F3-DB-05
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-19: `TransfersService.cancel`, 5 e2e). **El stock NO vuelve al origen**, y es la decisión más difícil de explicar del módulo: la salida ya ocurrió —hay un `SAL-…` confirmado y movimientos asentados— y el sistema es append-only. Si la mercancía reaparece entra con un `adjustment` explícito hecho por alguien que sabe qué pasó; devolverla sola inventaría un movimiento que nadie autorizó y **borraría la evidencia de que hubo un problema**. El audit lo dice literal con `stockReturned: false`, para que quien lo lea mañana no tenga que deducirlo. Usa el MISMO lock lógico de la recepción. **Test sin dientes corregido:** el "sin `inventory:manage`" firmaba un token con solo `inventory:read`, así que bajar el permiso a `movement` no lo rompía — el operario real SÍ tiene `movement`, y con eso la contraprueba muerde

- [x] **F3-TRANSFER-05** — UI `/movements/transfers`: dos tabs + filtros
  - **Salida:** ruta con gate `inventory:read`; tabs "Pendientes de recibir (n)" / "Pendientes de enviar (n)" con contadores de `meta`; filtros origen/destino (`WarehouseSelect` no scoped), antigüedad (todos / > 7 días), rango de fechas; tabla folio (el del documento de despacho, link al documento), fecha, origen, destino, líneas, días con **badge** naranja `isStale`; paginación server-side; estado vacío por tab; `lib/inventory/transfers-api.ts` + hooks
  - **Verificar:** `routes/movements-transfers.test.tsx`: cambiar de tab cambia `direction` en el request; fila con `isStale` muestra el badge (por dato, no por copy); sin permiso → gate
  - **Depende de:** F3-TRANSFER-01, F3-NAV-02
  - **Estimación:** 3 h
  - **Hecho** (2026-08-19: `transfers-list.tsx`, `transfers-api.ts`, `transfers-hooks.ts`, ruta cableada; 8 tests). **Los contadores de los tabs salen de `meta` y NO de contar las filas visibles**: con paginación, contar la página diría "1" cuando hay siete. **El badge de demora sale del DATO `isStale`**, no de comparar días en la pantalla: el umbral vive en el servidor y una segunda copia se desincronizaría. Las dos cosas tienen contraprueba. **El barrido de theming me cazó**: usé `bg-orange-500` crudo y el proyecto prohíbe la paleta de Tailwind — se pasó al token `warning`, y de paso al `Badge` del design system que ya tenía esa variante

- [x] **F3-TRANSFER-06** — UI de recepción: crear el borrador y navegar
  - **Salida:** click en fila incoming (`inventory:movement`) → `ConfirmDialog` corto con `GET /transfers/:id`, **sin capturar cantidades**: cabecera (origen → destino, enviado por, fecha, número de líneas) y la leyenda de que se va a crear una Entrada en borrador con lo enviado ya cargado; «Crear entrada» → `POST /transfers/:id/receipt-draft` y navega a `/movements/documents/$id`; 409 (ya cerrado por otro) → mensaje y refresco. El conteo real ocurre en la pantalla del documento (F3-DOC-09), que para `reason_code='transfer'` con origen muestra la columna **Enviado** junto a la cantidad: recibido > enviado → error inline + leyenda "registralo como Entrada con motivo Ajuste" y confirmar deshabilitado; alguna diferencia → Nota obligatoria
  - **Por qué no un modal con su propia tabla:** sería una segunda copia de la tabla de líneas y las dos divergirían en cuanto una gane una columna (lote, ubicación). Además el borrador nace con folio, así que la recepción se retoma si se cierra el sistema a mitad de la descarga; un modal no sobrevive a un F5
  - **Verificar:** test web: el botón postea el borrador y navega a `/movements/documents/$id`; recibido 31 sobre 30 bloquea en la pantalla del documento; 29 exige nota
  - **Depende de:** F3-TRANSFER-02, F3-TRANSFER-03, F3-TRANSFER-05
  - **Estimación:** 3 h
  - **Hecho** (2026-08-19: `DialogoRecepcion`; 4 tests). El diálogo **no captura cantidades** —hay un test que verifica que no exista ni un `spinbutton` adentro—: crea el borrador y navega a la pantalla del documento. **Hallazgo de UX:** `ConfirmDialog` pone el `title` en `aria-label`, así que quien MIRA la pantalla no veía de qué traspaso se trataba; el folio se movió al cuerpo, que es la convención que el propio componente documenta. `ConfirmDialog` ganó tres props opcionales y aditivas (`children`, `error`, `confirmDisabled`). **Bug de integración:** react-query v5 pasa su contexto como SEGUNDO argumento del `mutationFn`, y eso se filtraba hasta la capa de API; se corta envolviendo la llamada

- [x] **F3-TRANSFER-07** — UI cancelar traspaso
  - **Salida:** acción "Cancelar traspaso" visible solo con `inventory:manage`, `ConfirmDialog` con textarea de justificación obligatoria y leyenda "el stock NO vuelve al origen; si reaparece, registralo como Entrada con motivo Ajuste"; → `POST /transfers/:id/cancel`; refresco de tabs
  - **Verificar:** test web: sin `inventory:manage` no hay acción; con justificación vacía el botón queda deshabilitado; el request lleva `reason`
  - **Depende de:** F3-TRANSFER-04, F3-TRANSFER-05
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-19: `DialogoCancelar`; 5 tests). La leyenda de que **el stock no vuelve al origen** no es adorno: es lo único que le dice a quien cancela qué hacer si la mercancía reaparece, y tiene su propio test. El confirmar se deshabilita con menos de 5 caracteres de justificación —el mismo mínimo que el API— para que la pantalla lo diga ANTES en vez de dejar chocar con el 400

---

### Módulo F3-COUNT — Inventario Físico (plantilla, reconciliación, aprobación)

> **El conteo también es un documento con folio (`INV`) y borrador** (corrección del 2026-08-18): se crea desde el listado de Inventario, se baja la plantilla, se sube el contado a sus líneas, se revisa la reconciliación —que es la previa del borrador— y **solo `inventory:manage` confirma**. Se puede cerrar el sistema y retomarlo por folio, que en un conteo de 500 líneas es exactamente cuando más importa. **Una sola plantilla para todo**: los productos con `tracks_lots` ocupan una fila por (lote, ubicación) con `lot_code`/`expires_at`/`location`; los demás una fila con esas columnas vacías — es exactamente el Excel del cliente de Carlos.

- [x] **F3-COUNT-01** — `GET /inventory/counts/template?warehouseId&format=xlsx|csv`
  - **Salida:** `GET /inventory/documents/template?type=physical_count&warehouseId=…` (`inventory:movement`) scope + almacén activo; filas = productos **activos y no compuestos** del tenant, columnas `sku, name, unit, lot_code, expires_at, location, theoretical, counted` (`counted` vacío); para productos **sin** `tracks_lots`: una fila, columnas de lote vacías, `theoretical` = `stock_by_warehouse` o 0; para productos **con** `tracks_lots`: una fila por `stock_lots (lot, warehouse, location)` con saldo > 0 (y una fila vacía de lote si no tiene ninguno, para poder cargar el primero); orden por sku, luego `expires_at`, `lot_code`, `location`; reusa `spreadsheet.ts` (`serializeSpreadsheet`), xlsx en base64 como F2-IMPORT-05; `count-template.service.ts`
  - **Verificar:** `inventory-counts.e2e-spec.ts`: la plantilla trae el SKU con su teórico real tras una entrada; un producto con 3 lotes en 3 ubicaciones sale en 3 filas (el Excel de Carlos); excluye compuestos; csv y xlsx round-trip por `parseSpreadsheet`
  - **Depende de:** F3-CORE-02, F3-CORE-03, F3-DB-06
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-19: `count-template.service.ts`, 6 e2e). **Una sola plantilla para todo**, que es el Excel del cliente de Carlos: con lote, una fila por (lote, ubicación); sin lote, una fila con esas columnas vacías. Partirla en dos obligaría a quien cuenta a saber de antemano qué producto maneja lote — justo lo que viene a averiguar contando. Se agregaron `nombre` y `unidad`, que al sistema le sobran y a quien cuenta le hacen falta (sin ellas contar es adivinar a qué corresponde un SKU); la importación lee por NOMBRE de columna e ignora las que no conoce, así que el round-trip cierra sin editar nada. Un producto marcado con lotes pero SIN ninguno sale con la fila vacía: es la única forma de dar de alta el primer lote desde la planilla. **Test sin dientes corregido:** el de orden usaba códigos `st10/st30/st60`, cuyo orden alfabético coincide con el cronológico — se renombraron para que se contradigan

- [x] **F3-COUNT-02** — `POST /inventory/counts/reconcile` (dry-run puro)
  - **Salida:** la reconciliación **deja de ser un endpoint propio**: subir el archivo es `POST /inventory/documents/:id/lines/import` (F3-DOC-05) y el resultado reconciliado es el **detalle del borrador** (F3-DOC-06), que para `physical_count` agrega `theoretical` y `difference` por línea. Reglas por fila: `sku` existe, activo, no compuesto; `counted` numérico ≥ 0 con ≤ 4 decimales, **entero si la presentación base (factor 1) es solo-enteros**; **lotes**: si el producto tiene `tracks_lots`, `lot_code` es obligatorio (error de fila) y la clave de la fila es `(sku, lot_code, location)`; un `lot_code` que no existe se marca `newLot: true` (se creará al aprobar; `expires_at` obligatoria si el producto lo exige) y si existe con otra `expires_at` → error de fila; si el producto NO tiene `tracks_lots` y la fila trae lote → error de fila; duplicado de la clave en el archivo → error de fila; `counted` vacío → fila `skipped`; el teórico se lee **en el momento de mirar** y el `summary` suma `{ counted, matches, discrepancies, skipped, newLots }`; nada se escribe en stock hasta confirmar
  - **Verificar:** e2e: archivo mixto (2 iguales, 1 sobrante, 1 faltante, 1 vacío, 1 sku inexistente, 1 decimal en solo-enteros, 1 lote nuevo, 1 lote con caducidad distinta, 1 lote en producto sin `tracks_lots`) → summary y errores esperados; ningún `stock_movement` ni `product_lot` creado
  - **Depende de:** F3-COUNT-01, F3-CORE-04
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-19: la reconciliación vive en `DocumentsService.detail`, 6 e2e). **No hay endpoint propio**: el detalle del borrador ES la reconciliación, con `theoretical`, `counted` y `difference` por línea más un `countSummary`. Una pantalla menos y, sobre todo, **un lugar menos donde el teórico podría calcularse distinto**. El teórico de un producto con lote se lee por (lote, ubicación) y no del total: contar el estante B-2 no dice nada del A-1 — hay contraprueba. **Hallazgo:** en un conteo la cantidad de la línea vive en `counted`, no en `quantity`, así que `resolveLines` la marcaba como "falta la cantidad" y ni siquiera llegaba a resolver el lote (por eso `newLot` salía en false). Y una línea SIN contar es OMITIDA, no errónea: quien contaba no llegó a esa fila, y marcarla en rojo sería acusarlo de un error que no cometió

- [x] **F3-COUNT-03** — `POST /inventory/counts/approve` (transacción)
  - **Salida:** rama `physical_count` del confirm (**`inventory:manage`** — es el único tipo que no basta con `inventory:movement`); las líneas salen del borrador, no del body; scope; en UNA tx: crea los `ProductLot` nuevos, `FOR UPDATE` ordenado sobre `stock_by_warehouse` **y** `stock_lots`, relee el teórico **fresco** (por lote cuando aplica); por línea con `counted ≠ theoreticalNow`: **salida `physical_count` del teórico total** (si > 0) + **entrada `physical_count` del contado** (si > 0), mismo `document_id`, con `lot_id`/`location` cuando aplica (así la invariante lote/total se sostiene: el ledger las mueve juntas); iguales → sin movimiento (el CHECK `quantity > 0` lo exige); todo lo generado cuelga del documento `physical_count` (folio `INV`) que ya existía como borrador; audit `inventory.physical_count_approve` con `summary` y por línea `{ productId, theoreticalSeen, theoreticalAtApproval, counted, drifted: seen ≠ now }`; 201 `{ document: { id, folio, type, status }, applied, unchanged, drifted }`
  - **Verificar:** e2e: teórico 120 / contado 115 → dos movimientos (−120, +115), saldo 115; línea igual → 0 movimientos; producto con lotes st30/st10/st60 contado 20/9/1 → solo st10 genera movimientos y el total baja a 30; lote nuevo en la planilla → `ProductLot` creado y saldo cargado; entrada de +10 entre reconcile y approve → `drifted: true` en audit y saldo final = contado; Manager → 403
  - **Depende de:** F3-COUNT-02, F3-CORE-05, F3-CORE-07, F3-DB-07, F3-DOC-03
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-19: `expandCount` + `applyCount` en `confirm.service.ts`, 7 e2e). **Una diferencia se asienta como DOS movimientos** —salida del teórico entero y entrada de lo contado— y no como un ajuste por el delta: así el kardex cuenta "había 40, se contó 35" en vez de un "-5" que no dice de dónde salió. Son dos pasadas del ledger porque cada una tiene su dirección; van en la misma transacción con los locks ya tomados. El teórico se relee **bajo el mismo `FOR UPDATE` y en el mismo orden** que usa el ledger. **`inventory:manage` obligatorio**, con la guarda en el SERVICE y no en el decorador porque el permiso depende del TIPO, que solo se sabe leyendo el documento. **Dos cosas que la base me enseñó:** el CHECK `inventory_documents_reason_on_confirm_check` exige motivo al confirmar, y el del conteo lo pone la APROBACIÓN (`physical_count` no está en `SELECTABLE_*`), justo como decía el tablero; y `stock_movements` no admite cantidad cero, así que una línea que coincide no genera nada. **Para detectar la deriva hubo que guardar el teórico VISTO**: se escribe en `quantity` al importar (documentado: en un conteo esa columna es la foto contra la que se compara, no la cantidad de un movimiento). El ledger ganó `direction` en cada movimiento, porque un conteo devuelve las dos en la misma respuesta y sin ella no se distinguen

- [x] **F3-COUNT-04** — UI `/movements/counts` paso 1
  - **Salida:** la cara de `type='physical_count'` en la pantalla del documento (F3-DOC-09): `WarehouseSelect` scoped en la cabecera, botones "Descargar plantilla .xlsx / .csv" y control de archivo como botón (input `sr-only` + label, patrón F2-IMPORT-05) que sube al borrador; errores por fila en tabla con descarga csv; sin checkbox de bloqueo (decisión) y leyenda "el conteo se aplica sobre el saldo del momento de aprobar"; leyenda de la plantilla: "los productos con lote traen una fila por lote y ubicación; deja las columnas de lote vacías en los que no lo manejan"
  - **Verificar:** test web: la plantilla se pide con el `warehouseId` elegido; el archivo viaja en base64; errores de fila se listan por `row`
  - **Depende de:** F3-COUNT-02, F3-NAV-01, F3-NAV-02
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-19: `count-panel.tsx`, 5 tests). La plantilla se pide para el almacén DEL DOCUMENTO y no para uno elegido aparte: el borrador ya nació contra un almacén, y ofrecer otro invitaría a contar un estante y aplicarlo sobre el de al lado. Input `sr-only` detrás de su label (patrón F2-IMPORT-05) y `mode: replace` — subir el conteo dos veces es corregirlo, no contarlo dos veces. La leyenda del saldo fresco contesta por adelantado la pregunta más frecuente de un inventario: "¿y si alguien vende mientras cuento?"

- [x] **F3-COUNT-05** — UI paso 2: reconciliación y aprobación
  - **Salida:** el panel de previa del borrador `INV`: resumen (contados / coincidencias / discrepancias / omitidos), tabla SKU / lote / caducidad / ubicación / teórico / contado / diferencia (las tres de lote solo si alguna fila las trae) con filtro "solo discrepancias" y badge "lote nuevo" en las filas `newLot`, descarga del reporte (csv client-side), leyenda de lo que se generará; botón **Confirmar** con gate `inventory:manage` (sin él: aviso "un TenantAdmin debe aprobar este conteo" — y el borrador queda guardado esperándolo, que es media razón por la que existe) → `ConfirmDialog` → confirm; resultado con `drifted` destacado; "Nuevo conteo"
  - **Verificar:** test web: sin `inventory:manage` el botón no existe y el aviso sí; el borrador sobrevive a recargar la página; resultado con `drifted > 0` muestra la advertencia
  - **Depende de:** F3-COUNT-03, F3-COUNT-04
  - **Estimación:** 3 h
  - **Hecho** (2026-08-19: la cara de conteo en `document-detail.tsx`, 7 tests). El resumen sale de `countSummary` del servidor y no de contar las filas visibles, que daría otro número con filtro o paginación. **Bug que cazó el test:** el confirmar quedaba deshabilitado para SIEMPRE en un conteo, porque `faltaCabecera` exigía un `reasonCode` que un conteo no tiene por diseño. Y el badge de "lote nuevo" salía dos veces (en la columna de stock y en la de contado). **Sin `inventory:manage` no hay botón y se explica por qué**: el borrador queda guardado con su folio esperando a quien pueda firmarlo, que es media razón por la que el conteo es un borrador y no un formulario

---

### Módulo F3-KARDEX — Kardex y Consultas de Stock

- [x] **F3-KARDEX-01** — `GET /products/:id/kardex`
  - **Salida:** `KardexController` (`inventory:read`, en el módulo inventory): filtros `warehouseId` (∈ scope, si no 403), `from`, `to`, `direction`, `reasonCode`; `page/pageSize`; orden `created_at desc, seq desc`; **`balanceAfter`** con window function `SUM(CASE direction WHEN 'entry' THEN quantity ELSE -quantity END) OVER (PARTITION BY warehouse_id ORDER BY created_at, seq)` calculada en una CTE sobre TODO el histórico del producto en los almacenes del scope, y recién después filtros + paginación (`$queryRaw` tipado); **`seq` es `BigInt` y `JSON.stringify` revienta con BigInt** — sirve para ORDENAR, no para exponerlo crudo en la respuesta; fila `{ id, document: { id, folio, type, status } (el folio es un link al documento), createdAt, direction, reasonCode, quantity, presentation: { id, name, factor, quantityInPresentation } | null, lot: { id, lotCode, expiresAt } | null, location, unitCost, warehouse: {id,name}, linkedWarehouse | null, transfer: { id, folio } | null, parentProduct: { id, sku, name } | null, reference, reasonNote, createdBy: {id,name}, balanceAfter }`; filtro opcional `lotId`
  - **Verificar:** `kardex.e2e-spec.ts`: secuencia +50, −10, +5 en A y +7 en B → `balanceAfter` 50/40/45 en A y 7 en B; **una entrada de 3 líneas en la misma tx muestra saldos intermedios correctos y en orden estable** (es lo que `seq` garantiza); filtrar `reasonCode` no altera los saldos; Manager con scope [A] no ve filas de B y `warehouseId=B` → 403
  - **Depende de:** F3-CORE-03, F3-CORE-05
  - **Estimación:** 3.5 h
  - **Hecho** (2026-08-19: `kardex.service.ts` + `kardex.controller.ts`, 10 e2e). **`balanceAfter` es lo que justifica el endpoint**: la lista de movimientos la da cualquier `findMany`; el saldo que QUEDÓ después de cada línea no se puede reconstruir mirando una página. Por eso hay `$queryRaw` con una CTE: la window function corre sobre TODO el histórico y los filtros y la paginación se aplican DESPUÉS — calcularla sobre la página haría que la primera fila arrancara en cero, y sobre lo filtrado inventaría un saldo que nunca existió (esconder las salidas no las deshace). Las tres cosas tienen contraprueba. `PARTITION BY warehouse_id` porque el saldo es de un almacén. **Corrección al enunciado del tablero:** decía "una entrada de 3 líneas en la misma tx" para probar `seq`, pero tres líneas del mismo producto **se SUMAN** en el borrador (`DocumentLinesService.add` fusiona: escanear dos veces el mismo código no duplica). El caso real de `seq` son tres **LOTES**, que sí son tres movimientos con el mismo `created_at`; el test se reescribió así y su contraprueba (quitar el desempate) ahora muerde. `seq` es `BigInt` y NO se expone: `JSON.stringify` revienta con él

- [x] **F3-KARDEX-02** — UI tab Kardex en el detalle de producto
  - **Salida:** tab "Kardex" en `catalog.products.tsx` (visible con `inventory:read`) → `components/inventory/kardex-tab.tsx`: filtros (almacén scoped, fechas, dirección, motivo), tabla fecha / tipo (badge por dirección + motivo i18n) / cantidad con signo y presentación / lote · caducidad · ubicación (solo si el producto tiene `tracks_lots`) / almacén / referencia-folio (link a traspasos) / usuario / **saldo en almacén**; paginación server-side; compuestos muestran aviso "los compuestos no tienen kardex propio: mirá sus componentes"
  - **Verificar:** `routes/catalog-products.test.tsx` extendido: la tab existe con `inventory:read` y no sin él; cambiar filtro dispara request con `reasonCode`; el saldo se pinta desde `balanceAfter`
  - **Depende de:** F3-KARDEX-01, F3-NAV-02
  - **Estimación:** 3 h
  - **Hecho** (2026-08-19: `kardex-tab.tsx`, 7 tests). El saldo se pinta desde `balanceAfter` del servidor — la pantalla nunca lo suma. Las columnas de lote solo aparecen si el producto los maneja: en uno que no, son tres columnas vacías que solo hacen scroll. Un compuesto no consulta el endpoint y explica que no tiene kardex propio; una tabla vacía haría pensar que nunca se movió, que es otra cosa. **Los tests montan un router mínimo cuya raíz ES el componente**, en vez de stubbear `Link`: así el `href` que se verifica es el que el router genera de verdad

- [x] **F3-KARDEX-03** — `GET /products/:id/stock`
  - **Salida:** (`inventory:read`) filas por almacén **activo ∈ scope** `{ warehouseId, name, quantity, updatedAt }` (0 y `updatedAt: null` si no hay fila), `total`, `stockMin`, `belowMin`; `?warehouseId=` devuelve solo ese (lo usa la salida en vivo); producto con `tracks_lots` → cada fila de almacén trae `lots: [{ lotId, lotCode, expiresAt, location, quantity }]` ordenados FEFO (el primero es el que se descuenta primero) más `expiringSoon` (lotes con `expires_at` ≤ hoy + 30 días); compuesto → `{ isComposite: true, rows: [], availability: { units, limitingComponent } }` (reusa `availability`)
  - **Verificar:** e2e: tras entradas en A y B, Manager con scope [A] recibe solo A y `total` = A; producto sin filas → filas en 0; producto con lotes devuelve `lots` en orden FEFO y `Σ lots.quantity == quantity` de la fila; compuesto responde availability
  - **Depende de:** F3-CORE-03, F3-DB-02, F3-DB-06
  - **Estimación:** 2 h
  - **Hecho** (2026-08-19: `KardexService.stock`, 6 e2e). **Devuelve los almacenes en CERO**, con `updatedAt: null`: "nunca llegó a esta bodega" y "se agotó en esta bodega" piden decisiones distintas, y sin la fila no se distinguen — hay contraprueba. El total y el `belowMin` se calculan sobre lo que el usuario PUEDE ver: para un Manager de una bodega, "bajo mínimo" es sobre la suya. Los lotes salen en el MISMO orden FEFO que `resolveLotsFefo`; otro haría que la pantalla contradiga al ledger, y el test usa códigos cuyo orden alfabético es el inverso del cronológico para que la contraprueba muerda. Un compuesto responde con unidades armables y el componente que las limita

- [x] **F3-KARDEX-04** — `GET /inventory/in-transit`
  - **Salida:** (`inventory:read`) agregado por producto de `transfer_lines` de traspasos `in_transit` con **origen ∈ scope** (stock que salió y no fue confirmado): `{ productId, sku, name, baseUnit, quantity, transfers }`; filtros `productId`, `originWarehouseId`; paginado por sku; también expuesto como `inTransit` en la respuesta de F3-KARDEX-03 (por producto)
  - **Verificar:** e2e: traspaso de 10 → `quantity: 10`; tras confirmar 9 → desaparece del listado (no hay parciales); cancelado → desaparece
  - **Depende de:** F3-EXIT-01, F3-KARDEX-03
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-19: `KardexService.inTransit`, 4 e2e). **El alcance mira el ORIGEN**: es mercancía que salió de MI bodega y de la que sigo siendo responsable hasta que alguien la reciba. Quien solo administra el destino no tiene stock en tránsito — lo suyo son los traspasos entrantes, que son otra pantalla. Con contraprueba. No hay parciales: recibido o cancelado, desaparece

- [x] **F3-KARDEX-05** — UI tab "Stock por almacén"
  - **Salida:** tab en el detalle de producto (`inventory:read`) → `components/inventory/stock-tab.tsx`: tabla almacén / cantidad (con `unitName`) / actualizado, fila **Total** con badge "bajo mínimo" si `belowMin`, fila **En tránsito** desde `inTransit`; producto con `tracks_lots` → cada almacén se expande en sus lotes (lote, caducidad, ubicación, cantidad) con badge "vence pronto" en `expiringSoon` y "se descuenta primero" en el primero FEFO; compuesto → panel de unidades armables + componente limitante (reusa el resumen de BOM); links "Registrar entrada / salida" hacia los forms con el producto preseleccionado (query param) si tiene `inventory:movement`
  - **Verificar:** test web: `belowMin: true` muestra el badge; compuesto renderiza availability y no la tabla; sin `inventory:movement` no hay links
  - **Depende de:** F3-KARDEX-03, F3-KARDEX-04, F3-NAV-02
  - **Estimación:** 2 h
  - **Hecho** (2026-08-19: `stock-tab.tsx`, 8 tests). El PRIMER lote de cada almacén se marca como "se descuenta primero": decirlo evita la sorpresa de ver salir una partida distinta de la que uno tenía en mente. Fila de total con badge de bajo mínimo y fila de en tránsito. **El barrido de voseo me cazó:** copié «Mirá» del texto del propio tablero sin filtrarlo, y la LEY pide español neutro conjugado en "tú" — el test `i18n.test.tsx` lo tumbó y quedó «Consulta»

---

### Módulo F3-LOTS — Lotes, Caducidad y Ubicación (opt-in por producto)

> Lo que no cabe en los otros módulos: el flag en el producto, el endpoint de lotes que consumen los formularios, la guarda para apagar el flag y las alertas de vencimiento. La lógica de STOCK por lote (FEFO, upsert, invariante) vive en F3-CORE; la captura vive en ENTRY/EXIT/COUNT. Decisión de Carlos (2026-08-17) sobre un Excel real de cliente — ver `topic_key: sellpoint/f3-lots-fefo`.

- [x] **F3-LOTS-01** — `tracks_lots` en el producto (API + form) con guarda para apagarlo
  - **Salida:** `tracksLots` en `createProductSchema`/`updateProductSchema` (default `false`); `products.service.update` con `tracksLots: false` sobre un producto que tiene `stock_lots` con saldo > 0 → 409 `products.lots_in_stock` (con el total por lote en el payload) — apagarlo con saldo dejaría lotes huérfanos y rompería la invariante; encenderlo siempre se puede (los saldos previos quedan como "sin lote": el ledger, al primer movimiento de un producto recién marcado, exige lote solo para lo que ENTRA de ahí en más — el saldo previo se puede asignar a lotes vía inventario físico); checkbox "Este producto se controla por lote y caducidad" en `ProductForm` con `title` explicativo cuando está bloqueado; en la planilla de importación (F2-IMPORT) columna `controla_lotes` opcional; docblock con la regla
  - **Verificar:** e2e `products`: encender → 200; apagar con saldo en lote → 409; apagar sin saldo → 200; test web: el checkbox se deshabilita con `title` cuando el API lo bloquearía (el detalle trae `hasLotStock`)
  - **Depende de:** F3-DB-06
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18: `upsert-product.dto.ts`, `products.service.ts`, `import.service.ts` y el checkbox en `catalog.products.tsx`; 7 e2e de productos + 4 de importación + 3 web). **Desbloquea todo lo de lotes**: la columna existía desde F3-DB-06 pero ningún endpoint la escribía, así que FEFO solo estaba probado a nivel integración y no había forma de ejercitarlo por HTTP. **La asimetría es la regla**: encender siempre se puede (el saldo previo queda "sin lote" y se asigna después por inventario físico); apagar con saldo da 409 y **el payload lleva el detalle por lote** — "no se puede apagar" a secas deja a quien lo intenta sin saber qué mover para poder hacerlo. Un lote en CERO no bloquea: estorba el saldo, no el registro. **Hallazgo que valió el test:** la importación escribe con `tx.product.update` **directo**, sin pasar por la guarda del service — una planilla podía apagar el control con saldo y romper `Σ stock_lots == stock_by_warehouse` **en silencio**. Se le puso su propia validación, con el error POR FILA y entrando por la puerta que ya existía (400 todo-o-nada con el reporte), sin inventar un camino paralelo. En la planilla, celda vacía es `null` y **no** `false`: "no vino el dato" y "vino que no" son cosas distintas, y confundirlas apagaría el control de todo producto cuya planilla no traiga la columna. El parser acepta `si/sí/yes/true/1/x/verdadero` porque rechazar "SI" sería pedirle al usuario que hable como la base. En el form, el checkbox se bloquea **solo si `hasLotStock` Y ya está encendido**, con `title` explicativo: un checkbox gris sin explicación se lee como un bug de la pantalla

- [x] **F3-LOTS-02** — `GET /products/:id/lots` + `GET /warehouses/:id/locations`
  - **Salida:** (`inventory:read`) lista de `product_lots` del producto `{ id, lotCode, expiresAt, totalQuantity, byWarehouse: [{ warehouseId, location, quantity }] }` ordenados FEFO, `?withStock=true` filtra saldo > 0, `?warehouseId=` acota; `GET /warehouses/:id/locations` devuelve las ubicaciones **distintas** ya usadas en `stock_lots` de ese almacén (para el autocompletado; texto libre, sin catálogo); ambos respetan scope
  - **Verificar:** e2e: tras entradas en dos lotes, el listado los trae en orden FEFO con `totalQuantity` correcto; ubicaciones distintas sin repetir; Manager fuera de scope → 403
  - **Depende de:** F3-DB-06, F3-CORE-03
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-18: `lots.service.ts` + `lots.controller.ts` en el módulo de inventario, 12 e2e en `inventory-lots.e2e-spec.ts`). **Los dos endpoints viven en el módulo de INVENTARIO** aunque sus rutas cuelguen de `/products` y `/warehouses`: lo que devuelven es SALDO, no catálogo, y ponerlos en esos controllers obligaría a inyectarles un servicio de inventario, atando dos módulos por una sola pantalla. Por lo mismo el permiso es `inventory:read` y no `products:read` — quien puede ver el catálogo no necesariamente puede ver cuánto hay. **El orden es el MISMO `expires_at ASC NULLS LAST` de `resolveLotsFefo`**, con desempate por código: quien elige un lote a mano quiere ver primero el que el sistema habría elegido solo, y otro orden lo empujaría a contradecir la regla sin querer. **Tres decisiones que el test fija**: (a) `withStock` mira el TOTAL ya acotado y no la existencia de filas — un lote con una fila en cero está agotado igual; (b) `?warehouseId=` cambia el NÚMERO, no solo filtra filas (st30 tiene 3 en total pero 1 en Central); (c) sin acotar, un usuario con alcance parcial ve el saldo RECORTADO en vez de un 403 — fallar escondería que el lote existe, y mostrar el total filtraría cuánto hay en una bodega ajena. Las ubicaciones salen de lo YA USADO y no de un catálogo (texto libre a propósito: un catálogo obligaría a dar de alta el estante antes de poder guardar la primera caja), y el `''` se excluye porque es el centinela de "sin ubicación" que entra en la PK, no una ubicación real. **Tropiezo:** la relación de `ProductLot` hacia `StockLot` se llama `stock`, no `stockLots` — el 500 de Prisma lo dijo enseguida

- [x] **F3-LOTS-03** — Alertas de vencimiento (chicas, sin jobs)
  - **Salida:** `GET /inventory/expiring?days=30&warehouseId?` (`inventory:read`): lotes con `expires_at ≤ hoy + days` y saldo > 0 en almacenes del scope, `{ productId, sku, name, lot: { lotCode, expiresAt }, warehouse, location, quantity, daysLeft }` ordenados por `expires_at`; incluye `expired: true` para los ya vencidos; **sin cron ni notificaciones** (F5/F6 deciden si hay mail); tarjeta "Próximos a vencer (n)" en el dashboard (solo si el tenant tiene algún producto con `tracks_lots`) con link a una vista `/movements/expiring` (tabla + filtro días 7/30/90 + botón "Dar salida por caducado" que abre la Salida con motivo `expired`, producto y lote preseleccionados)
  - **Verificar:** e2e: lote que vence en 10 días aparece con `days=30` y no con `days=7`; vencido ayer aparece con `expired: true`; sin `tracks_lots` en el tenant, la tarjeta no se renderiza (test web por datos)
  - **Depende de:** F3-LOTS-02, F3-EXIT-02, F3-NAV-02
  - **Estimación:** 3 h
  - **Hecho** (2026-08-18: `listExpiring` en `lots.service.ts`, `expiring-list.tsx`, `expiring-card.tsx`, ruta `/movements/expiring` y entrada en el nav; 7 e2e + 10 web). **Sin cron y sin notificaciones, a propósito**: es una CONSULTA que la pantalla hace al abrirse. Un job que manda mails es una decisión de producto y de costos que F5/F6 tomarán con más información — construirla ahora sería infraestructura para una necesidad que nadie expresó todavía. **Lo YA vencido aparece siempre**, sin importar el `days` pedido: sigue en el estante y hay que sacarlo; esconderlo por "ya pasó" es justo el error que la pantalla viene a evitar. Cae del `<=` sin código extra. Los lotes SIN fecha no aparecen nunca (no vencen). **El botón «Dar salida por caducado» no abre un formulario vacío**: crea el borrador con motivo, producto, lote y cantidad ya puestos, y en el almacén DONDE ESTÁ el lote — quien llegó hasta ahí ya sabe qué va a sacar. **Cambio deliberado sobre el tablero:** la tarjeta se condiciona a que HAYA filas por vencer y no a que el tenant tenga productos con `tracks_lots`. Es más estricto, no necesita endpoint nuevo, y cubre los dos casos: un negocio sin lotes nunca tiene filas, y uno con lotes pero nada por vencer tampoco necesita una tarjeta que diga "0". **Dos tests sin dientes que hubo que arreglar:** (a) el de ORDEN pasaba con `ORDER BY lot_code` porque el código del lote vencido («ayer») también salía primero alfabéticamente — se renombraron los códigos para que el orden alfabético sea el INVERSO del cronológico (`zzz-ayer` vence primero); (b) el del filtro `?warehouseId=` usaba un UUID al azar y el token de OTRO tenant, así que daba vacío por razones equivocadas — ahora hay dos bodegas reales con el mismo producto. **Colisión de nombre accesible:** el enlace del nav y la tarjeta del dashboard dicen el mismo texto, así que el test agarraba el del nav; se desambiguó con `data-testid`

- [x] **F3-LOTS-04** — Editar un lote (caducidad y código) con auditoría
  - **Salida:** `PATCH /products/:id/lots/:lotId` (`inventory:movement`) para corregir `expiresAt` o `lotCode` (`lotCode` único por producto → 409 `inventory.lot_code_taken`); cambiar `expiresAt` **cambia el orden FEFO** de todo el stock de ese lote — se audita con before/after (`inventory.lot_update`); no se borra un lote (los movimientos lo referencian; sin saldo simplemente deja de aparecer con `withStock=true`); UI: en la tab Stock por almacén, acción "Editar lote" sobre la fila del lote con `ConfirmDialog` si cambia la caducidad ("esto cambia qué lote se vende primero")
  - **Verificar:** e2e: cambiar caducidad y una salida FEFO posterior toma el nuevo orden; código repetido → 409; audit registra before/after; test web: el diálogo aparece solo al cambiar la fecha
  - **Depende de:** F3-LOTS-02, F3-KARDEX-05
  - **Estimación:** 2 h
  - **Hecho** (2026-08-19: `LotsService.updateLot` + `lot-editor.tsx`; 7 e2e + 4 web). **Cambiar `expiresAt` NO es lo mismo que corregir un typo en el código**, aunque el formulario sea el mismo: la fecha decide qué partida sale primero (FEFO), así que corregirla reordena TODO el stock de ese lote en todos los almacenes y la próxima venta va a tomar otra. Por eso se audita con `before`/`after` —sin el "antes" nadie podría explicar por qué el orden de salida cambió de un día para el otro— y por eso **el diálogo aparece SOLO cuando cambia la fecha**: pedir confirmación para todo entrena a aceptar sin leer, y el día que importa ya nadie lee. La contraprueba cubre las dos direcciones (nunca aparece / aparece siempre). El e2e verifica lo que de verdad importa: tras corregir la fecha, el listado FEFO devuelve los lotes en el orden NUEVO. Quitar la caducidad manda el lote al final (no vence, no corre riesgo). Un lote no se borra: las FK son `Restrict` y sin saldo simplemente deja de aparecer con `withStock=true`. **Dos descuidos míos en los tests:** el `beforeEach` no reseteaba el mock de `updateLot` —las llamadas del test anterior se acumulaban— y el mock del 409 mandaba solo el `code`, cuando el filtro del API devuelve el `message` ya traducido (mismo contrato que `fieldErrorsOf`)

---

### Módulo F3-GUARDS — Puntos de Extensión Heredados de F2

> F2 dejó cinco lugares documentados "F3 lo completa". Se cierran acá, cada uno con su e2e, más una limpieza de vocabulario que exige la LEY. Criterio: **si el API tiene una guarda, la UI la muestra antes del clic** (disabled + title), no deja chocar con el 409.

- [x] **F3-GUARDS-01** — `presentations.service#assertDeletable`: presentación en uso
  - **Salida:** el cuerpo vacío pasa a `tx.stockMovement.count({ where: { presentationId } }) > 0` → 409 `products.presentation_in_use` (claves i18n es/en); la UI de presentaciones (F2-PRESENT-04) mapea el 409 a "tiene movimientos: desactivala"; el FK RESTRICT de F3-DB-01 queda como red
  - **Verificar:** e2e `products`: entrada con la presentación → `DELETE` 409; desactivar sigue funcionando; sin movimientos borra
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h
  - **Hecho:** el cuerpo vacío pasa a contar `stockMovement` por `presentationId` dentro de la misma `tx` del borrado. El mensaje **nombra la salida no destructiva** ("desactívala en lugar de borrarla"): un 409 que solo dice "no" deja al usuario sin próximo paso, y el que hay es bueno — la presentación sigue existiendo para leer la historia y desaparece de los selectores. La UI no necesitó cambio: ya pintaba `apiError.message`, que el filtro devuelve **ya traducido**.

- [x] **F3-GUARDS-02** — `products.remove` y `assertBaseUnitChangeable` con movimientos
  - **Salida:** `remove` → 409 `products.has_movements` si existen `stock_movements` con `product_id` **o** `parent_product_id` = id, o `transfer_lines`, o `product_lots`; `assertBaseUnitChangeable` suma 409 `products.base_unit_locked_by_movements` (con historia, la unidad no cambia aunque el saldo sea 0); UI mapea ambos (base_unit deshabilitada con motivo; borrar ofrece desactivar); el comentario "su receta" de `products.service.ts:328` pasa a "su composición" (LEY)
  - **Verificar:** e2e: producto con una salida → `DELETE` 409 y `PATCH baseUnit` 409; `rg -n "receta" apps/api/src` sin resultados
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h
  - **Hecho:** se cuentan **cuatro** clases de historia (`stockMovement` por `productId`, por `parentProductId`, `transferLines` y `productLots`), no solo la primera: un compuesto que nunca se movió pero cuyos componentes sí tiene historia igual. La unidad base queda congelada **aunque el saldo sea 0** — es la unidad en la que están escritas las cantidades pasadas, y cambiarla reinterpretaría toda la historia sin tocar un número. "su receta" → "su composición" por la LEY; `rg -n "receta" apps/api/src` sin resultados.

- [x] **F3-GUARDS-03** — Almacén: no desactivar con stock ni traspasos abiertos (CU-ALM-02)
  - **Salida:** `warehouses.update` con `isActive: false` → 409 `warehouses.has_stock` si `Σ stock_by_warehouse.quantity > 0` en el almacén (con el total en el payload) o 409 `warehouses.has_transfers_in_transit` si es origen/destino de un `Transfer in_transit`; docblock de F2 actualizado; UI de almacenes mapea ambos y deshabilita el toggle con `title` cuando aplica
  - **Verificar:** e2e `warehouses`: con saldo → 409; tras salida a 0 → desactiva; con traspaso pendiente → 409
  - **Depende de:** F3-DB-02
  - **Estimación:** 1.5 h
  - **Hecho:** el 409 lleva el `total` en el payload — sin él, "no se puede" no dice **cuánto** hay que mover. Bloquean **origen y destino**: si es destino hay mercancía en camino que nadie podría recibir; si es origen, un traspaso sin quien lo despache. Para el criterio del módulo ("la UI la muestra antes del clic") `GET /warehouses` gana `deactivationBlockedBy: "stock" | "transfers_in_transit" | null` y el botón queda `disabled` con `title`. Es **un motivo y no dos banderas** a propósito: `update` corta en el saldo antes de mirar los traspasos, así que dos banderas prometerían un orden que la guarda no respeta. La barrera anti-voseo rechazó el primer copy ("dale salida", forma ambigua) — tercera vez que ataja algo que ningún test de comportamiento habría visto.

- [x] **F3-GUARDS-04** — `TenantTransactionsGate.hasTransactions()` real
  - **Salida:** `withTenantContext` → `stockMovement.count() > 0`; el `TODO(F3-F4)` pasa a `TODO(F4): sumar sales`; test unit del gate actualizado
  - **Verificar:** e2e `tenants-me`: tenant recién creado cambia currency; tras una entrada → 409 (guard existente)
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h
  - **Hecho:** el gate **mentía desde F1** — devolvía `false` siempre porque no existían las tablas, así que la moneda se podía cambiar con historia adentro. **Un solo movimiento la congela**, sin umbral: los importes ya escritos no tienen unidad propia, la heredan del tenant. La cuenta corre **dentro de `withTenantContext`**, y eso no es cosmético: sin el contexto la RLS no acota y un tenant congelaría a todos los demás. El spec unitario se reescribió con un doble que corre el callback, y uno de sus tres tests verifica justamente que el `tenantId` llega.

- [x] **F3-GUARDS-05** — `availability` respeta el scope + nota de `costEstimate`
  - **Salida:** `CompositionService.availability(user, productId, scope)` suma stock solo de `warehouseScopeWhere(scope)`; el controller pasa `@CurrentUserScope()`; `costEstimate` mantiene `cost/factor` y su docblock dice "promedio ponderado → F5" (decisión Carlos 2026-08-17); tests de availability actualizados con stock sembrado en dos almacenes y scope parcial; F2-BOM-05 (columna unidades armables en la lista) hereda el scope sin cambios de UI
  - **Verificar:** unit: stock 10 en A y 10 en B, scope [A] → armables según A; e2e con Manager scoped
  - **Depende de:** F3-CORE-03
  - **Estimación:** 1.5 h
  - **Hecho:** `availability` sumaba **todos** los almacenes: un Encargado de un solo almacén veía 53 unidades armables donde con su stock solo podía armar 3 — un número que invita a prometer lo que no se puede entregar. Ahora filtra por `warehouseScopeWhere(scope)` y el controller pasa `@CurrentUserScope()`. `costEstimate` queda con `cost/factor` y su docblock dice promedio ponderado → F5.

---

### Módulo F3-NAV — Navegación, Selector de Almacén y Alcance en UI

- [x] **F3-NAV-01** — Componente `WarehouseSelect`
  - **Salida:** `components/inventory/warehouse-select.tsx`: props `scoped` (usa `GET /warehouses?scoped=true`) o todos los activos, `excludeIds`, `value/onChange`, auto-selección si hay uno solo, estado vacío con CTA a `/warehouses` (con `warehouses:manage`), integrado con react-hook-form; `lib/warehouses/hooks.ts` gana `useScopedWarehouses()`
  - **Verificar:** test del componente: con `scoped` pide `?scoped=true`; con un solo almacén lo selecciona; `excludeIds` lo quita de las opciones
  - **Depende de:** F3-CORE-03
  - **Estimación:** 1.5 h
  - **Hecho** (2026-08-18: `components/inventory/warehouse-select.tsx` + `useScopedWarehouses()`, 7 tests). Dos comportamientos que parecen detalles: **auto-selección con un solo almacén** (la mayoría de los negocios tiene uno, y obligarlo a elegirlo en cada movimiento es fricción pura) y **estado vacío en vez de un `<select>` sin opciones**, que no diría qué hacer. `useScopedWarehouses` usa una clave de caché distinta: compartirla haría que la pantalla de administración pisara la lista de los selectores

- [x] **F3-NAV-02** — Grupo nav "Movimientos" + rutas + namespace i18n web + cliente API
  - **Salida:** grupo "Movimientos" en `app-layout.tsx` (**Entradas**, **Salidas** e **Inventario** → `inventory:read` — los tres abren su listado con buscador por folio y botón de crear, que exige `inventory:movement`; Traspasos → `inventory:read`; Próximos a vencer → `inventory:read` **solo si el tenant tiene productos con `tracks_lots`**; el grupo aparece si alguno); rutas registradas con `PermissionGate` y placeholders hasta sus módulos; `apps/web/src/i18n/{es,en}/inventory.json` (motivos, direcciones, estados de traspaso, copy neutro) cableado en `i18n/index.ts`; `lib/inventory/api.ts` + `hooks.ts` + `types.ts` base (tipos de respuesta del API, `useCreateEntry/useCreateExit` con invalidación de `products`, `stock`, `transfers`)
  - **Verificar:** test por routeTree real: el Viewer ve los cinco listados pero sin botón de crear; el Manager los ve con el botón; sin ningún permiso el grupo no existe; guardián de voseo verde con el namespace nuevo
  - **Depende de:** F3-DB-05
  - **Estimación:** 2 h
  - **Hecho** (2026-08-18: grupo nav, 4 rutas placeholder con `PermissionGate`, `i18n/{es,en}/inventory.json`, `lib/inventory/{api,hooks,types}.ts`; 3 tests de nav por routeTree real). El menú se gatea con **`inventory:read`, no `:movement`**: quien AUDITA tiene que poder mirar sin poder mover; el botón de crear vive dentro de cada pantalla. Las rutas existen desde ahora aunque sean placeholders — un menú que ofrece algo que da 404 es peor que un menú más corto. `useConfirmDocument` invalida `documents`, `products`, `stock` y `transfers`: olvidar una deja la pantalla mintiendo hasta el próximo refresco

- [x] **F3-NAV-03** — UI de alcance por almacén en `UserForm` (deuda de F2-SCOPE-03)
  - **Salida:** sección "Alcance por almacén" en `components/system/user-form.tsx` (CU-SYS-04): checklist de almacenes vía `GET/PUT /users/:id/warehouse-scope`; **deshabilitada si el usuario tiene rol TenantAdmin** con leyenda de acceso total; vacío = todos (leyenda del default permisivo); `lib/rbac/api.ts` gana los dos calls
  - **Verificar:** `routes/system-users.test.tsx`: estados derivados de datos (rol, filas), no de copy; guardar manda el reemplazo completo de ids
  - **Depende de:** —
  - **Estimación:** 2 h
  - **Hecho:** el estado de "ve todos los almacenes" se deriva de los **permisos de los roles marcados en el form**, no del nombre del rol: es el mismo criterio que el API (`TENANT_ADMIN_PERMISSION_CODES` = `roles:manage` + `users:manage`, que el interceptor de alcance reutiliza para su bypass), y atarse a la cadena "Admin" se rompería con un rol renombrado o traducido. Y se deriva de lo **marcado ahora**, no de `user.roles`: si no, marcabas el rol que da acceso total y la lista seguía ofreciendo una restricción que ya no iba a existir. La sección vive **solo en edición** — `PUT /users/:id/warehouse-scope` necesita un id y el usuario nace recién al guardar; encadenar las dos llamadas en el alta dejaría un usuario creado con el alcance sin aplicar si la segunda falla, una escritura parcial sin transacción. El `PUT` sale **solo si el set cambió**: uno idéntico ensuciaría la auditoría con un cambio que no ocurrió. La leyenda de "vacío = todos" es obligatoria y no decorativa: quien desmarca todo tiene que saber que acaba de **ampliar** el acceso, no de quitarlo. `userFormSchema` recibe `warehouseIds` como `.optional()` y no `.default([])` — el schema se declara espejo de `create-user.dto.ts` y el alta del API no acepta ese campo; el default además desalineaba los tipos de entrada y salida que react-hook-form exige iguales. El container **no monta el form hasta tener el alcance** en edición: con `defaultValues` llegando tarde, react-hook-form los ignora — exactamente C1 del verify #341.

---

### Módulo F3-SVC — Catálogo de Servicios

> Detección de Carlos (2026-08-19): el POS de F4 no podía cobrar trabajo, solo mercancía — `SaleItem` exigía `product_id` y lo más cercano a un servicio era "mano de obra"… diferido a Fase 9 como vertical de pago. Un servicio se vende pero **NO mueve inventario**: tabla propia (no un producto con bandera — `Product` arrastra `base_unit`, `tracks_lots`, `stock_min`, composición y presentaciones, todo sin sentido acá, y meterlo ahí obligaría a que cada query de inventario lo filtre para siempre), sin unidad base, sin lotes, sin presentaciones. Campos: `code` (único por tenant, espejo del `sku`), `name`, `description?`, `cost?` y `price?` `Decimal(14,2)`, `is_active`. Genérico por LEY: un corte de pelo, una reparación y una consulta caben igual. Clasificación: **SDD LIGERO** (CRUD con patrón heredado de warehouses).

- [x] **F3-SVC-01** — Modelo `Service` + migración con RLS de nacimiento
  - **Salida:** modelo en `schema.prisma` (`code`, `name`, `description?`, `cost?`, `price?` `Decimal(14,2)`, `isActive`, `@@unique([tenantId, code])`, `@@index([tenantId])`, `@@map("services")` + relación inversa en `Tenant`); **UNA** migración: CREATE TABLE + FK a `tenants` + ENABLE/**FORCE** RLS + política `tenant_isolation` con `NULLIF(current_setting(...), '')` (molde `f3_lots` — la tabla no existe ni un commit sin aislamiento, lección F3-DOC-03); **sin GRANTs** (los cubre el `ALTER DEFAULT PRIVILEGES` de `app_db_user`); tabla sumada a los 4 canarios RLS **y** al `ARRAY[...]` del test estructural de `pg_class` (está duplicado a propósito y es fácil olvidarlo)
  - **Verificar:** canarios en verde; el test estructural cuenta la tabla nueva con FORCE
  - **Depende de:** —
  - **Estimación:** 1 h
  - **Hecho:** `services-rls.integration.spec.ts` con los cuatro canarios, el estructural de `pg_class` y uno más que fija la unicidad: **el mismo código en OTRO tenant es legal** — el catálogo es de cada negocio, y sin ese test el `@@unique` podría haber quedado global sin que nadie lo notara. La migración suma dos CHECK de importe no negativo: la app ya valida con `moneyAmount()`, pero un precio negativo escrito por otra vía sería dinero inventado. Contraprueba: quitarle el FORCE a la tabla pone en rojo el canario estructural y **solo ese** — los otros cuatro pasan igual, porque la app conecta como `sellpoint_app` (no owner) y a un no-owner la RLS le aplica con FORCE o sin él.

- [x] **F3-SVC-02** — Permisos `services:read` / `services:manage`
  - **Salida:** migración molde `f2_permissions` (INSERT a `permissions` + `role_permissions` vía CROSS JOIN para los tenants YA existentes); `POS_SELLER_CODES` gana `services:read` (en F4 los vende, y sin leerlos no hay qué vender); Manager los recibe por la regla implícita — **NO** van a `MANAGER_EXCLUDED_CODES`: gestionar servicios es operación diaria; Viewer hereda el `:read` solo; `role-catalog.spec.ts` con el bloque nuevo (la trampa de F3-DB-05: todo code no excluido le cae a Manager); nota heredada: una migración SQL no bumpea el perm-epoch — los logueados lo ven en su próximo refresh (≤15 min)
  - **Verificar:** spec del catálogo de roles en verde; e2e 403 sin el permiso
  - **Depende de:** F3-SVC-01
  - **Estimación:** 1 h
  - **Hecho:** el único cambio de código fue **una línea**: `services:read` a `POS_SELLER_CODES`. Todo lo demás lo repartió la regla implícita de `resolveRolePermissionCodes` (Manager recibe lo no excluido, Viewer todo lo `:read`), y el spec en rojo lo confirmó: de los cuatro tests nuevos falló **solo** el de POS_Seller. `services:manage` NO entra a `MANAGER_EXCLUDED_CODES` a propósito — a diferencia de `inventory:manage`, cambiarle el precio a un corte de pelo no reescribe historia.

- [x] **F3-SVC-03** — API CRUD de servicios
  - **Salida:** `modules/services/` calcado de `warehouses/` (service + controller + DTO Zod con el `moneyAmount()` compartido de `products/money.ts` — un solo validador de dinero para todo el sistema); GET (lista con búsqueda por texto) / POST / PATCH / DELETE; unicidad de `code` por P2002 → 409 `services.code_taken`; DELETE hoy borra sin guarda porque nada lo referencia, con `TODO(F4): 409 services.has_sales + FK RESTRICT cuando sale_items exista` — el punto de extensión queda **escrito**, patrón F2→F3-GUARDS; desactivar como salida no destructiva; auditoría en la misma tx; `cost`/`price` como **string en el wire** (convención products); i18n del API es/en (`services.json` se autorregistra por directorio)
  - **Verificar:** e2e molde `warehouses.e2e-spec.ts`: CRUD completo + 409 por code repetido + un tenant no ve ni toca los servicios de otro + 403 sin permiso
  - **Depende de:** F3-SVC-01, F3-SVC-02
  - **Estimación:** 2 h
  - **Hecho:** seis e2e. **Dos contrapruebas NO mordieron y se auditaron en vez de darlas por buenas** (la lección del mismo día): (a) quitar `tenantId` del WHERE de `update`/`delete` deja los tests en verde porque **la RLS ya bloquea** el acceso cruzado — el filtro es defensa en profundidad, no la única red; (b) devolver el `Decimal` crudo en vez de `toString()` tampoco los rompe porque **el Decimal de Prisma ya serializa como string en JSON** — la conversión importa para los TIPOS, no para el cable. Ninguna era un test sin dientes: era entender de menos el código. La búsqueda es por código **o** nombre, y esa sí muerde: quien dicta «manicura» por teléfono no sabe que su código es MANI. Un tercer hallazgo de método: dos tests usaban `Promise.all` para registrar dos tenants y **el flake apareció ahí**; se hicieron secuenciales (la concurrencia no aportaba nada al caso), pero **no se concluyó causalidad** — otros specs que fallan hoy no usan `Promise.all`.

- [x] **F3-SVC-04** — UI: listado, form y entrada en el menú
  - **Salida:** ruta `/catalog/services` (molde `routes/warehouses.tsx`: listado + form inline + toggle activar/desactivar; **eliminar** con `ConfirmDialog` al estilo products — el diálogo es solo para lo que no tiene vuelta atrás); columnas Código · Nombre · Costo · Precio · Estado; búsqueda por texto; botón «Nuevo servicio» arriba; `lib/services/{api,hooks}.ts`; item **«Servicios»** en el grupo Catálogo de `app-layout.tsx` (después de Productos) gateado por `services:read`, con su `canSeeServicesNav` sumado al `canSeeCatalogNav`; namespace `services.json` es/en + registro en `i18n/index.ts` (4 ediciones: import×2 + resources×2); la barrera de claves usadas-vs-definidas y la anti-voseo vigilan solas
  - **Verificar:** `routes/services.test.tsx` (molde `warehouses.test.tsx`): listado, crear, editar, desactivar, eliminar con confirmación, modo solo-lectura sin `services:manage`, y el nav NO muestra el item sin el permiso
  - **Depende de:** F3-SVC-03
  - **Estimación:** 2.5 h
  - **Hecho:** seis tests de ruta. **Desactivar NO pide confirmación y eliminar SÍ**: es la regla del `ConfirmDialog` aplicada tal cual — el diálogo es solo para lo que no tiene vuelta atrás, y pedirlo para lo reversible entrena a aceptar sin leer. El texto del diálogo nombra desactivar como alternativa. Gotcha encontrado escribiendo los tests: **React Query pasa su contexto como SEGUNDO argumento** al `mutationFn` cuando se le da la función del api directamente (`mutationFn: createService`), así que `toHaveBeenCalledWith(x)` falla y hay que aceptar `expect.anything()`; con un wrapper (`({id, input}) => updateService(id, input)`) no pasa, y por eso el test de desactivar pasaba y el de crear no.

- [x] **F3-SVC-05** — Sincronizar las fuentes de verdad + coherencia F4
  - **Salida:** `VISTAS.md` §6.5 «Servicios» (molde §7 Almacenes: ruta+permiso, mockup del listado y el form, tabla de acciones por rol) + TOC; `CASOS_DE_USO.md` CU-CAT-08 (registrar/editar/desactivar/eliminar servicio, molde CU-ALM-01/02) + fila Servicios en la matriz de permisos + TOC; **outline F4 editado**: `SaleItem` con `product_id` **nullable** + `service_id` nullable + CHECK «exactamente uno» (mismo patrón que los índices parciales de F3), una línea de servicio **no llama** a `StockLedgerService.apply` ni exige presentación ni FEFO, y el Strategy de F4-CART gana `ServiceLookup`; bullet nuevo en «Definición de Fase 3 completa»; entrada de bitácora
  - **Verificar:** el grep de genericidad del cierre de F3 sigue sin resultados de dominio; los tres docs cuentan el mismo diseño
  - **Depende de:** F3-SVC-01..04
  - **Estimación:** 1.5 h
  - **Hecho:** lo que más valía era el **outline de F4**: `SaleItem` pasa a `product_id` nullable + `service_id` nullable con CHECK «exactamente uno», la línea de servicio **no llama al ledger** (una venta de puros servicios no escribe un solo `stock_movement`) y `ServiceLookup` entra al Strategy del carrito. Sin esa edición, F4 se habría atomizado sin poder cobrar trabajo — que es exactamente el hueco que Carlos detectó. VISTAS §6.5 y CU-CAT-08 documentan además la regla desactivar-vs-eliminar y que un servicio vendido dejará de poder borrarse cuando F4 traiga ventas.

> **Extensión del 2026-08-19 (F3-SVC-06..09): servicios POR ALMACÉN.** Carlos definió que el menú Servicios es el catálogo MAESTRO y que cada servicio se asocia a almacenes concretos: en F4 el POS solo ofrece los servicios asociados al almacén del turno (y para productos, solo lo que tenga stock ahí). **Decisiones de Carlos:** (1) semántica EXPLÍCITA — sin almacenes marcados el servicio NO se vende (se le presentó el default permisivo del alcance de usuarios y eligió lo explícito: el checklist ES la disponibilidad); (2) todo vive en el form de alta y edición — NO hay acción «Asignar almacenes» en el listado; (3) checkboxes con seleccionar/deseleccionar todos. **Dos mitigaciones que la hacen operable:** el backfill asocia lo existente a todos los almacenes activos (nada deja de venderse en silencio) y el alta nace con todos marcados (desmarcar es restringir). **Consecuencia documentada:** un almacén nuevo nace sin servicios hasta que alguien los asocie.

- [x] **F3-SVC-06** — Tabla puente `service_warehouses` + RLS de nacimiento + backfill
  - **Salida:** modelo (`serviceId`+`warehouseId` PK compuesta, `tenantId` redundante para la policy sin JOIN, `createdAt`) + relaciones inversas en `Service` y `Warehouse`; UNA migración: CREATE TABLE + FKs CASCADE en las dos patas + índices — incluido **`@@index([warehouseId])`**: la omisión de `user_warehouse_scopes` (sin índice por almacén) NO se copia, porque la query estrella del POS es «servicios de ESTE almacén» — + ENABLE/**FORCE** RLS + policy `tenant_isolation` + **backfill** (servicios existentes → todos los almacenes activos de su tenant); canarios RLS + `ARRAY[...]` del estructural
  - **Verificar:** canarios en verde; el backfill asocia lo existente; un servicio nuevo nace sin filas
  - **Depende de:** F3-SVC-01
  - **Estimación:** 1.5 h
  - **Hecho:** seis canarios, dos más que el molde: uno verifica que **el índice por `warehouse_id` existe** (`pg_indexes`) y otro que el par servicio-almacén no se repite. El del índice no es ceremonia: `user_warehouse_scopes` omitió ese índice y acá la query estrella del POS es la INVERSA —«qué servicios se ofrecen en ESTE almacén»—, así que sin él cada búsqueda del carrito sería un scan. Contrapruebas: quitar el FORCE y dropear el índice ponen en rojo su canario y **solo ese**.

- [x] **F3-SVC-07** — API: `warehouseIds` en create/update (misma tx, sin endpoints nuevos)
  - **Salida:** `createServiceSchema` gana `warehouseIds: z.array(z.uuid()).max(200)` requerido (`[]` válido = no se vende aún); `updateServiceSchema` lo gana `.optional()` — presente = **reemplazo completo** del set (doctrina del repo), ausente = no tocar; como todo vive en el form, viaja en la MISMA tx que el servicio (sin escritura parcial — la ventaja que el alcance de usuarios no tenía); validación molde `WarehouseScopeService.replace`: existen + del tenant + activos → 409 `services.warehouses_invalid` (Set tolera duplicados); `ServiceSummary.warehouseIds`; i18n es/en; el comentario del controller que afirma «el catálogo es del tenant entero» se corrige
  - **Verificar:** e2e: crear con subset; editar reemplaza el set; `[]` válido; 409 almacén ajeno/inactivo; el GET lista los ids
  - **Depende de:** F3-SVC-06
  - **Estimación:** 2 h
  - **Hecho:** ocho e2e nuevos. `warehouseIds` es **requerido en el alta** y no opcional-con-default: con la semántica explícita, olvidarlo crearía un servicio invendible **en silencio**; el contrato obliga a decirlo aunque sea `[]`. Eso rompió los siete tests de F3-SVC-03 que no lo mandaban — se actualizaron, que es lo correcto: el contrato cambió. `ausente ≠ vacío` tiene su propio test (un PATCH que no menciona los almacenes no toca las asociaciones), y las dos contrapruebas muerden.

- [x] **F3-SVC-08** — UI: checklist «Almacenes donde se ofrece» en el form + columna en el listado
  - **Salida:** fieldset en `ServiceForm` (alta Y edición; es useState plano, el checklist entra directo) con checkbox por almacén (molde visual F3-NAV-03) + botón **«Seleccionar todos / Deseleccionar todos»** que alterna según estado; alta con TODOS marcados por defecto; con 0 marcados, leyenda de advertencia visible (el servicio existe pero no se venderá en ningún almacén — estado válido, un servicio en preparación); columna «Almacenes» en el listado con `k de N`; SIN acción nueva en las filas (decisión de Carlos: vive en Editar)
  - **Verificar:** tests de ruta: alta manda todos por defecto; desmarcar restringe; seleccionar/deseleccionar todos alterna; 0 marcados advierte y guarda; edición precarga; columna `k de N`
  - **Depende de:** F3-SVC-07
  - **Estimación:** 2 h
  - **Hecho:** el botón **alterna** según el estado (con todos marcados dice «Deseleccionar todos», con alguno suelto «Seleccionar todos») — dos botones fijos habrían dejado uno siempre inútil. La advertencia de cero almacenes aparece **mientras se edita**, no al guardar: el usuario tiene que saber que dejó el servicio fuera del POS antes de confirmarlo, no después. Gotcha del día, en su forma INVERSA: `updateService` va por un wrapper y por eso **no** recibe el contexto de React Query, mientras que `createService` sí — la misma suite necesita `expect.anything()` en un caso y no en el otro.

- [x] **F3-SVC-09** — Docs + coherencia F4 de la disponibilidad por almacén
  - **Salida:** outline F4: `ServiceLookup` recibe el **almacén del turno** y filtra `isActive` ∩ asociado (sin asociación no aparece); F4-CART: los resultados de PRODUCTO solo ofrecen lo que tiene stock > 0 en el almacén del turno (el ledger revalida al cobrar — defensa en profundidad, como el numpad); VISTAS §6.5 (mockup del form con el checklist; quitar la afirmación de independencia de almacenes); CU-CAT-08 (precondición/postcondición: vendible **en los almacenes asociados** + la nota del almacén nuevo); bullet en «Definición de Fase 3 completa»; línea de estimación de la fase; bitácora
  - **Verificar:** los tres docs cuentan el mismo diseño; el grep de genericidad sigue limpio
  - **Depende de:** F3-SVC-06..08
  - **Estimación:** 1 h
  - **Hecho:** el outline de F4 ya no asume un catálogo plano: **los dos lookups del carrito filtran por el almacén del turno** — un servicio necesita asociación y un producto necesita stock > 0 ahí. Sin esa edición, F4 se habría atomizado con un `ServiceLookup` que ofrece servicios que ese almacén no presta. VISTAS §6.5 y CU-CAT-08 dejaron de afirmar que el catálogo es independiente de los almacenes, y documentan la consecuencia que la semántica explícita deja viva: **un almacén nuevo nace sin servicios** hasta que alguien los asocie.

---

### Módulo F3-HOME — Almacén Asignado del Usuario y Almacén Inicial del Tenant

> Detección de Carlos (2026-08-19), planeando antes del POS: **F4 no sabe de qué almacén salen las ventas**. «El almacén del POS» aparece UNA vez en todo el corpus (VISTAS §9) y nunca se define; `CashboxSession` no tiene campos; CU-SYS-04 (5a) presupone un vínculo POS↔almacén que ningún modelo declara. Se agregan dos cosas: la **ASIGNACIÓN** (`users.default_warehouse_id`, uno solo, nullable) — distinta del **alcance** (lista, dónde *puede*) porque la venta no sale de "una lista", sale de un almacén concreto — y el **nacimiento automático** del primer almacén del tenant. La cadena de F4 queda: `usuario.asignado → turno de caja → venta → ledger`. **Decisiones tomadas y descartadas:** ni renombre de Almacén a Sucursal (el mockup mezcla «Sucursal Sur» con «Bodega Norte» — renombrar convierte la bodega trasera en una sucursal falsa; el nombre lo pone cada negocio en cada almacén) ni entidad Branch nueva (el diseño es plano tenant→almacén, ARQUITECTURA §3.4 ya es «multi-sucursal» sin refactor, F7 monetiza por `max_warehouses`, y una Branch no responde la pregunta del POS — la delega). Clasificación: **SDD LIGERO** (columna + validaciones + wiring con patrones heredados).

- [x] **F3-HOME-01** — `users.default_warehouse_id` + validaciones + coherencia con el alcance
  - **Salida:** columna `default_warehouse_id UUID NULL REFERENCES warehouses(id) ON DELETE RESTRICT` en `users` (migración con **backfill**: usuarios de tenants con exactamente UN almacén → ese; el resto null); `createUserSchema`/`updateUserSchema` ganan `defaultWarehouseId: z.uuid().nullish()` — a diferencia del scope, una COLUMNA viaja en el mismo `tx.user.create`, sin escritura parcial; validación al asignar: existe + del tenant + `isActive` + **∈ alcance cuando el alcance no está vacío** → 409 `users.default_warehouse_out_of_scope`; `WarehouseScopeService.replace` gana el 409 espejo si el nuevo set no vacío excluye el asignado (NO auto-limpiar: en F4 el turno depende de él y limpiarlo en silencio dejaría al vendedor varado — el mensaje dice qué reasignar primero); desactivar un almacén NO gana guarda: los consumidores ignoran un asignado inactivo (`?scoped=true` ya lista solo activos); `UserDetail` y `GET /auth/me` lo exponen; i18n API es/en
  - **Verificar:** e2e: asignar; 409 fuera de alcance; 409 al encoger el alcance; el backfill puebla al tenant mono-almacén y deja null al multi
  - **Depende de:** —
  - **Estimación:** 2 h
  - **Hecho:** nueve e2e. La validación vive en UN helper (`assertAssignableWarehouse`) que recibe el alcance explícito, porque los dos llamadores lo conocen distinto: al **crear** no hay alcance todavía (lista vacía = sin restricción), al **editar** hay que leerlo. Las tres contrapruebas muerden: sin la regla de pertenencia, sin validar tenant/activo, y auto-limpiando el asignado en vez del 409.

- [x] **F3-HOME-02** — UI: selector «Almacén asignado» en `UserForm`
  - **Salida:** `SelectField` en alta Y edición (molde F3-NAV-03, que ya montó la sección de almacenes; en el alta SÍ viaja en el POST porque es columna); preselección: único almacén del tenant, si no el asignado del creador; opción «Sin asignar» con leyenda de qué implica para el POS; las opciones fuera del alcance marcado se deshabilitan (mismo criterio derivado-de-lo-marcado-ahora de F3-NAV-03)
  - **Verificar:** `system-users.test.tsx` (molde de los 6 tests de F3-NAV-03): viaja en el alta, se edita, respeta el alcance, «sin asignar» es válido
  - **Depende de:** F3-HOME-01
  - **Estimación:** 1.5 h
  - **Hecho:** el PATCH manda el asignado **solo si cambió** — mandarlo siempre reescribía un campo que nadie tocó y rompió tres tests existentes que afirmaban el payload exacto; esos tests hicieron de guardarraíl. `SelectOption` ganó `disabled` (compartido) para mostrar los almacenes fuera del alcance en vez de esconderlos: la lista se ve **acotada**, no incompleta. Y el gotcha de React Query —contexto como 2º argumento del `mutationFn`— mordió por **segunda vez hoy**; el propio repo ya lo tenía documentado en `movements-documents.test.tsx` y no lo busqué.

- [x] **F3-HOME-03** — El tenant nace con almacén: `provision()` + onboarding + seed
  - **Salida:** `tenants.service.provision()` crea el almacén inicial («Almacén Central» / «Main Warehouse» según `locale` del owner — neutro por LEY: un distribuidor lo renombra a CEDIS en un clic) **en la misma tx** del alta del tenant y asigna `default_warehouse_id` al owner; `step-warehouse.tsx` pasa de crear a **renombrar-o-continuar** (input precargado con el nombre actual, PATCH solo si cambió); `steps.ts` sin cambios (`hasWarehouse` ya será true); el seed demo gana su almacén (hoy está `onboarded` ¡sin ninguno!); nunca vuelve a existir el estado "tenant sin almacén"
  - **Verificar:** e2e de registro: el tenant nuevo tiene 1 almacén con el nombre del locale y el owner lo tiene asignado; test del paso 3: renombra sin crear otro
  - **Depende de:** F3-HOME-01
  - **Estimación:** 2 h
  - **Hecho:** el paso 3 del onboarding pasó de **crear** a **renombrar**: el input llega precargado y solo manda PATCH si el nombre cambió. **Hallazgo colateral: el seed estaba roto** — `user.upsert` usaba `tenantId_email`, un unique compuesto que NO existe (el de email es un índice FUNCIONAL sobre `lower(email)`, como dice el propio comentario del schema). Llevaba roto desde que ese índice se volvió funcional y nadie lo notó porque `db seed` solo corre a mano en dev. Se arregló con findFirst + ramificar, y de paso el tenant demo dejó de estar `onboarded` sin un solo almacén — un estado que ningún tenant real puede alcanzar. **Un seed que produce estados imposibles es un seed que miente.**

- [x] **F3-HOME-04** — Preselección operativa en movimientos
  - **Salida:** el store de auth del front conserva `defaultWarehouseId` (de `/auth/me`); `document-list.tsx` (entradas/salidas/conteos) inicializa su `warehouseId` con el asignado **si está entre las opciones scoped** — la auto-selección de único-almacén de `WarehouseSelect` (F3-NAV-01) queda como fallback; sin persistencia extra: la preferencia ES el asignado
  - **Verificar:** tests de ruta: con asignado se preselecciona; con asignado fuera del scope o inactivo, comportamiento actual; sin asignado, comportamiento actual
  - **Depende de:** F3-HOME-01
  - **Estimación:** 1.5 h
  - **Hecho:** la preselección terminó dentro de **`WarehouseSelect`**, no del listado. La primera versión inicializaba el estado del listado con el asignado a ciegas y **un test propio cazó el bug**: un asignado fuera de alcance o desactivado habría mandado al API un almacén que rechaza. La decisión vive donde está la lista de opciones, y compone con el auto-select de "hay uno solo" de F3-NAV-01 en vez de competir con él.

- [x] **F3-HOME-05** — Sincronía de docs + coherencia F4
  - **Salida:** outline F4 editado: `CashboxSession` gana `warehouse_id NOT NULL` + `opened_by`, abrir turno **prefiere el asignado** del usuario (cambiable dentro de su alcance), `Sale.warehouse_id` hereda del turno y es lo que recibe `StockLedgerService.apply`; CU-SYS-04 5a deja de ser aspiracional (perder el alcance del almacén del turno → 403 real); ARQUITECTURA §3.4 gana el párrafo asignación-vs-alcance; VISTAS (form de usuario + la barra del POS muestra el almacén del turno); CASOS_DE_USO matriz + CU-SYS-04 actualizado; bullet en «Definición de Fase 3 completa»; entrada de bitácora
  - **Verificar:** los cuatro docs cuentan el mismo diseño; el grep de genericidad sigue limpio
  - **Depende de:** F3-HOME-01..04
  - **Estimación:** 1.5 h
  - **Hecho:** lo que más valía era cerrar el hueco de F4: `CashboxSession` gana `warehouse_id` NOT NULL y `opened_by`, el turno **prefiere el asignado** (cambiable dentro del alcance) y `Sale.warehouse_id` lo hereda. La frase «el almacén del POS» aparecía UNA vez en todo el corpus (VISTAS §9) sin definirse en ningún lado; ahora la cadena `usuario.asignado → turno → venta → ledger` está escrita antes de atomizar la fase.

---

### ✅ Definición de "Fase 3 completa"

- [x] Un Manager registra una **entrada** por factura con presentación (cajas → base_unit), costo unitario y referencia; el saldo del almacén sube y el movimiento aparece en el kardex con su presentación
- [x] Una **salida** por más de lo disponible falla con `{ sku, available, requested }` y no toca el saldo; dos salidas concurrentes nunca dejan stock negativo (`stock-ledger.integration.spec.ts`)
- [x] Salida por consumo de un **compuesto** descuenta sus componentes (anidados incluidos) y ningún compuesto tiene fila en `stock_by_warehouse`; entrada de compuesto → 409
- [x] Un **traspaso** completo: despacho como Salida con motivo Traspaso (folio `SAL-000019`, origen baja, `in_transit`) → visible en "Pendientes de recibir" del destino y "Pendientes de enviar" del origen → «Confirmar recepción» abre un borrador de Entrada precargado (`ENT-000043`) → se corrige el faltante con su nota → `completed`, destino sube lo recibido, diferencia derivada y auditada; recibido > enviado bloqueado; cancelación solo TenantAdmin con justificación y **sin** devolver stock; badge > 7 días
- [x] **Inventario físico**: plantilla SKU + teórico → planilla contada → reconciliación con resumen → aprobación (solo `inventory:manage`) genera salida del teórico + entrada del contado por línea con diferencia y audita el drift si algo se movió en el medio
- [x] **Kardex** del producto con filtros y `balanceAfter` correcto por almacén **y en orden estable dentro de un mismo lote de movimientos** (`seq`), y tab **Stock por almacén** con total, bajo mínimo, en tránsito y desglose por lote — ambos respetando el scope del usuario (Manager con scope [A] no ve B)
- [x] **Lotes opt-in y FEFO**: un producto con `tracks_lots` exige lote y caducidad al entrar y **sale primero el que vence antes** (el ejemplo de Carlos: st30/st10/st60 → una venta baja st10 a 9); un producto sin `tracks_lots` nunca ve un lote; `Σ stock_lots == stock_by_warehouse` tras N movimientos aleatorios (test de propiedad); el conteo por planilla trae **una fila por lote y ubicación** y crea lotes nuevos; apagar `tracks_lots` con saldo en lote → 409; la vista "Próximos a vencer" lista y permite dar salida por caducado
- [x] **Todo movimiento es un documento con folio**, en **tres** series por tenant: una entrada da `ENT-000001`, una salida `SAL-000001` y un conteo `INV-000001`; un traspaso es una `SAL` con motivo Traspaso y su recepción una `ENT` con el mismo motivo (**no** hay serie propia para ellos); las tres avanzan independientes, dos tenants arrancan las suyas en 1
- [x] **Un movimiento a medio cargar se retoma por su folio**: se cargan 40 productos, se cierra el navegador (o lo agarra otro usuario en otra máquina), se busca `SAL-000019` en el listado de Salidas y se sigue donde quedó; el stock **no se movió** en el medio; el borrador abandonado queda **anulado con su folio** y la serie no pierde números
- [x] **Lo confirmado es intocable**: un UPDATE sobre un documento `confirmed` falla en la base (trigger), confirmar dos veces el mismo borrador da 409 y **no duplica el saldo**, y un confirmado nunca vuelve a borrador
- [x] **El borrador es la vista previa**: su detalle muestra **stock actual → stock resultante** por línea, los lotes que se crearían, el disponible y **de qué lote saldría por FEFO**, con los errores sobre su fila — todo sin escribir nada
- [x] **PDF firmable**: cualquier documento se baja en PDF con el negocio, el folio, sus líneas y las firmas Entregó / Recibió / Autorizó; el de un borrador sale marcado **BORRADOR**; uno de 300 líneas sale paginado con el encabezado repetido; se encuentra después por folio en el listado de su serie y se vuelve a bajar
- [x] `stock_movements` es append-only por privilegios (UPDATE/DELETE como `sellpoint_app` fallan) y las 7 tablas nuevas pasan los 4 canarios RLS
- [x] **Propiedad de reconciliación**: tras N movimientos aleatorios, `stock_by_warehouse.quantity == Σentradas − Σsalidas` por (producto, almacén) (test de integración)
- [x] Las guardas heredadas cerradas: presentación con movimientos no se borra, producto con movimientos no se borra ni cambia base_unit, almacén con stock o traspaso abierto no se desactiva, tenant con movimientos no cambia currency, `availability` respeta scope
- [x] El alcance por almacén se asigna desde el form de usuario y `GET /warehouses?scoped=true` lo refleja en todos los selectores
- [x] Un tenant nuevo **nace con su almacén** («Almacén Central»/«Main Warehouse» según idioma) asignado al owner, y el paso 3 del onboarding lo **renombra** en vez de crear otro; un usuario con almacén asignado ve ese almacén **preseleccionado** en entradas, salidas y conteos; encoger su alcance por debajo del asignado da 409 y NO lo limpia solo
- [x] Un **servicio** se registra con código, costo y precio; el mismo código en otro tenant es legal; desactivar lo esconde y eliminar pide confirmación; y **nunca aparece** en entradas, salidas, conteos ni kardex
- [x] Un servicio declara **en qué almacenes se ofrece**: el alta nace con todos marcados, desmarcar restringe, cero marcados avisa que no se venderá en ninguno (estado válido), y un almacén ajeno o desactivado da 409; el listado dice `k de N`
- [x] **Genericidad verificable:** `rg -i "pharmacy|farmacia|cafeteria|hardware|grocery|receta|ingredient|porci[oó]n|production" apps/api/src apps/api/prisma/schema.prisma apps/web/src packages/shared/src` sin resultados de dominio (se toleran solo comentarios que citan la LEY para explicar qué NO existe). Lote, caducidad y ubicación **sí** existen y son genéricos — lo que la LEY prohíbe son campos de rubro, no dimensiones del stock; y son opt-in por producto
- [x] `REASONS_BY_DIRECTION` de shared, el enum Prisma y el CHECK SQL coinciden (test de contrato verde)
- [x] Suites verdes (api unit+integration+e2e, web, shared) + tsc (`typecheck:full`) + Biome + deploy verde
- [x] Tag `v0.4.0-fase3` creado sobre `38661b7` — el commit cuyo Deploy cerró VERDE y verificado en el log, no en la insignia (precedente de F2: el tag fue a `3d5af37` y no al commit obvio justamente porque el de aquel quedó en rojo)

> **Ejecutado criterio por criterio el 2026-08-20** (no leído — el precedente de F1/F2 exige correrlo). **Tres salieron falsos o sin verificar y se corrigieron antes de marcarlos:**
> 1. **RLS de las tablas nuevas:** `product_lots` y `stock_lots` tenían el test ESTRUCTURAL en `lots-schema` pero **no los 4 canarios de comportamiento**. Agregados a `f3-rls.integration.spec.ts` (array y `ARRAY[...]` del estructural, los dos, que están duplicados a propósito). Contraprueba: borrar la policy de `stock_lots` pone los 10 tests en rojo.
> 2. **PDF paginado:** `headerRows: 1` estaba implementado y **ningún test lo afirmaba** — de la hoja 2 en adelante habría números sin encabezado y nadie se enteraría. Test nuevo con 300 líneas; muerde al ponerlo en 0.
> 3. **Genericidad:** `sinRecetaId`/`sinReceta` sobrevivían en `composition-expander.integration.spec.ts` — el vocabulario exacto que la LEY prohíbe y que F3-GUARDS-02 había limpiado del service. Renombrado a `sinComposicion`.
>
> **Un hit del grep de genericidad queda como decisión consciente, no como omisión:** `"referenceConsumptionPlaceholder": "Limpieza, producción, mantenimiento…"`. El grep incluye `production` para cazar un **campo** `production` en compuestos (lo que el propio schema declara que no existe); acá es una palabra de ejemplo en un placeholder de motivos de consumo, genérica para cualquier negocio. Pasa el espíritu de la LEY y matchea la letra del grep. **No se tocó el criterio para que pasara** — mover la portería habría sido peor que el hit.
>
> **Evidencia de las suites:** 683 unit+integration API · 444 e2e · 629 web · `typecheck:full` 3/3 · Biome limpio · deploy verde en `c7661cd`. Los rojos intermitentes del e2e son el flake documentado (`topic_key: sellpoint/e2e-flake-diagnostico`): se aislaron los specs señalados y pasan 33/33 y 52/52 corridos solos, tres veces seguidas.

**Estimación: 5-6 semanas** (~153.5 h en 71 tareas — eran 57 y ~131 h hasta que el 2026-08-19 entraron F3-SVC, F3-HOME y la extensión de servicios por almacén, ver la bitácora). El outline original decía 2-3 semanas y no contaba kardex con saldo, stock por almacén, el conteo completo ni las guardas heredadas; después entraron los **lotes con FEFO** (2026-08-17, sobre un Excel real de cliente) y los **documentos con folio, borrador retomable y PDF** (2026-08-18). El alcance creció las tres veces por evidencia concreta, no por especulación. Nótese que la **re-atomización con borradores dejó MENOS tareas que la versión anterior** (57 contra 62) y casi las mismas horas: al volver el traspaso a ser una salida con motivo y el borrador a ser la previa, desaparecieron cuatro tareas de previa stateless y las de UI se concentraron en una maquinaria compartida. Corregir el modelo salió más barato que parchearlo.

---

## Fase 4 — POS PWA + Cotización

> **Atomizada el 2026-08-20** (era outline). **Hereda de F3:** el enum `reason_code` ya trae `sale` y `sale_return` en el CHECK y en `REASONS_BY_DIRECTION` — **F4 no toca el schema para vender**; la venta **NO escribe `stock_movements` propios**, llama a `StockLedgerService.apply(tx, …)` con `reason='sale'` (`sale_return` para la anulación; `customer_return` queda para la devolución manual sin venta); **FEFO viene gratis** (F3-CORE-08) y la expansión de compuestos también (`composition-expander`); una línea de **SERVICIO no toca el ledger**; el folio sale de `nextFolio` sobre `tenant_sequences` con el gotcha del lock ya medido (`folio.ts`); la cadena del almacén es `usuario.asignado → turno → venta → ledger` (F3-HOME); los lookups filtran por el **almacén del turno** (productos con stock > 0, servicios asociados en `service_warehouses` — F3-SVC).
>
> **La COTIZACIÓN se adelanta desde Fase 9** (era F9-QUOTE-*; `Sale.quote_id` y `QuoteLookup` ya estaban reservados — la previsión se cobra ahora). Decisiones de Carlos (2026-08-20): **(1)** permiso propio **`pos:quote`** — la recepción cotiza sin poder cobrar, y el médico de F9 tendrá `pos:quote` sin caja; **(2)** la cotización **NO exige turno de caja** — no toca dinero ni stock, filtra por el almacén ASIGNADO del cotizador; **(3)** **NO congela precios ni maneja vigencia** — los precios impresos son de referencia y **al cargarla en el POS se recalculan con el catálogo vigente**, así que no hay estados `expired` ni promesas de precio que administrar.
>
> Clasificación: **F4-DB, F4-CASHBOX, F4-SALE, F4-QUOTE, F4-CART = SDD COMPLETO** (dinero, stock y concurrencia); **F4-UI, F4-TICKET, F4-PWA, F4-DOCS = SDD LIGERO** (caras sobre maquinaria ya probada).

### Módulo F4-DB — Modelos de venta, caja y cotización

- [x] **F4-DB-01** — Modelos `Sale`, `SaleItem`, `CashboxSession` + RLS de nacimiento
  - **Salida:** `CashboxSession` (`warehouse_id` NOT NULL, `opened_by`, `opened_at`, `closed_at?`, totales declarados al cierre); `Sale` (`folio`, `warehouse_id` heredado del turno, `cashbox_session_id`, `quote_id` **nullable FK activa**, `clinical_document_id` nullable SIN tabla — reservada F9, solo la columna, `status` completed|canceled, `payment_method`, totales, `created_by`, `canceled_by/at`); `SaleItem` (`product_id` nullable + `service_id` nullable + **CHECK «exactamente uno»**, `presentation_id` nullable solo-producto, `quantity` DECIMAL(14,4), `unit_price`/`discount`/`line_total` DECIMAL(14,2)); **FK `sale_items.service_id` → RESTRICT** (cierra el `TODO(F4)` de `services.remove`: la guarda 409 `services.has_sales` llega en F4-SALE-01); UNA migración con ENABLE/FORCE/policy; canarios + `ARRAY[...]` del estructural
  - **Verificar:** canarios en verde; el CHECK rechaza 0 y 2 referencias; FORCE en `pg_class`
  - **Depende de:** —
  - **Estimación:** 2.5 h

- [x] **F4-DB-02** — Modelos `Quote`, `QuoteLine` + RLS de nacimiento
  - **Salida:** `Quote` (`folio` COT, `warehouse_id` NOT NULL — el almacén del COTIZADOR, para filtrar sus lookups y para reporte, `status` open|loaded|canceled, `created_by`, totales de referencia); `QuoteLine` (mismo shape que `SaleItem`: producto O servicio con CHECK, `quantity`, `unit_price` **de referencia** — el precio real se recalcula al cargar); sin FK al ledger ni a `inventory_documents`: una cotización NO mueve stock por diseño; RLS de nacimiento + canarios
  - **Verificar:** canarios; el CHECK; una cotización no puede referenciar movimientos
  - **Depende de:** —
  - **Estimación:** 2 h

- [x] **F4-DB-03** — Series `VTA`/`COT` + permisos `pos:quote` y `pos:view`
  - **Salida:** `FOLIO_PREFIXES` de shared gana las series de venta y cotización (los dos tests de contrato que afirman «son exactamente tres» y «`VTA` no la usa nadie» se actualizan — son guardarraíles haciendo su trabajo, no estorbos); migración de permisos molde `f2_permissions`: **`pos:quote`** (cotizar sin cobrar — recepción hoy, médico en F9) y **`pos:view`** (historial de ventas — VISTAS §9.3 lo exigía y NO existía en el catálogo: el permiso fantasma se resuelve acá, no se hereda); `POS_SELLER_CODES` gana los dos; `role-catalog.spec.ts` con el bloque nuevo; gotcha del perm-epoch anotado
  - **Verificar:** spec del catálogo de roles; e2e 403 sin permiso; los tests de shared en verde con las series nuevas
  - **Depende de:** —
  - **Estimación:** 1.5 h

### Módulo F4-CASHBOX — El turno de caja

- [x] **F4-CASHBOX-01** — Abrir turno y consultar el actual
  - **Salida:** `POST /pos/session` (permiso `pos:sell`): `warehouseId` opcional — default el **asignado** del usuario (F3-HOME), validado existe/tenant/activo/dentro-del-alcance; guarda de **UN turno abierto por usuario** → 409 `pos.session_already_open`; `GET /pos/session` devuelve el turno actual (`sessionId`, `warehouseId`, `openedAt`) o 404; sin turno abierto, vender da 409 `pos.no_session`
  - **Verificar:** e2e: abre con el asignado por default; almacén fuera de alcance → 409; segundo turno → 409; vender sin turno → 409
  - **Depende de:** F4-DB-01
  - **Estimación:** 2 h

- [x] **F4-CASHBOX-02** — Cierre de caja con arqueo
  - **Salida:** `POST /pos/session/close`: totales POR MÉTODO calculados de las ventas del turno (las anuladas no suman), el cajero declara lo contado y el sistema guarda **declarado, calculado y diferencia** — la diferencia se registra, no se bloquea (cuadrar caja es tarea humana, esconder el descuadre sería peor); un turno cerrado no acepta ventas
  - **Verificar:** e2e: totales correctos por método; venta anulada no suma; vender sobre turno cerrado → 409; la diferencia queda guardada
  - **Depende de:** F4-CASHBOX-01, F4-SALE-01
  - **Estimación:** 2 h

- [x] **F4-CASHBOX-03** — UI del turno
  - **Salida:** pantalla de apertura (selector de almacén precargado con el asignado, molde `WarehouseSelect`); la barra del POS muestra **el almacén del turno** (deuda de F3-HOME-05 sobre VISTAS §9.1); pantalla de cierre con los totales por método y el campo de arqueo; sin turno abierto, `/pos` ofrece abrirlo
  - **Verificar:** tests de ruta: apertura preselecciona el asignado; la barra muestra el almacén; cierre pinta calculado vs declarado
  - **Depende de:** F4-CASHBOX-01, F4-CASHBOX-02
  - **Estimación:** 2.5 h

### Módulo F4-SALE — La venta como llamador del ledger

- [x] **F4-SALE-01** — `SalesService.create`: la transacción del cobro
  - **Salida:** `POST /pos/sales` (`pos:sell`, turno abierto): UNA transacción — folio `VTA` (dentro de la misma tx: el posteo de una venta es corto y el lock de milisegundos, medido en el e2e de concurrencia), `Sale`+`SaleItem`s, líneas de producto → `StockLedgerService.apply(reason='sale')` con compuestos expandidos por el expander de F3 (falla entera si un componente no alcanza, con qué falta), líneas de servicio sin ledger; **los precios se toman del catálogo server-side** — el front manda ids y cantidades, nunca precios; la guarda 409 `services.has_sales` entra a `services.remove` (la FK RESTRICT ya la puso F4-DB-01); `TenantTransactionsGate` suma `tx.sale.count()` (cierra su `TODO(F4)`)
  - **Verificar:** e2e: venta mixta producto+servicio+compuesto descuenta lo correcto y solo eso; sin stock → 409 con el detalle; dos ventas concurrentes del último ítem: una pasa, la otra 409; borrar un servicio vendido → 409; el gate congela la moneda con una venta y cero movimientos
  - **Depende de:** F4-DB-01, F4-DB-03, F4-CASHBOX-01
  - **Estimación:** 3 h

- [x] **F4-SALE-02** — `Idempotency-Key` en el checkout
  - **Salida:** header `Idempotency-Key` en `POST /pos/sales`: la clave se guarda con la venta (unique por tenant); repetirla devuelve **la misma venta** (200, no 409) sin tocar stock — el doble tap del cajero sobre un botón lento no duplica nada; sin header, comportamiento actual (la clave es opcional: la manda el front del POS); cierra la deuda anotada en F3
  - **Verificar:** e2e: dos POST con la misma clave → una sola venta y el stock descontado UNA vez; claves distintas → dos ventas
  - **Depende de:** F4-SALE-01
  - **Estimación:** 2 h

- [x] **F4-SALE-03** — Anulación por `sale_return`
  - **Salida:** `POST /pos/sales/:id/cancel` (TenantAdmin/Manager — el cajero NO anula): reverso vía `apply(reason='sale_return')` que re-ingresa componentes de compuestos y productos simples (los servicios no tienen qué devolver), `status` canceled, justificación obligatoria, auditado; una venta anulada no se anula dos veces (409) y no se edita
  - **Verificar:** e2e: anular restaura el stock exacto (compuesto incluido); doble anulación → 409; POS_Seller → 403
  - **Depende de:** F4-SALE-01
  - **Estimación:** 2.5 h

- [x] **F4-SALE-04** — Historial de ventas
  - **Salida:** `GET /pos/sales` (permiso `pos:view`): filtros por fecha/vendedor/turno, paginación server-side, detalle con líneas; las anuladas se ven marcadas, no desaparecen
  - **Verificar:** e2e: filtros; una venta de otro tenant no existe; sin `pos:view` → 403
  - **Depende de:** F4-SALE-01
  - **Estimación:** 1.5 h

### Módulo F4-QUOTE — Cotización (adelantado de F9)

- [x] **F4-QUOTE-01** — API de cotización: crear, listar, cancelar
  - **Salida:** `POST /pos/quotes` (**`pos:quote`**, SIN turno): almacén = el asignado del cotizador (o elegido dentro de su alcance), folio `COT` en la tx de creación, líneas producto/servicio con **precio de referencia** tomado del catálogo server-side; `GET /pos/quotes` (lista con búsqueda por folio) y `GET /pos/quotes/:id`; `POST /pos/quotes/:id/cancel`; una cotización NO escribe un solo `stock_movement` ni exige caja — es una lista con folio, no una operación
  - **Verificar:** e2e: cotizar sin turno abierto funciona; folio `COT-000001` y la serie avanza; el stock NO cambió; sin `pos:quote` → 403; aislamiento entre tenants; **un producto cuyo único stock está vencido NO se puede cotizar**
  - **Depende de:** F4-DB-02, F4-DB-03
  - **Estimación:** 2.5 h
  - **Hereda una regla del ledger (2026-08-20):** "no puedes vender un producto vencido, y por ahora sólo se bloquea para venta y cotización" (Carlos). La VENTA ya está cubierta desde F3: `REASONS_REJECTING_EXPIRED_LOTS` en `@sellpoint/shared` hace que FEFO no elija un lote caducado y que el resolver rechace uno elegido a mano. La COTIZACIÓN **no pasa por ahí** —no genera movimiento de inventario, así que no tiene `reason_code`—, de modo que su bloqueo hay que ponerlo en la disponibilidad que consulta esta tarea. Es el único lado de la regla que F3 no pudo cerrar.

- [x] **F4-QUOTE-02** — Cargar la cotización en la venta: el recálculo
  - **Salida:** `GET /pos/quotes/folio/:folio/for-sale` (**`pos:sell`**, turno abierto): devuelve las líneas con **precios RECALCULADOS del catálogo vigente** (decisión de Carlos: la cotización no congela precios) y la **disponibilidad contra el almacén del TURNO** — faltantes y servicios no ofrecidos ahí vienen marcados, no escondidos; al cobrar, `Sale.quote_id` se vincula y la quote pasa a `loaded`; una `loaded` o `canceled` no se carga de nuevo (409)
  - **Verificar:** e2e: precio cambiado entre cotizar y cargar → la venta usa el nuevo; producto sin stock en el almacén del turno viene marcado; doble carga → 409; el vínculo `quote_id` queda en la venta
  - **Depende de:** F4-QUOTE-01, F4-SALE-01
  - **Estimación:** 2 h

- [x] **F4-QUOTE-03** — UI de cotización + menú
  - **Salida:** item **«Cotización»** en el grupo POS del nav (gateado por `pos:quote`); pantalla `/pos/quotes/new` con **la misma maquinaria del carrito** (búsqueda, cantidades, presentaciones) pero sin cobro — el botón es «Generar cotización» y emite el ticket COT; listado `/pos/quotes` con búsqueda por folio y estado; namespace i18n
  - **Verificar:** tests de ruta: generar manda las líneas y pinta el folio; sin `pos:quote` el menú no aparece; el listado filtra por folio
  - **Choque de diseño resuelto al construir (2026-08-21):** cotizar NO exige turno, pero `GET /pos/lookup` sí lo exigía (409) — la pantalla de cotización no habría podido buscar nada. Se resolvió de forma ADITIVA: el lookup acepta un `warehouseId` explícito y lo usa **solo cuando no hay turno**; con turno, el turno gana. Dejar que un query param moviera el almacén de una venta en curso sería cobrar de una bodega y descontar de otra. Al agregarlo apareció un agujero: `assertWarehouseInScope` con alcance `all` acepta CUALQUIER uuid, así que un almacén de otro tenant devolvía 200 con lista vacía — hacen falta las DOS guardas, y `assertActiveWarehouse` es la que contesta 404. Lo cazó el e2e
  - **Depende de:** F4-QUOTE-01, F4-CART-02
  - **Estimación:** 2.5 h

- [x] **F4-QUOTE-04** — `QuoteLookup`: el folio COT en el input del POS
  - **Salida:** el input principal del carrito acepta un folio `COT-…` (la strategy `QuoteLookup` de F4-CART-01): modal de confirmación con las líneas, los **precios nuevos** y los faltantes marcados; confirmar vuelca al carrito y recuerda el `quoteId` para el vínculo al cobrar — el flujo completo de la recepción: cotizan adelante, el cliente pasa a caja con su folio y nadie recaptura
  - **Verificar:** tests de ruta: folio válido abre el modal; faltante marcado; confirmar carga el carrito; folio `loaded` → error visible
  - **Depende de:** F4-QUOTE-02, F4-CART-01
  - **Estimación:** 2 h

### Módulo F4-CART — El carrito y sus lookups

- [x] **F4-CART-01** — El strategy de lookups, filtrado por el almacén del turno
  - **Salida:** `GET /pos/lookup?q=` (server-side): `SkuLookup`, `BarcodeLookup` (sobre `product_presentations.barcode` — matchea presentación), `TextSearchLookup`, `ServiceLookup` y `QuoteLookup` (detecta el patrón `COT-`); **todo filtrado por el almacén del turno**: productos con stock > 0 ahí, servicios `is_active` ∩ asociados en `service_warehouses` (el índice por `warehouse_id` de F3-SVC-06 es para esta query); extensible: `PrescriptionLookup` de F9 es una strategy más
  - **Verificar:** e2e: barcode de presentación gana al legacy; servicio no asociado al almacén del turno NO aparece; producto sin stock ahí NO aparece; `COT-000001` resuelve a la cotización
  - **Verificar además:** un almacén nuevo nace SIN servicios (bitácora 2026-08-19) — `ServiceLookup` en un turno abierto ahí no ofrece ninguno, sin error
  - **Corregido al construir (2026-08-21):** el respaldo contra `products.barcode` "legacy" **no se implementó porque esa columna nunca existió** — el código de barras nació en la presentación con F2-PRESENT y ahí se quedó. Un catálogo con códigos alfanuméricos igual se encuentra: cae en `TextSearchLookup`, que también mira `barcode`
  - **Depende de:** F4-CASHBOX-01
  - **Estimación:** 3 h

- [x] **F4-CART-02** — El carrito (Zustand)
  - **Salida:** store del carrito: agregar/quitar/cantidades, línea de producto con **selector de presentación inline** (`is_default_sale` preseleccionada, molde del selector de F3), línea de servicio sin presentación, compuesto con stock visible `min(stock_componente/qty)`, totales derivados; el store es la única fuente del carrito — la venta manda ids y cantidades, nunca precios
  - **Verificar:** tests: totales; presentación default; compuesto muestra lo armable; quitar línea
  - **Nota (2026-08-21):** las cantidades del carrito se muestran con `formatQuantity()` de `@sellpoint/shared` — piezas sin decimales, pesos/volúmenes con 3; la regla vive en la unidad, no en la pantalla
  - **Depende de:** F4-CART-01
  - **Estimación:** 2.5 h

- [x] **F4-CART-03** — Numpad inteligente
  - **Salida:** numpad que oculta el `.` cuando la presentación tiene `allow_fractional_input = false`; paste/teclado con decimales en presentación entera → trunca y muestra hint («Solo enteros»); el backend revalida igual (defensa en profundidad, no la única red)
  - **Verificar:** tests: el punto desaparece con presentación entera; paste truncado con hint
  - **Depende de:** F4-CART-02
  - **Estimación:** 1.5 h

- [x] **F4-CART-04** — Escáner de cámara
  - **Salida:** `@zxing/browser` sobre el input principal: el barcode escaneado entra por el mismo `BarcodeLookup` que el teclado — el escáner es un teclado rápido, no otro camino; degrada con gracia sin cámara/permiso
  - **Verificar:** tests: el resultado del scan dispara el lookup; sin permiso de cámara, la búsqueda manual sigue viva
  - **Depende de:** F4-CART-01
  - **Estimación:** 2 h

### Módulo F4-UI — Las pantallas del POS

- [x] **F4-UI-01** — Pantalla principal de venta (`/pos`)
  - **Salida:** layout para tablet: carrito + input principal + numpad, targets táctiles grandes; estados vacío/sin-turno/cargando; los errores del server caen sobre su línea (molde F3-DOC-09)
  - **Verificar:** tests de ruta: flujo agregar → ajustar → listo para cobrar; sin turno ofrece abrirlo
  - **Depende de:** F4-CART-02, F4-CASHBOX-03
  - **Estimación:** 3 h

- [x] **F4-UI-02** — Modal de cobro
  - **Salida:** métodos efectivo/tarjeta/transferencia; con efectivo, monto recibido y **vuelto calculado**; manda `Idempotency-Key` generada al abrir el modal (el doble tap ya no duplica); el 409 de stock concurrente cae sobre el modal con la línea culpable — nunca se traga (lección del confirm mudo de F3)
  - **Verificar:** tests: vuelto; doble click en Cobrar → un solo POST; el 409 se pinta
  - **Corregido al construir (2026-08-21):** son **422**, no 409 — el ledger tira `UnprocessableEntityException` para el stock insuficiente, el mismo código que usa todo el inventario desde F3. Y para que el rechazo cayera sobre SU renglón hubo que mandar el `sku` culpable FUERA de `args`: el filtro consume `args` para traducir y lo DESCARTA, así que un dato de ruteo no podía viajar ahí. Ese pasaje era un accidente del `{ args, ...rest }` y ahora tiene test propio en `all-exceptions.filter.spec.ts`
  - **Depende de:** F4-UI-01, F4-SALE-02
  - **Estimación:** 2 h

- [x] **F4-UI-03** — Grupo POS en el nav + historial
  - **Salida:** grupo «Punto de venta» en el nav: `/pos` (`pos:sell`), `/pos/quotes` (`pos:quote`), `/pos/sales` historial (`pos:view`) con reimprimir y anular (gateado por rol); rutas + i18n namespace `pos` es/en; cada item gateado por SU permiso (regla del nav de F2)
  - **Verificar:** tests: el nav muestra solo lo permitido; historial lista y reimprime
  - **Ajustado al construir (2026-08-21):** el item **«Cotización» NO entra acá** — apuntaría a una ruta que todavía no existe y sería un link muerto; llega con su pantalla en F4-QUOTE-03, que ya lo tiene en su Salida. La **reimpresión** también queda para F4-TICKET-02: no hay ticket que reimprimir hasta que exista la plantilla. Lo que sí cerró es el agujero real: `pos:cancel` existía en el API desde F4-SALE-03 y **ninguna persona podía llegar a él** — una venta cobrada mal solo se arreglaba con `curl`
  - **Depende de:** F4-SALE-04
  - **Estimación:** 1.5 h

### Módulo F4-TICKET — El papel

> **La verificación de punta a punta se hace ACÁ** (decisión de Carlos, 2026-08-21). Al 21/08 el POS está completo y desplegado, pero **nunca se completó una venta real**: cada pieza se verificó por separado —el buscador descontando lotes vencidos contra datos reales, el turno, el carrito, el nav— y la cadena entera (buscar → agregar → cobrar → verla en el historial → anularla → ver el stock volver) sigue sin correr contra la base de producción.
>
> No se hizo antes por un motivo concreto: **esa venta se lleva el folio `VTA-000001`**, el primer número de venta del negocio, y los folios no tienen huecos por diseño — todo número emitido se puede explicar, así que no hay forma de devolverlo. Se decidió gastarlo UNA sola vez y que sirva para todo: cuando exista el ticket, la misma prueba verifica también el papel.


- [x] **F4-TICKET-01** — Plantilla de ticket 58/80 mm (venta y cotización)
  - **Salida:** `buildTicketDefinition(input, t)` — plantilla NUEVA con el mismo pdfmake **0.2.x** (0.3 rompe: `pdfmake_1.default is not a constructor` — bitácora 2026-08-19, excluida en Dependabot a propósito; el renderer de documentos NO se reusa: es carta, con firmas y sin precios; lo que se comparte es el patrón función-pura-testeable, el `DocumentPdfService`/printer y el transporte binario); ancho 58/80 mm configurable, alto dinámico; **venta**: negocio, folio `VTA`, líneas con precio, totales, método, vuelto, lote FEFO si aplica; **cotización**: marca **COTIZACIÓN**, folio `COT`, precios **de referencia** y leyenda de que el precio final se calcula en caja (decisión de Carlos); claves i18n `ticket.*` — **la unidad se nombra con `unitName()` y las cantidades se formatean con `formatQuantity()`** (nunca el código crudo `unit` ni un `.0000` en piezas — lecciones del 2026-08-20); ojo con el display de dinero: ICU de Node 22 renderiza USD como `USD 1,234.56` (bitácora 2026-07-16)
  - **Verificar:** unit del builder (molde `document-pdf.renderer.spec.ts`): totales, la marca de cotización, la leyenda; e2e: `GET /pos/sales/:id/ticket` y `/pos/quotes/:id/ticket` bajan `application/pdf`
  - **Depende de:** F4-SALE-01, F4-QUOTE-01
  - **Estimación:** 2.5 h

- [x] **F4-TICKET-02** — Impresión desktop
  - **Salida:** `window.print` + CSS `@page` 58/80 mm desde la venta cerrada, la cotización generada y el historial (reimprimir); fallar la impresión no pierde nada — el ticket se rebaja del historial
  - **Verificar:** tests: el botón dispara la descarga/print; reimprimir desde el historial
  - **Desvío deliberado al construir (2026-08-21):** el tablero pedía `window.print` + CSS `@page`, que imprime lo que está en PANTALLA. Se hizo distinto: se abre el **PDF que ya devuelve el servidor**, con su tamaño de papel correcto. Hacerlo con CSS habría significado mantener DOS plantillas del mismo ticket —una en pdfmake y otra en hojas de estilo— que un día dirían cosas distintas. Con bloqueador de popups cae a la descarga: peor imprimir en dos pasos que no poder imprimir
  - **Depende de:** F4-TICKET-01, F4-UI-03
  - **Estimación:** 1.5 h

- [x] **F4-TICKET-03** — El PDF de documentos nombra la unidad, no su código
  - **Salida:** `document-pdf.renderer.ts` (F3) imprime `30 = 30 unit` — el CÓDIGO de la unidad, no su nombre. Defecto preexistente reportado el 2026-08-20, más visible desde que `unit` se llama «Pieza»: el papel firmado debe decir `30 piezas` / `2.500 kg`. Resolver con `unitName(baseUnit, locale)` (el renderer ya recibe `t` con el locale del usuario) y formatear la cantidad con `formatQuantity()`
  - **Verificar:** unit del renderer: una fila en `unit` dice «piezas», una en `kg` dice «kg» con 3 decimales; ninguna celda contiene el regex `\d+ (unit|gr|ml|cm)\b` crudo
  - **Depende de:** — (es deuda de F3; puede hacerse primera)
  - **Estimación:** 1 h

- ⏸ **F4-PRINT-BT** — Impresión Web Bluetooth (ESC/POS) — **DIFERIDA** (Carlos, 2026-08-20): sin una impresora térmica real contra la que probar, implementarla sería código de fe. Se retoma cuando haya hardware; `window.print` cubre el mostrador con impresora de sistema. El número queda reservado (§2.1: no se reutiliza).

### Módulo F4-PWA — La app instalable

- [x] **F4-PWA-01** — Manifest + service worker + offline básico
  - **Salida:** manifest completo (iconos, `display: standalone`, orientación), service worker con app-shell cacheado; **la venta NO funciona offline en F4** — vender sin poder validar stock es regalar inventario; offline muestra estado claro y no un error críptico
  - **Desvío deliberado al construir (2026-08-21):** se descartó `vite-plugin-pwa` y el worker se escribió a mano (`public/sw.js`). El plugin precachea la lista de archivos del build con sus hashes, y eso hace falta para servir TODO offline; acá lo único que importa es que la app ABRA. A cambio, el worker se lee entero en dos minutos y no hay una dependencia que mantener al día con el bundler. **La regla que lo gobierna: el API NUNCA se cachea** — servir un `/pos/lookup` guardado mostraría el stock de hace una hora. Tiene barrera propia (`pwa-contract.test.ts`), porque un manifest y un worker son archivos estáticos que ningún `render()` toca
  - **Depende de:** F4-UI-01
  - **Estimación:** 2 h

### Módulo F4-DOCS — Sincronía de las fuentes de verdad

- [x] **F4-DOCS-01** — Sincronía FINAL contra lo construido
  - **Salida:** la sincronía INICIAL ya se hizo **pre-F4 (2026-08-21**, `topic_key: sellpoint/sincronia-pre-f4`): VISTAS §9.5 + sidebar + permisos reales, CU-POS-01..05, FLUJOS §6.1/§6.2, ARQUITECTURA Fase 4 + cinco series + glosario, F9 §9.1 adelantada. Esta tarea es el **contraste FINAL contra lo que la implementación reveló**: cada divergencia entre lo documentado y lo construido se corrige del lado que estaba mal (wireframes que cambiaron, errores nuevos con su clave, campos que aparecieron); la «Definición de Fase 4 completa» ya estaba escrita antes de la primera tarea — el checklist es el contrato, no la ceremonia del final
  - **Verificar:** los cuatro docs cuentan el mismo diseño QUE EL CÓDIGO; el grep de genericidad sigue limpio
  - **Depende de:** F4-DB-01..F4-PWA-01
  - **Estimación:** 2.5 h

### ✅ Definición de "Fase 4 completa"

- [x] Un POS_Seller **abre turno** (nace en su almacén asignado), vende un carrito mixto —producto simple, compuesto, servicio— y el ledger descuenta exactamente lo vendido: componentes del compuesto incluidos, servicio sin un solo `stock_movement`
  - **⚠ NO se sostenía: el POS nunca expandía compuestos** (2026-08-25). `sales.service` armaba las líneas con `expand: false` clavado, así que vender un compuesto intentaba descontar el compuesto mismo y devolvía 422 «no hay suficiente existencia» de algo que por definición no tiene saldo. El comentario del código y el docblock del describe ya prometían la expansión, y ningún test la verificaba. Corregido en `8ca0a29` con tres e2e; verificado en producción con `VTA-000019`: ADVIL −2, componente −60 (3 × 20 gr) y el compuesto sin movimientos propios
- [x] La venta toma folio `VTA-000001`; dos tenants arrancan su serie en 1; el folio de cotización es una serie `COT` independiente
  - **Verificado en e2e y no contra producción**: ese folio ya se gastó. La decisión de reservarlo para esta prueba (2026-08-21) quedó superada por las ventas de verificación de F5. Se sumó el e2e que faltaba —«dos tenants arrancan su serie en VTA-000001, cada uno la suya»—, que es lo que de verdad demuestra que la serie es POR TENANT: que un tenant nuevo empiece en 1 ya lo cubrían otros tests, pero con un contador global el segundo negocio vería `VTA-000002` sin poder explicar el hueco. La serie `COT` sí se verificó en producción: `COT-000004` mientras las ventas iban por `VTA-000015`
- [x] **Los precios los pone el server**: el front manda ids y cantidades; alterar el POST no altera un precio
- [x] Dos ventas concurrentes del último ítem: una pasa, la otra recibe 409 con el detalle — y el **doble tap** con `Idempotency-Key` devuelve la misma venta sin duplicar stock
  - **Es 422, no 409** (corregido del lado del CRITERIO, 2026-08-25): el sistema responde `422 inventory.insufficient_stock`, el mismo código que F3 usa desde que existe el ledger. 422 es lo correcto —la petición está bien formada; es el estado del inventario el que impide procesarla— y cambiarlo solo por este renglón habría roto la consistencia con el inventario. Verificado en producción: dos ventas simultáneas del último ítem dieron `[201, 422]` y el saldo quedó en 0, nunca negativo
- [x] Vender un producto con `tracks_lots` descuenta el lote FEFO y el ticket lo muestra
- [x] La **anulación** (solo TenantAdmin/Manager, con justificación) restaura el stock exacto vía `sale_return`, compuestos incluidos; doble anulación → 409
- [x] El **cierre de caja** cuadra por método contra lo vendido del turno, registra declarado/calculado/diferencia, y un turno cerrado no vende
- [x] Una **cotización** se crea SIN turno con `pos:quote`, no mueve stock, imprime su ticket marcado COTIZACIÓN con precios de referencia y la leyenda del precio final en caja
- [x] Cargar `COT-…` en el POS **recalcula precios al catálogo vigente**, marca faltantes del almacén del turno, vincula `Sale.quote_id` al cobrar y la quote pasa a `loaded`; recargarla → 409
- [x] Los lookups del carrito **respetan el almacén del turno**: un servicio no asociado y un producto sin stock ahí NO aparecen; el barcode de presentación gana al legacy
- [x] El numpad esconde el `.` en presentaciones enteras y el backend revalida; el modal de cobro nunca se traga un error del server
  - **⚠ NO se sostenía: el backend NO revalidaba** (2026-08-25). El numpad escondía el punto pero el API aceptaba `quantity: 1.5` en una presentación entera y devolvía 201, dejando el saldo en decimales que ningún conteo físico puede cuadrar. F3 lo revalida en su `line-resolver` desde que existe; el POS no. Corregido en `b5c37a9` con la misma regla y su clave i18n propia (`pos.integer_only_presentation`)
- [x] Borrar un servicio ya vendido → 409 `services.has_sales`; la moneda del tenant se congela con **una venta** aunque no haya movimientos de almacén
- [x] El historial (`pos:view`) lista, filtra, reimprime; las anuladas se ven marcadas
- [x] Las tablas nuevas (`sales`, `sale_items`, `cashbox_sessions`, `quotes`, `quote_lines`) pasan los 4 canarios RLS **de comportamiento** + el estructural (lección del checklist de F3: una policy que existe no es una policy que filtra)
- [x] La PWA instala, y sin red dice qué no puede hacer en vez de fallar críptico
- [x] Suites verdes (api unit+integration+e2e, web, shared) + `typecheck:full` + Biome + deploy verde verificado en el log
- [x] Tag `v0.5.0-fase4` creado sobre un commit con Deploy verde — `7611e28`, deploy verde verificado en el log

**Estimación: ~3.5 semanas** (~55 h en 26 tareas + F4-PRINT-BT diferida — F4-TICKET-03 entró en la sincronía pre-F4, 2026-08-21).
---

## Fase 5 — Reportes (ATOMIZADA 2026-08-21)

> **Hereda de F3 (2026-08-17):** el **costo promedio ponderado** se difirió a esta fase (decisión de Carlos): F3 registra `unit_cost` en cada entrada `invoice` (costo por unidad de la presentación capturada); F5 lo lleva a base_unit con el `factor` de la presentación referenciada, calcula el promedio ponderado por producto —**GLOBAL, decidido por Carlos el 2026-08-21**: un traspaso no cambia lo que costó la mercancía; si un día cada sucursal compra a precios muy distintos, se migra a por-almacén— y lo expone en la valorización del reporte de stock y en `cost-estimate` de BOM (hoy `cost/factor`). También heredan de F3 el **reporte de stock en tránsito** con export (F3 dejó `GET /inventory/in-transit`), el **kardex detallado exportable** (F3 dejó `GET /products/:id/kardex` con `balanceAfter`) y el **reporte de vencimientos con export** (la pantalla `/movements/expiring` ya existe). Si algún caso pide **backdating** de movimientos, se evalúa acá con `effective_at` separado de `created_at`.
>
> **Decisiones de la atomización (2026-08-21, `topic_key: sellpoint/f5-atomizacion`):**
> **(1)** El permiso es **`reports:read`** — ya en producción (migración `20260821180000`), asignado a TenantAdmin/Manager/Viewer, POS_Seller no; hoy CERO endpoints lo exigen (la barrera `permissions-catalog.spec.ts` lo detectó huérfano) y F5 lo estrena. Los docs decían `reports:view`: mandó el código.
> **(2)** **No existe `reports:export`** (fantasma de VISTAS §11.2, retirado): exportar es leer —criterio «reimprimir es leer» de F4-UI-03— y la matriz daba asignación idéntica a ver y exportar.
> **(3)** **Exportación SÍNCRONA con tope de filas** (~10.000): superarlo → 400 `reports.export_too_large` que pide acotar filtros, nunca un Excel truncado en silencio (se lee como completo). La cola Redis + worker + S3 del viejo FLUJOS §8 queda **DIFERIDA** — criterio F4-PRINT-BT: sin un caso real, código de fe.
> **(4)** Catálogo/usuarios/almacenes son **export directo sin pantalla propia**: una tabla duplicaría los listados existentes. El export de catálogo necesita SU endpoint (`reports:read`) porque el de la plantilla de importación exige `products:manage` y un Viewer no podría usarlo.
>
> **Revisión pre-arranque (2026-08-24, contra lo construido desde la atomización):**
> **(5)** **La ubicación es dato de primera clase en todo reporte que baje a nivel lote** (directiva de Carlos, 2026-08-24). No es trabajo nuevo de base: `stock_movements.location`, `stock_lots.location` (parte la PK) y `ExpiringRow.location` ya existen, y las pantallas de kardex y stock ya la pintan — era el PLAN el que la omitía en las columnas de export. Vencimientos y kardex la exportan; el reporte de stock gana un detalle por lote/ubicación/caducidad (F5-STK-05, tarea nueva). El tránsito NO la lleva: `TransferLine` tiene lote pero no ubicación —la decide el destino al recibir— y exportar una columna que la base no guarda sería inventarla.
> **(6)** **El export de ventas lleva el código de barras diario** (`sales.barcode`, campo nuevo del 2026-08-24): en la pantalla ya es la segunda columna y el Excel tiene que contar la misma historia. Ventas anteriores al campo → celda vacía, no un guion ni un 0.
> **(7)** El builder compartido de F5-SALES-01 **hereda dos semánticas que ya viven en `sales.service.list`**: el rango de fechas en días del calendario del NEGOCIO (`startOfDayUtc`/`endOfDayUtc` con `tenant.timezone`, bug de timezone cazado el 2026-08-24) y el filtro `folio` que busca por folio O código de barras. Extraer el builder sin arrastrarlas sería una regresión silenciosa en el POS.
> **(8)** **Cuidado con los lotes al reportar**: está pendiente la decisión sobre la normalización a mayúsculas (`lotCodeField` normaliza, los lotes pre-regla quedaron en minúsculas y teclear el código viejo crea un fantasma vacío — `topic_key: sellpoint/lotes-normalizacion-mayusculas`). Los reportes a nivel lote van a EXHIBIR esos fantasmas como filas hermanas casi idénticas; si la decisión no llegó antes de F5-STK-05, el reporte no los esconde — los muestra, porque taparlos en el reporte dejaría la base sucia y el papel mintiendo.

### ✅ Definición de "Fase 5 completa"

- [x] El nav muestra «Reportes» solo con `reports:read`; el hub `/reports` carga sus 8 tarjetas; un POS_Seller recibe 403 en el API y no ve la entrada (contraprueba obligatoria)
- [x] **Stock por almacén**: endpoint transversal NUEVO (producto × almacén, no existe hoy) con filtros server-side (almacén-dentro-del-alcance, bajo mínimo), orden estable con desempate por `id`, **valorizado** (costo promedio ponderado GLOBAL × stock; sin historial la celda va VACÍA, no un 0 fingido que se sumaría al total), y export con los mismos filtros, más un **detalle por lote/ubicación/caducidad** para los productos que manejan lotes (F5-STK-05)
- [x] **Ventas por período**: filtros fecha/vendedor/estado/almacén y **`UserScope` aplicado** — un usuario acotado a un almacén no ve ventas de otros (contraprueba); el `GET /pos/sales` de F4 conserva su semántica sin scope y la diferencia queda documentada
- [x] **Kardex**: exportable reusando `kardex.service.list` — el `balanceAfter` del Excel es idéntico al de la API paginada porque NO hay segunda implementación del saldo
- [x] **Vencimientos** y **En tránsito** exportables desde sus pantallas (herencias F3)
- [x] **Catálogo, usuarios y almacenes** descargables con `reports:read`: un Viewer sin `users:manage` ni `products:manage` baja los tres (esa es la prueba); usuarios SIN campos sensibles
- [x] El `cost-estimate` de BOM usa el promedio ponderado con fallback a `cost/factor`, probado en AMBOS caminos (con y sin historial)
- [x] Todo export es síncrono con tope: sobre el tope → 400 con clave i18n, y las filas NO se materializan
- [x] El front tiene UN solo helper de descarga de blob (las 4 copias actuales, migradas con sus tests intactos)
- [x] Suites verdes (api unit+integration+e2e, web, shared) + `typecheck:full` + Biome + deploy verde verificado en el log
- [x] Tag `v0.6.0-fase5` creado sobre un commit con Deploy verde — `6d50c3c`, deploy verde verificado en el log

### Módulo F5-CORE — Infraestructura de exportación

- [x] **F5-CORE-01** *(cerrada el 2026-08-24)* — Parametrizar `serializeSpreadsheet` (hoja y filename)
  - **Salida:** `serializeSpreadsheet(rows, format, options?)` acepta `sheetName` y `filenameBase` opcionales con default actual («Productos»/«productos») — los llamadores de F2-IMPORT no cambian ni una línea
  - **Verificar:** unit: xlsx con hoja «Ventas» y filename `ventas.xlsx`; contraprueba: sin options se comporta idéntico a hoy (tests existentes verdes sin tocar)
  - **Depende de:** —
  - **Estimación:** 1 h

- [x] **F5-CORE-02** *(cerrada el 2026-08-24)* — Helper de export síncrono con tope de filas
  - **Salida:** función común (en `common/spreadsheet/`): recibe un contador y un fetcher de filas; si `count > MAX_EXPORT_ROWS` (~10 000) lanza 400 con clave i18n `reports.export_too_large`; si no, arma filas y delega en `serializeSpreadsheet`. Es LA implementación del criterio «síncrono con tope» — la cola queda diferida
  - **Verificar:** unit: bajo el tope exporta; contraprueba: sobre el tope → 400 con la clave y el fetcher NO se invoca (las filas no se materializan)
  - **Depende de:** F5-CORE-01
  - **Estimación:** 1.5 h

- [x] **F5-CORE-03** *(cerrada el 2026-08-24)* — `ReportsModule` + primer endpoint con `reports:read`
  - **Salida:** `modules/reports/` (module, controller, service) registrado en `AppModule`; todos sus endpoints llevan `@RequirePermissions("reports:read")` + `UserScope`. Con esto `reports:read` deja de ser un permiso sin puerta. **El primer endpoint es `GET /reports`** (la tarea no lo fijaba): devuelve el catálogo de las 8 tarjetas con el permiso de cada una y `maxExportRows`. El permiso viaja como DATO porque no es uniforme —seis son `reports:read` y vencimientos/tránsito son `inventory:read`—: duplicar esa matriz en el front garantiza que un día diga otra cosa. El catálogo NO se filtra por quien pregunta (el guard hace cumplir el permiso; un catálogo que cambia de forma vuelve indistinguible «no existe» de «no puedes verlo») y **no recibe `UserScope`**: el alcance acota datos de almacén y acá no hay ninguno — pedirlo sería un parámetro decorativo que insinúa un filtrado inexistente
  - **Verificar:** e2e: TenantAdmin/Manager/Viewer → 200; contraprueba: POS_Seller → 403; `permissions-catalog.spec.ts` sigue verde
  - **Depende de:** —
  - **Estimación:** 1 h

### Módulo F5-COST — Costo promedio ponderado (herencia F3)

- [x] **F5-COST-01** *(cerrada el 2026-08-24)* — `WeightedCostService`: el promedio GLOBAL por producto
  - **Salida:** servicio que toma las entradas `invoice` del ledger, lleva `unit_cost` (nivel presentación) a base_unit con `presentation.factor` y calcula el promedio ponderado por cantidad, GLOBAL por producto (decisión de Carlos 2026-08-21). Devuelve `null` sin historial — el consumidor decide el fallback, no se inventa un cero
  - **Verificar:** unit con fixture: dos entradas a costos distintos → promedio exacto; presentaciones con factor distinto normalizan a base_unit; contraprueba: ventas/ajustes/traspasos NO alteran el promedio; producto sin entradas → `null`
  - **Hecho como integration y no unit** (2026-08-24): lo que se prueba es una consulta sobre el libro mayor —qué movimientos cuentan, cómo cruzan el `factor` y cómo pondera Postgres los decimales—; un mock del cliente probaría que escribí lo que pensé, no que la base devuelve lo que hace falta. Vive en `modules/cost/` (módulo propio, sin dependencias): `InventoryModule` ya importa `ProductsModule`, así que colgarlo de inventario cerraría un ciclo. **Sin filtro por `direction`**: el CHECK `direction_reason_check` lista `invoice` solo en entradas, y una contraprueba demostró que el filtro era código muerto — la garantía la fija un test que se pone rojo si alguien relaja el CHECK
  - **Depende de:** —
  - **Estimación:** 3.5 h

- [x] **F5-COST-02** *(cerrada el 2026-08-24)* — `cost-estimate` de BOM usa el ponderado
  - **Salida:** `composition.service.costEstimate` consulta `WeightedCostService` por componente, con fallback al actual `cost/factor` cuando no hay historial; la respuesta indica el origen por componente (`source: "weighted" | "presentation"`)
  - **Verificar:** unit: componente con historial usa el ponderado; contraprueba: componente sin entradas conserva el número de hoy (tests existentes de cost-estimate verdes con el fallback)
  - **Depende de:** F5-COST-01
  - **Estimación:** 1.5 h

### Módulo F5-STK — Stock por almacén

- [x] **F5-STK-01** *(cerrada el 2026-08-24)* — `GET /reports/stock`: el endpoint transversal
  - **Salida:** consulta NUEVA (no existe hoy): producto × almacén con stock, mínimo y flag bajo-mínimo; filtros `warehouseId` (validado con `assertWarehouseInScope`), `belowMin`, búsqueda; solo almacenes del alcance; orden server-side con desempate por `id` (criterio de la casa: sin él una fila puede salir en dos páginas o en ninguna)
  - **Verificar:** e2e: usuario acotado al almacén A no ve filas de B (contraprueba); `belowMin` solo devuelve déficit; orden estable entre páginas
  - **`belowMin` compara contra el TOTAL, no contra el saldo de cada fila** (2026-08-24): `stock_min` es un umbral GLOBAL del producto —«no quiero tener menos de 100 en total»—, no por bodega; es el mismo criterio del kardex y el que responde la pregunta de reposición. Aplicarlo por fila marcaría en rojo tres bodegas con 40 cada una contra un mínimo de 100, habiendo 120. El total se suma SOLO sobre los almacenes del alcance: sumar los de afuera filtraría por esa ventana stock que la persona no puede ver
  - **Depende de:** F5-CORE-03
  - **Estimación:** 3 h

- [x] **F5-STK-02** *(cerrada el 2026-08-24)* — Export del stock
  - **Salida:** `GET /reports/stock/export` con los mismos filtros, sin paginar, vía el helper de tope; descarga con `@Res()` + `Content-Disposition` (patrón de F3); hoja «Stock»
  - **Verificar:** e2e: xlsx descargable con filas = consulta filtrada; contraprueba: dataset sobre el tope → 400
  - **Depende de:** F5-STK-01, F5-CORE-02
  - **Estimación:** 1 h

- [x] **F5-STK-03** *(cerrada el 2026-08-24)* — Valorización en el reporte
  - **Salida:** columnas `avgCost` y `totalValue` (stock × promedio) en `/reports/stock` y su export, vía `WeightedCostService`; productos sin historial muestran la celda vacía
  - **Verificar:** e2e: los valores coinciden con el unit de F5-COST-01; contraprueba: producto sin entradas exporta celda vacía, no 0
  - **Depende de:** F5-STK-01, F5-COST-01
  - **Estimación:** 1.5 h

- [x] **F5-STK-04** *(cerrada el 2026-08-24)* — Pantalla `/reports/stock`
  - **Salida:** ruta con el molde de gates del POS (`ProtectedRoute>OnboardingGate>AppLayout>PermissionGate reports:read`) sobre el componente común de reporte (F5-HUB-03): filtros, tabla server-side, paginador y «Exportar Excel»
  - **Verificar:** test de ruta (molde `pos-sales.test.tsx`): filtros disparan la query con los params correctos; Exportar llama al helper de blob; contraprueba: sin `reports:read` no renderiza
  - **Depende de:** F5-STK-02, F5-HUB-03
  - **Estimación:** 2.5 h

- [x] **F5-STK-05** *(cerrada el 2026-08-24)* — Detalle por lote y ubicación en el reporte de stock
  - **Salida:** `GET /reports/stock?detail=lots` (y su export, hoja «Stock por lote»): producto × almacén × lote × ubicación con caducidad y cantidad, solo productos con `tracksLots`. La fuente es `stock_lots` + `product_lots` — los MISMOS joins de `/products/:id/stock`, extraídos a consulta compartida, no una segunda implementación. Directiva de Carlos (2026-08-24): el almacenaje contempla la ubicación además del lote y la caducidad
  - **Verificar:** e2e: un producto con el mismo lote en dos ubicaciones devuelve DOS filas (la ubicación parte el stock — es la semántica de la PK de `stock_lots`); caducidad nula exporta celda vacía; contraprueba: sin `detail` la respuesta es idéntica a F5-STK-01 (los tests de esa tarea verdes sin tocar); contraprueba de alcance: almacén fuera del scope no aparece
  - **Depende de:** F5-STK-01, F5-STK-02
  - **Estimación:** 2 h

### Módulo F5-SALES — Ventas por período

- [x] **F5-SALES-01** *(cerrada el 2026-08-24)* — `GET /reports/sales` con `UserScope` y filtro por almacén
  - **Salida:** endpoint PROPIO del módulo reports — NO se toca la semántica de `GET /pos/sales` (F4, `pos:view`, sin scope): se extrae el armado del `where` de `sales.service.list` a un builder compartido y se le suma `warehouseId` + intersección con el alcance. El builder ARRASTRA las dos semánticas que ese `where` ya tiene (decisión 7): rango de fechas en días del negocio (`startOfDayUtc`/`endOfDayUtc` con la zona del tenant) y `folio` que busca por folio O código de barras. Totales del período por método en la respuesta, para el pie de la tabla
  - **Verificar:** e2e: usuario acotado no ve ventas de otro almacén (contraprueba); los tests de F4-SALE-04 intactos (contraprueba de no-regresión del builder); el filtro por código de barras encuentra la venta también vía `/reports/sales`
  - **Depende de:** F5-CORE-03
  - **El builder vive en `pos/sales-where.ts` con su propio unit** (2026-08-24): el e2e del rango de fechas solo distingue UTC de CDMX durante 6 h al día —una contraprueba lo demostró: reemplazar `startOfDayUtc` por `new Date(from)` no ponía rojo el e2e a las 5 de la tarde—, así que la semántica de días del negocio la fija un test unitario con la zona a mano. Tipo de retorno `Prisma.SaleWhereInput` EXPLÍCITO: sin él los spreads condicionales infieren un union ilegible que `typecheck:full` rechaza
  - **Estimación:** 2.5 h

- [x] **F5-SALES-02** *(cerrada el 2026-08-24)* — Export de ventas
  - **Salida:** `GET /reports/sales/export`, mismos filtros, hoja «Ventas», vía helper de tope; columnas: folio, **código de barras** (decisión 6; ventas anteriores al campo → celda vacía), fecha, vendedor, almacén, estado, método, total
  - **Verificar:** e2e: filas del xlsx = consulta filtrada; las ANULADAS van marcadas, no omitidas (criterio F4); una venta con `barcode` lo exporta y una anterior al campo deja la celda vacía; sobre el tope → 400
  - **Depende de:** F5-SALES-01, F5-CORE-02
  - **Estimación:** 1 h

- [x] **F5-SALES-03** *(cerrada el 2026-08-24)* — Pantalla `/reports/sales`
  - **Salida:** ruta con filtros fecha/vendedor/estado/almacén sobre el componente común; reusa los patrones de `sales-history.tsx` SIN duplicar la pantalla del POS (audiencias distintas: `pos:view` es el mostrador, `reports:read` es el análisis)
  - **Verificar:** test de ruta: filtros → params; export → helper de blob; contraprueba de permiso
  - **Depende de:** F5-SALES-02, F5-HUB-03
  - **Estimación:** 2 h

### Módulo F5-KDX — Kardex exportable (herencia F3)

- [x] **F5-KDX-01** *(cerrada el 2026-08-24)* — Export del kardex
  - **Salida:** `GET /reports/kardex/:productId/export` REUSANDO `kardex.service.list` — mismos filtros (almacén/fechas/dirección/motivo/lote), sin paginar hasta el tope; columnas con `balanceAfter`, folio, tipo de documento, **lote y ubicación** (decisión 5: `stock_movements` ya guarda las dos y la pantalla ya las pinta — el Excel no puede contar menos que la pantalla). Cero segunda implementación de la window function
  - **Verificar:** e2e: el `balanceAfter` del xlsx es idéntico al de la API paginada para el mismo filtro (misma fuente); contraprueba: producto de otro tenant → 404; respeta el alcance
  - **Depende de:** F5-CORE-02, F5-CORE-03
  - **Estimación:** 1.5 h

- [x] **F5-KDX-02** *(cerrada el 2026-08-24)* — Botón de export en la pantalla de kardex + tarjeta del hub
  - **Salida:** la tab de kardex existente gana «Exportar Excel» con los filtros activos; la tarjeta «Kardex» del hub enlaza ahí (no se construye pantalla nueva)
  - **Verificar:** test: el botón dispara la descarga con los filtros vigentes; contraprueba: sin producto seleccionado el botón queda deshabilitado
  - **Sin guarda de `isComposite` en el botón** (2026-08-24): el componente ya retorna antes si el producto es compuesto, así que la guarda era CÓDIGO MUERTO — una contraprueba lo demostró: agregarla no ponía rojo ningún test porque el caso del que protegería no llega a esa línea
  - **Depende de:** F5-KDX-01, F5-HUB-02
  - **Estimación:** 1.5 h

### Módulo F5-CAT — Catálogo, usuarios y almacenes (exports directos)

- [x] **F5-CAT-01** *(cerrada el 2026-08-24)* — Export de usuarios con `reports:read`
  - **Salida:** `GET /reports/users/export`: nombre, email, roles, almacenes asignados, estado. Con `reports:read` y NO `users:manage`: un Viewer debe poder bajarlo sin acceso a `/system/users`. SIN campos sensibles (hashes, tokens, invitaciones pendientes fuera)
  - **Verificar:** e2e: Viewer sin `users:manage` descarga el xlsx (esa es la prueba); contraprueba: POS_Seller → 403; el xlsx no contiene columnas sensibles
  - **Depende de:** F5-CORE-02, F5-CORE-03
  - **Estimación:** 1.5 h

- [x] **F5-CAT-02** *(cerrada el 2026-08-24)* — Export de almacenes
  - **Salida:** `GET /reports/warehouses/export`: nombre, dirección, estado, productos con stock; limitado al alcance del usuario
  - **Verificar:** e2e: usuario acotado solo exporta sus almacenes (contraprueba); formato y descarga correctos
  - **Depende de:** F5-CORE-02, F5-CORE-03
  - **Estimación:** 1 h

- [x] **F5-CAT-03** *(cerrada el 2026-08-24)* — Export de catálogo con `reports:read`
  - **Salida:** `GET /reports/products/export` REUSANDO la maquinaria de la plantilla de importación de F2 (`import.service.template` ya arma el archivo poblado con los campos dinámicos) — el endpoint existente exige `products:manage` y un Viewer no puede usarlo; este existe justamente para que exportar el catálogo sea LEER
  - **Verificar:** e2e: Viewer (sin `products:manage`) descarga el catálogo completo con campos dinámicos; contraprueba: las columnas son las mismas que las del template (misma fuente, no una segunda lista)
  - **Lo que NO se reusa de la plantilla** (2026-08-24): la fila de EJEMPLO que inventa cuando el catálogo está vacío. Ahí los propósitos se separan —la plantilla enseña un formato, el reporte informa lo que hay— y un «Paracetamol 500mg» en un reporte diría que existe un producto que nadie dio de alta. Se extrajo `ImportService.catalogRows` para compartir columnas y filas sin compartir el ejemplo
  - **Depende de:** F5-CORE-02, F5-CORE-03
  - **Estimación:** 1.5 h

### Módulo F5-EXP — Vencimientos y tránsito (herencias F3)

- [x] **F5-EXP-01** *(cerrada el 2026-08-24)* — Export de vencimientos
  - **Salida:** export sobre la consulta que alimenta `/movements/expiring` (producto, lote, vencimiento, días restantes, almacén, **ubicación**, cantidad — `ExpiringRow.location` ya viaja, decisión 5), mismos filtros de la pantalla, vía helper de tope. Permiso: `inventory:read` — es la misma lectura de su pantalla en otro formato
  - **Verificar:** e2e: filas = consulta de expiring con filtros; contraprueba de alcance por almacén
  - **Depende de:** F5-CORE-02
  - **Estimación:** 1.5 h

- [x] **F5-EXP-02** *(cerrada el 2026-08-24)* — Export de stock en tránsito
  - **Salida:** export sobre `inTransitDetail` —método NUEVO (2026-08-24)— con producto, **lote** (`TransferLine.lotId`; ubicación NO: el traspaso no la guarda, la decide el destino al recibir), origen, destino, cantidad, folio del traspaso y fecha de salida. **No se pudo reusar `inTransit()` tal cual**: ese AGRUPA por producto —lo correcto para el tablero— y pierde el folio, el origen y el destino, que es justo lo que necesita quien baja el archivo para rastrear. No es una segunda implementación de un cálculo: misma tabla, otro nivel de agregación, y el agregado se deriva del detalle
  - **Los dos exports viven en `modules/inventory`, no en `reports`**: su permiso es `inventory:read` porque son la misma lectura de su pantalla en otro formato, y colgarlos del módulo de reportes con el permiso del inventario sería una rareza que el próximo lector tendría que descifrar
  - **Verificar:** e2e: traspaso enviado-no-confirmado aparece; contraprueba: uno confirmado ya no; el alcance mira el ORIGEN (criterio existente de F3-KARDEX-04)
  - **Depende de:** F5-CORE-02
  - **Estimación:** 1 h

- [x] **F5-EXP-03** *(cerrada el 2026-08-24)* — Botones de export + tarjetas del hub
  - **Salida:** «Exportar Excel» en `/movements/expiring` y en la vista de tránsito; tarjetas «Vencimientos» y «En tránsito» en el hub enlazando a esas pantallas
  - **Verificar:** tests de ruta: los botones disparan el helper de blob con los filtros activos; las tarjetas visibles según permiso
  - **Depende de:** F5-EXP-01, F5-EXP-02, F5-HUB-02
  - **Estimación:** 1.5 h

### Módulo F5-HUB — El hub y la plomería del front

- [x] **F5-HUB-01** *(cerrada el 2026-08-24)* — Helper compartido de descarga de blob
  - **Salida:** un solo helper (`lib/download.ts`) con la secuencia blob → objectURL → click → revoke; migradas las CUATRO copias actuales (`products/import-api.ts`, `inventory/api.ts` ×2, `pos/api.ts`)
  - **Verificar:** los tests existentes de esas cuatro features verdes tras la migración (contraprueba de no-regresión); unit del helper
  - **Depende de:** —
  - **Estimación:** 1.5 h

- [x] **F5-HUB-02** *(cerrada el 2026-08-24)* — Hub `/reports` + entrada en el nav
  - **Salida:** ruta `/reports` con las 8 tarjetas de VISTAS §10; `canSeeReportsNav = has("reports:read")` en el nav; las tarjetas de export directo (usuarios, almacenes, catálogo) descargan sin navegar; Catálogo enlaza a `/catalog/products`
  - **Verificar:** test de nav: con `reports:read` se ve; contraprueba: POS_Seller no lo ve y `/reports` lo rebota; las tarjetas de export llaman al helper
  - **Stock y ventas vuelven a ENLAZAR** (2026-08-24): estuvieron descargando mientras sus pantallas no existían —el router no tiene `notFoundComponent` y un enlace muerto es peor que un archivo— y al cerrarse F5-STK-04 y F5-SALES-03 volvieron a ser enlaces. Queda la barrera que recorre TODOS los enlaces del hub y falla si alguno apunta fuera de la lista de rutas reales
  - **Depende de:** F5-HUB-01, F5-CAT-01, F5-CAT-02, F5-CAT-03
  - **Estimación:** 2 h

- [x] **F5-HUB-03** *(cerrada el 2026-08-24)* — Componente común de reporte (TanStack Table server-side)
  - **Salida:** el «patrón común» de VISTAS §10 como componente/hook compartido: zona de filtros + `@tanstack/react-table` en modo manual (`manualPagination`/`manualSorting` contra la API) + paginador + botón Exportar; integra `ScrollableTable`. Lo consumen F5-STK-04 y F5-SALES-03
  - **Verificar:** test con API mockeada: cambiar orden/página dispara la query con params server-side; contraprueba: el orden NO se aplica en cliente (un dataset mock desordenado lo delata)
  - **TanStack Table v9 cambió de API** (2026-08-24): no hay `useReactTable` ni `getCoreRowModel` — es `useTable({ features: coreFeatures })`, y sin `columnVisibilityFeature` la fila expone `getAllCells()` en lugar de `getVisibleCells()`. Se monta con SOLO `coreFeatures`: agregar `rowSortingFeature` o `rowPaginationFeature` ordenaría y paginaría la página recibida, que es exactamente el bug que el modo server-side viene a evitar
  - **Depende de:** F5-HUB-01
  - **Estimación:** 2 h

### Módulo F5-DOCS — Sincronía de las fuentes de verdad

- [x] **F5-DOCS-01** *(cerrada el 2026-08-25)* — Sincronía FINAL contra lo construido
  - **Salida:** la sincronía INICIAL ya se hizo **pre-F5 (2026-08-21**, `topic_key: sellpoint/f5-atomizacion`): permisos fantasma retirados de los cuatro docs, FLUJOS §8 reescrito al flujo síncrono, VISTAS §10 con 8 tarjetas y CU-REP-01..05. Esta tarea es el contraste final: cada divergencia entre lo documentado y lo que la implementación reveló se corrige del lado que estaba mal
  - **Verificar:** los cuatro docs cuentan el mismo diseño QUE EL CÓDIGO; el grep de genericidad sigue limpio
  - **Divergencias encontradas, corregidas del lado del DOC** (2026-08-25): **(1)** VISTAS §10 y CU-REP-02 decían que la tarjeta de Catálogo «abre el listado» — es al revés: **Catálogo DESCARGA y Kardex enlaza**, porque el kardex necesita un producto elegido y el catálogo se baja de un golpe. **(2)** ARQUITECTURA describía TanStack Table «en modo manual»; se montó con SOLO `coreFeatures`, que es más estricto. **(3)** El diagrama de FLUJOS §8 decía «SELECT sin paginar»; el export recorre páginas internamente DESPUÉS de que el tope lo autoriza. **(4)** Faltaba en los cuatro docs que los exports de vencimientos y tránsito viven en el módulo de INVENTARIO con `inventory:read`. El grep de genericidad quedó limpio: las menciones de rubro son ejemplos ilustrativos o el documento original de requerimientos del cliente
  - **Depende de:** F5-CORE-01..F5-HUB-03
  - **Estimación:** 2 h

**Estimación: ~2 semanas** (~42 h en 25 tareas; +F5-STK-05 en la revisión del 2026-08-24).

---

## Fase 6 — Hardening de Producción

> **Objetivo:** pasar de "está corriendo" a "está listo para clientes reales". El deploy básico (walking skeleton) existe desde F0-DEPLOY; esta fase lo endurece.
>
> **LEY DE LA FASE (Carlos, 2026-08-27):** el proyecto es CHICO — 2-3 clientes iniciales en un VPS de 2 GB que ya corre producción + sandbox (~1.7 GB de caps comprometidos). El hardening es BÁSICO y de bajo consumo: **nada que corra permanente en el server se agrega sin pagar su renta en RAM**, y ningún gate nuevo puede volver lento el flujo de trabajo. Lo pesado queda pospuesto con razón escrita (ver el final de la fase), no descartado para siempre: se revisa cuando los clientes lo justifiquen.
>
> Orden de ejecución = orden de las tareas: primero lo que protege DATOS (drills y backups), después lo que da OJOS (uptime, Sentry), después lo estático que no cuesta nada (headers, rate limit, CI).

### Módulo F6-DRILL — Los ensayos (cero costo de runtime; lo primero SIEMPRE)

- [x] **F6-DRILL-01** *(cerrada el 2026-08-27 — RTO medido: 19 s de máquina; RPO: la edad del dump, hasta 24 h; ver bitácora `sellpoint/f6-restore-drill`)* — Restore drill: restaurar un backup real de R2 en el sandbox
  - **Salida:** procedimiento ejecutado y DOCUMENTADO: bajar el dump más reciente de `r2:sellpoint-backups` con rclone, `pg_restore` contra el postgres del SANDBOX (down del stack, restore, up), y la app sandbox sirviendo los datos del backup de producción. Tiempos medidos = RTO/RPO reales, no teóricos. El paso a paso queda documentado en la bitácora y en el docblock del script de backup (el RUNBOOK formal quedó pospuesto — ver Pospuestos).
  - **Verificar:** login en sandbox.sellpointy.com contra los datos restaurados; un producto/venta de prod visible.
  - **Depende de:** — (el sandbox ya existe: es el laboratorio perfecto)
  - **Estimación:** 1 h

- [x] **F6-DRILL-02** *(cerrada el 2026-08-27 — las dos ramas ejercitadas con fallo inducido; ver bitácora `sellpoint/f6-rollback-drill`)* — Rollback drill: fallo inducido en un deploy del sandbox
  - **Salida:** un push a develop con una migración rota A PROPÓSITO; el guardián de deploy-remote.sh revierte sin desplegar y el sandbox sigue sirviendo la versión previa. La rama de rollback post-`up -d` (fallo de healthcheck) se induce en un segundo ensayo. Ambos documentados con sus logs.
  - **Verificar:** el run falla en rojo, el sandbox responde 200 con el tag previo, y el `.env` conserva el IMAGE_TAG anterior.
  - **Depende de:** —
  - **Estimación:** 1 h

### Módulo F6-BACKUPS — Endurecer lo que ya corre

- [x] **F6-BACKUPS-01** *(cerrada el 2026-08-27 — trap ERR + Resend, probada con fallo inducido; ver bitácora `sellpoint/f6-backups-endurecidos`)* — Alerta por correo si el backup falla
  - **Salida:** `backup-postgres.sh` notifica vía Resend (mismo patrón que `cert-expiry-check.sh`: RESEND_API_KEY/MAIL_FROM/ALERT_EMAIL del .env) ante CUALQUIER fallo — dump vacío, rclone caído, disco lleno. Un backup muerto en silencio se descubre el día que se necesita, que es el peor día posible.
  - **Verificar:** inducir un fallo (bucket inválido en una corrida manual) → llega el correo.
  - **Depende de:** —
  - **Estimación:** 45 min

- [x] **F6-BACKUPS-02** *(cerrada el 2026-08-27 — age v1.2.1, ciclo cifra→sube→descifra→restore verificado; la privada la guarda Carlos fuera del server)* — Cifrado del dump con `age`
  - **Salida:** el dump se cifra con `age` (binario estático, SIN daemon — CPU una vez al día, despreciable) antes de subir a R2. Clave pública en el server; la privada la guarda Carlos FUERA del server (password manager). El procedimiento de restore de F6-DRILL-01 se actualiza con el descifrado.
  - **Verificar:** el objeto en R2 no es un dump legible; el restore drill completo funciona con la clave privada.
  - **Depende de:** F6-DRILL-01 (para re-verificar el restore con cifrado)
  - **Estimación:** 1 h

### Módulo F6-WATCH — Ojos sin carga al server

- [x] **F6-WATCH-01** *(cerrada el 2026-08-27 — 2 monitores HTTP a los /api/health de app y sandbox, cada 5 min, alertas a carls.hlm@gmail.com; ambos Up 100%)* — Uptime externo (UptimeRobot free)
  - **Salida:** monitores HTTP a `https://app.sellpointy.com/api/health` y `https://sandbox.sellpointy.com/api/health` con alertas al correo de Carlos. Corre AFUERA: cero recursos del VPS. (Paso de Carlos: crear la cuenta free.)
  - **Verificar:** parar el api del sandbox un minuto → llega la alerta → arranca de nuevo → llega el "up".
  - **Depende de:** —
  - **Estimación:** 20 min

- [x] **F6-WATCH-02** *(cerrada el 2026-08-27 — proyectos sellpoint front/api con solo Error Monitoring; evento de fuego ENVIADO desde el contenedor de prod y VISTO por Carlos en el dashboard; DSN del front horneado en el bundle con gate por hostname; ver bitácora `sellpoint/f6-watch`)* — Sentry SOLO errores (free tier)
  - **Salida:** `@sentry/nestjs` en la api y `@sentry/react` en el front, con tracing/profiling/replay APAGADOS (`tracesSampleRate: 0` — solo captura de errores: el overhead de un SDK en modo mínimo es aceptable a cambio de enterarse de los errores de clientes reales antes de que llamen). DSN por env: vacío = desactivado (dev y sandbox sin Sentry). Source maps del front subidos en CI.
  - **Verificar:** un error forzado en sandbox NO reporta; el mismo en prod aparece en el dashboard con stack legible.
  - **Depende de:** — (paso de Carlos: cuenta free de Sentry y el DSN al .env de prod)
  - **Estimación:** 2 h

- [x] **F6-WATCH-03** *(cerrada el 2026-08-27 — el panel nuevo de Vultr ya no tiene umbral en dólares; lo que hay lo cubre: Invoices por email [gasto FIJO ~$10/mes → el recibo ES la alerta de anomalías] + Bandwidth alerts a 75/90/100% [el ÚNICO costo variable del plan] + Outage notifications, todo Enabled y verificado por Carlos en su panel. Nota: el crédito promocional de $250 expira el primer mes — desde el mes 2 el cargo va a la tarjeta)* — Alertas de costos (Vultr; reemplaza al F6-COSTS de AWS, obsoleto tras deploy-vultr)
  - **Salida:** billing alert configurada en el panel de Vultr con umbral acordado; free tiers de Cloudflare/R2/Resend documentados en `env.prod.example` con sus límites (qué pasa si se exceden).
  - **Verificar:** la alerta existe en el panel con el umbral correcto.
  - **Depende de:** —
  - **Estimación:** 15 min

### Módulo F6-EDGE — Config estática de nginx (cero costo de runtime)

- [x] **F6-EDGE-01** *(cerrada el 2026-08-27 — Permissions-Policy con camera=(self) por el escáner del POS; CSP pragmática self-only en app y sandbox; verificación por curl tras el deploy)* — Afinar las cabeceras de seguridad
  - **Salida:** `security-headers.inc` revisado: HSTS con `preload`, `Permissions-Policy` mínima (camera/mic/geolocation off), X-Frame-Options/nosniff confirmados. CSP PRAGMÁTICA para la SPA — sin nonces ni strict-dynamic: una CSP estricta rompe la app a cambio de un riesgo que con 3 clientes no paga su renta; la de Helmet en la api se queda como está.
  - **Verificar:** `curl -sI https://app.sellpointy.com` muestra las cabeceras; Mozilla Observatory sube de calificación sin romper ninguna pantalla (smoke con Playwright).
  - **Depende de:** —
  - **Estimación:** 1 h

- [x] **F6-EDGE-02** *(cerrada el 2026-08-27 — zona auth_ip 1m, 30r/m + burst 10, estado 429, en app y sandbox; verificada con ráfaga contra el sandbox)* — `limit_req` sobre `/api/auth/*`
  - **Salida:** zona `limit_req_zone` de 1m (memoria despreciable) con rate bajo + burst SOLO en las rutas de auth del vhost de app: defensa en profundidad debajo del throttler de Nest — si la api se satura, nginx corta antes. El resto del API no se limita en nginx (el throttler ya gobierna).
  - **Verificar:** ráfaga contra el SANDBOX devuelve 429/503 de nginx; el login normal no se ve afectado.
  - **Depende de:** —
  - **Estimación:** 45 min

### Módulo F6-SUPPLY — Cadena de suministro (corre en GitHub, cero server)

- [x] **F6-SUPPLY-01** *(cerrada el 2026-08-27 — workflow semanal ghcr-retention.yml, 30 versiones por paquete)* — Retención de imágenes en GHCR
  - **Salida:** workflow semanal con `actions/delete-package-versions` que conserva las últimas N versiones de `sellpoint-{api,web,migrate}` (hoy crecen sin techo — verify W4). Es el hermano del F6-DISK-RETENTION ya cerrado: aquel limpia el disco del VPS, este el registry.
  - **Verificar:** tras la primera corrida, GHCR muestra ≤ N versiones por paquete y el deploy sigue funcionando.
  - **Depende de:** —
  - **Estimación:** 30 min

- [x] **F6-SUPPLY-02** *(cerrada el 2026-08-27 — api ya era non-root, migrate ganó USER node, web pasó a nginx-unprivileged:8080 con vhosts actualizados; Trivy CRITICAL informativo en el deploy)* — Docker harden básico
  - **Salida:** usuario non-root en las imágenes de api y web (si falta) + escaneo Trivy en CI SOLO severidad CRITICAL y en modo INFORMATIVO (no bloquea el deploy: con 3 clientes, un gate duro de CVEs frena más de lo que protege — se endurece cuando haya más que perder).
  - **Verificar:** `docker exec sellpoint-api whoami` ≠ root; el reporte de Trivy aparece en el run del CI.
  - **Depende de:** —
  - **Estimación:** 1.5 h

### Módulo F6-SECRETS — Versión ligera

- [x] **F6-SECRETS-01** *(cerrada el 2026-08-27 — env/ cifrados con age en R2 refrescados por el cron nocturno, verificados en el bucket; rotación JWT documentada en bitácora `sellpoint/f6-secrets`)* — Respaldo cifrado de los .env + rotación de JWT documentada
  - **Salida:** copia cifrada con `age` de los DOS `.env` (prod y sandbox) en R2, actualizada cuando cambien, con procedimiento de restauración documentado junto al script; y el procedimiento de ROTACIÓN de llaves JWT documentado en la bitácora (generar par nuevo, ventana de convivencia, invalidación de sesiones). SIN gestor de secretos corriendo (Infisical/sops-daemon): un servicio más en 2 GB es exactamente lo que la LEY DE LA FASE veta — el chmod 600 + el respaldo cifrado + la rotación documentada son el básico correcto para este tamaño.
  - **Verificar:** restaurar el .env desde R2 en un directorio temporal y compararlo con el vivo.
  - **Depende de:** F6-BACKUPS-02 (reusa la clave age)
  - **Estimación:** 1 h

### Historia: tareas cerradas por adelantado

- [x] **F6-DISK-RETENTION** *(cerrada el 2026-08-18, adelantada desde F6 por incidente en producción)* — Retención de imágenes Docker **en el server** y guarda de disco en `deploy-remote.sh`. Hermana de F6-GHCR-RETENTION (esa es del registry; esta es del disco del VPS). **Incidente:** el disco llegó a 100% (47 GB) con **380 imágenes, 37.71 GB** — 7 en uso y 373 cadáveres. Dos deploys seguidos murieron en el PRIMER `sed` del `.env` con `sed: couldn't flush: No space left on device`, un mensaje que no dice nada de lo que realmente pasa. **Causa raíz doble:** (1) el cleanup era `docker image prune -f` **sin `-a`**, que solo borra imágenes *dangling* — y acá TODAS están etiquetadas con su SHA, así que ninguna lo es: la línea corrió en cada deploy exitoso durante meses **liberando 0 bytes**, y el propio log del run 32183405990 lo dice literal (`Total reclaimed space: 0B`); (2) vivía al FINAL del script y solo tras un smoke OK, o sea que necesitaba disco sano para poder liberar disco, y cada fallo dejaba basura apretando el trinquete. **Hecho:** el bloque de higiene se movió al principio del script, usa `docker image prune -af --filter "until=168h"` (una semana, que es lo que necesita el rollback porque hace `up -d` SIN pull y cuenta con la imagen previa local), corre siempre y con `|| true` (es higiene, no un requisito), y se le sumó una **guarda de disco** que aborta con un mensaje accionable —y sin tocar nada— si quedan menos de 3000 MB. Carlos liberó 36.21 GB a mano con `prune -a -f` para desatascar (100% → 26%). El script se copia por `scp` en cada deploy, así que el arreglo se despliega solo
- [x] **F6-TYPECHECK-TESTS** *(cerrada el 2026-08-17: 0 errores + `typecheck:full` en el job `checks`)* — Cerrar el hueco de tipos de los TESTS del API y engancharlo a CI. Hoy los `.spec.ts` no los verifica NADIE: `tsconfig.build.json` los excluye y `ts-jest` transpila sin chequear por `isolatedModules` en `tsconfig.base.json`. Se descubrió el 2026-08-16 con dos deploys en rojo seguidos (F2-CAT y el cierre de F2). Ya existe `pnpm typecheck:full` (`apps/api/tsconfig.typecheck.json`) que los incluye; **reporta 26 errores preexistentes en 9 archivos**, todos de Fase 1 y concentrados en autenticación (`auth.controller.spec` 8, `token.service.spec` 4, `auth-resolve-tenant-by-email` 4). Cuatro familias: 7 × `Object is possibly undefined` (accesos tipo `rows[0].campo` sin `?.`), 6 × `ConfigService` genérico sin parametrizar, 4 × mock de `Response` inferido como `never`, y **9 de mocks DESACTUALIZADOS** (`Expected 5 arguments, but got 4`) — este último grupo es el que importa: son tests que llaman a una firma que ya cambió, así que pasan en verde probando una forma que no existe. **Criterio de hecho: llegar a cero Y sumar `typecheck:full` al job `checks`** — sin lo segundo, arreglarlos hoy no impide que mañana entren otros. `apps/web` ya quedó cubierto (`pnpm typecheck` = `tsc -b`, el mismo gate que `pnpm build`).

### Pospuestos de la fase (por la LEY DE LA FASE, no por descuido)

- **Logs centralizados (Loki o similar)** — RAM que el VPS de 2 GB no tiene. Los json-file rotados (10m×3 por servicio) + `docker logs` vía SSH cubren el volumen actual. Se revisa al crecer.
- **fail2ban custom para `/auth/*`** — redundante: el throttler de Nest + el `limit_req` de F6-EDGE-02 cubren la misma amenaza sin un daemon más.
- **Cloudflare naranja + Origin Certificate** — el gris funciona y el ACME está probado; el proxy naranja (ocultar IP, WAF) se evalúa cuando haya más clientes que proteger. Era el F6-CF-PROXY original.
- **Gestor de secretos con servicio (Infisical)** — peso injustificado a este tamaño; ver F6-SECRETS-01.
- **F6-DR completo: auto-backups de Vultr + RUNBOOK.md** *(decisión de Carlos, 2026-08-27: fuera de los primeros meses)* — los DATOS ya quedan cubiertos por los dumps diarios a R2 (con alerta y cifrado tras F6-BACKUPS); el backup de la MÁQUINA y el documento formal de operaciones esperan a que haya más clientes o más manos operando. Mientras tanto, la documentación operativa vive en la bitácora de este archivo, los docblocks de los scripts y la memoria del asistente. Las tareas, congeladas tal cual para retomarlas:

  - [ ] **F6-DR-01** — Auto-backups del VPS en Vultr
    - **Salida:** auto-backups activados en el panel de Vultr (~20% del costo del server, $1-2 USD/mes — OK de Carlos en el panel) + procedimiento de snapshot manual documentado para ANTES de cambios grandes de infra. Complementa (no sustituye) los dumps a R2: el backup del VPS recupera la máquina; el dump recupera los datos.
    - **Verificar:** el panel muestra el primer backup automático completado.
    - **Depende de:** —
    - **Estimación:** 15 min

  - [ ] **F6-DR-02** — RUNBOOK.md de operaciones
    - **Salida:** documento en el repo con: deploy y rollback manual paso a paso, restore desde R2 (el procedimiento probado en F6-DRILL-01), alta de un ambiente nuevo (incluido el ALTER ROLE de sellpoint_app post-primer-deploy), cómo mirar logs (`docker logs` vía SSH — esto ABSORBE al F6-LOGS original: con este volumen, los json-file rotados + SSH bastan y Loki queda pospuesto), troubleshooting con los incidentes REALES ya vividos (disco 100%, DNS ambiguo de la red compartida, lease de pulls concurrentes, heredoc drenado), y cuentas/accesos (dónde vive cada credencial).
    - **Verificar:** una persona que no sea Carlos podría ejecutar un restore siguiendo solo el documento.
    - **Depende de:** F6-DRILL-01, F6-DRILL-02 (documenta lo ENSAYADO, no lo imaginado)
    - **Estimación:** 2 h


**Estimación de la fase:** ~9 h de trabajo efectivo (repartibles en una semana tranquila, sin bloquear el desarrollo).

---

## Fase 7 — Planes + Billing + Suscripciones (ATOMIZADA 2026-08-27, cobro manual)

> **Objetivo:** monetizar el SaaS con 4 planes (Basic/Pro/Plus + Premium a la medida), trial de 14 días con nivel Plus, free tier post-trial, cupones por tenant y ciclo mensual/anual anclado al día de pago. **Cobro MANUAL en esta fase**: Carlos registra los pagos (transferencia/efectivo) desde un backoffice y el sistema calcula vencimientos, avisa por correo y degrada solo. Stripe queda **pospuesto** con el enchufe listo (ver Pospuestos al final).
>
> **LEY DE LA FASE (criterio de Carlos, 2026-08-27):** el diseño se decidió tras analizar a la competencia mexicana (Ontaz $99-499, SICOVI $499-1,699, AtentiPOS $299-599, POS Express $249-449, Alegra $187-524, BIND $1,499+). Con 2-3 clientes fundadores, una pasarela automática son ~2 semanas de integración que hoy no pagan renta: el motor de suscripciones se construye completo y la pasarela se enchufa después sin migración. Misma regla de recursos de la Fase 6: nada pesado para el VPS de 2GB (el cron es `@nestjs/schedule` dentro del proceso api, NO BullMQ).
>
> Esta sección REEMPLAZA el diseño anterior de la fase (Chica/Mediana/Empresa con Stripe-first, gracia de 7 días y BullMQ, 2026-08-14). Los pre-requisitos que aquella versión pedía ya están cumplidos: `Tenant.createdAt` existe desde F1 y los guards son componibles (`@RequirePermissions` + guards de feature tipo `TenantCurrencyChangeableGuard`).

### Decisiones de negocio confirmadas (2026-08-27)

| Decisión | Valor |
|---|---|
| Planes fijos (México) | **Basic $199** · **Pro $349** · **Plus $499** MXN/mes |
| Mercados iniciales (2026-08-27) | **México, Canadá y Estados Unidos, en ese orden.** El precio es POR MERCADO, no por tipo de cambio: EE.UU. **$15/$29/$45 USD** (entrada agresiva contra Square $29+, Clover $15, Toast $69) · Canadá **$19/$39/$59 CAD**. Un país futuro sin precio propio paga la tarifa USD (default internacional) |
| Premium | Todo lo de Plus + desarrollo a la medida; **precio dinámico por tenant** (`custom_price` en la moneda del tenant), sin precio publicado, CTA "Contactar" |
| Ciclo anual | 10× el mensual (2 meses gratis) **en todas las monedas**: MXN $1,990/$3,490/$4,990 · USD $150/$290/$450 · CAD $190/$390/$590 |
| Trial | **14 días con nivel Plus**, sin tarjeta, arranca al registrarse |
| Free tier (post-trial / post-gracia) | Puede entrar y VER todo; sin crear/editar en catálogos, inventario ni cotizaciones; **máximo 10 ventas al día**; el modal de planes aparece SIEMPRE al iniciar sesión |
| Basic sin control de inventario | Las ventas proceden **con stock en cero** (saldo queda negativo, kardex completo); Pro/Plus validan stock normal |
| Límites | Basic **3 usuarios / 1 almacén** · Pro **6 / 4** · Plus **20 / 10** · Premium ilimitado |
| Cotizaciones | Desde **Pro** |
| Subcatálogos + campos personalizados + roles personalizados | Solo **Plus** (los 4 roles base — Admin/Manager/Seller/Viewer — en todos) |
| Cupones | Por tenant, **uno activo a la vez**: monto fijo con vigencia (ej. -$200 × 12 meses → Plus cobra $299) o 100% gratis por un período definido |
| Fecha de cobro | Anclada al día del primer pago: paga el 5-ago → vence el 5-sep (mensual) o el 5-ago-2027 (anual). Meses cortos: 31-ene → 28-feb → **31**-mar (el ancla no se reescribe) |
| Impago | `due_at` vence → **10 días de gracia** con avisos → día 11 cae al free tier. Nada se borra jamás |
| Monedas | MXN, USD y CAD vía `plan_prices`; el precio se resuelve por el `country` del tenant (existe desde F1) con fallback a USD. Facturación fiscal (CFDI en México) fuera de scope — se integra con Facturapi cuando la pida un cliente |

### Matriz de features por plan

Los límites numéricos y flags calientes son COLUMNAS de `plans`; los booleanos de módulos van en el JSONB `features` (validado con `planFeaturesSchema` de shared — el catálogo se edita desde el backoffice sin migración).

Precios mostrados en MXN (mercado base); EE.UU. y Canadá tienen su propia tabla en `plan_prices` (ver decisiones).

| | Free | Basic $199 | Pro $349 | Plus $499 | Premium |
|---|---|---|---|---|---|
| `write_access` (crear/editar) | ❌ | ✅ | ✅ | ✅ | ✅ |
| `daily_sales_limit` | **10** | ∞ | ∞ | ∞ | ∞ |
| `stock_control` | ❌ | **❌** | ✅ | ✅ | ✅ |
| `max_users` / `max_warehouses` | 1 / 1 | 3 / 1 | 6 / 4 | 20 / 10 | ∞ (NULL) |
| POS + ticket · `pos` | ✅ (10/día) | ✅ | ✅ | ✅ | ✅ |
| Productos y servicios | solo lectura | ✅ | ✅ | ✅ | ✅ |
| Presentaciones / BOM · `compositions` | solo lectura | ❌ | ✅ | ✅ | ✅ |
| Cotizaciones · `quotes` | solo lectura | ❌ | ✅ | ✅ | ✅ |
| Movimientos + Kardex · `movements` | ❌ | ❌ | ✅ | ✅ | ✅ |
| Traspasos · `transfers` | ❌ | ❌ | ✅ (tiene 4 almacenes) | ✅ | ✅ |
| Lotes y caducidad · `lots` | ❌ | ❌ | ❌ | ✅ | ✅ |
| Subcatálogos + campos dinámicos · `custom_fields` | solo lectura | ❌ | ❌ | ✅ | ✅ |
| Roles personalizados · `custom_roles` | ❌ | ❌ | ❌ | ✅ | ✅ |
| Reportes · `reports` / export · `reports_export` | básicos | básicos | ✅ + export | ✅ + export | ✅ |
| Desarrollo a la medida | — | — | — | — | ✅ |

**Invariantes duras:** (1) los límites se aplican **SOLO al crear** — un downgrade jamás suspende usuarios ni borra almacenes; `max_users=1` en Free significa "no puedes invitar a nadie más", no "se apagan los demás". (2) `stock_control=false` también en Free: un tenant que era Basic (con negativos por diseño) y cae a Free debe poder hacer sus 10 ventas. (3) El free tier es una FILA del catálogo (`code='free'`, `is_public=false`), no un `if`: el resolver tiene un solo camino.

### Diseño (resumen ejecutable)

**Modelo de datos** — 5 tablas nuevas + 1 columna + 1 drop, migraciones con CHECKs en SQL crudo (patrón F3):

- `plans` — catálogo global **SIN RLS** (mismo criterio que `permissions`). 5 filas (free/basic/pro/plus/premium) sembradas EN la migración con `ON CONFLICT (code) DO NOTHING`. Columnas: `code` (CHECK), `name`, `sort_order`, `is_public`, `is_active`, `max_users`, `max_warehouses`, `daily_sales_limit`, `write_access`, `stock_control`, `features` JSONB, y `gateway_product_id` (enchufe Stripe). **Los precios NO viven aquí**: viven en `plan_prices` — una sola fuente de verdad por mercado.
- `plan_prices` — precios por mercado, **SIN RLS** (catálogo global). `plan_id`, `country` CHAR(2), `currency` CHAR(3), `price_monthly`, `price_yearly` (CHECK `= price_monthly × 10`), `gateway_price_monthly_id`/`gateway_price_yearly_id` (los price IDs de Stripe son por moneda — van aquí, no en `plans`), UNIQUE `(plan_id, country)`. Seed: 9 filas (basic/pro/plus × MX/US/CA); free y premium no tienen filas (sin precio publicado). Resolución: fila del `country` del tenant → fallback a la fila `US` (default internacional). El precio es POR MERCADO, no por tipo de cambio.
- `tenant_subscriptions` — 1 por tenant (`tenant_id` UNIQUE), RLS + bypass. `status` CHECK IN (`trialing|active|past_due|free|canceled`), `billing_cycle` (`monthly|yearly`), **`anchor_day` 1-31 fijado con el PRIMER pago y nunca recalculado**, `trial_ends_at`, `service_period_start/end` (lo pagado), `due_at` (hoy == period_end; con pasarela divergirán), `grace_ends_at`, `custom_price` (Premium), `canceled_at`, `cancel_at_period_end`, `notes`, `gateway`/`gateway_customer_id`/`gateway_subscription_id`. CHECKs de coherencia por estado. Índices `(status, due_at)` y `(status, trial_ends_at)`.
- `subscription_payments` — RLS + bypass. SNAPSHOT del cobro (`plan_id`, `plan_code`, `billing_cycle`, `gross_amount`, `discount_amount`, `amount` con CHECK `amount = gross - discount`), `method` (`transfer|cash|card|other|courtesy`), `gateway` + `gateway_reference` + `external_id` (UNIQUE parcial — idempotencia del webhook futuro, inerte hoy), `paid_at`, `period_start/end`, `status` (`recorded|voided`) + `voided_*`, `recorded_by`. **Un pago no se borra: se anula** con razón, y el período se recalcula desde los pagos vivos.
- `tenant_discounts` — RLS + bypass. `kind` (`fixed_amount|free`), `amount`, `starts_at/ends_at`, `max_periods`/`applied_periods`, `is_active` con **UNIQUE parcial: un activo por tenant** (no se apilan cupones; se revoca uno y se otorga otro).
- `billing_notifications` — RLS. `UNIQUE(subscription_id, kind, anchor_at)` ES la idempotencia de los avisos del cron (INSERT antes del mail; P2002 = ya enviado).
- `users.is_platform_admin` BOOLEAN NOT NULL DEFAULT false — excluido de `updateUserSchema` y de los SELECT públicos (test que lo fija).
- **Drop de los CHECKs `quantity >= 0`** de `stock_by_warehouse` y `stock_lots`: la barrera pasa de estructural a de plan — quien la impone es `StockLedgerService`.
- **Bypass RLS acotado:** segunda policy `billing_admin_bypass` (GUC `app.billing_admin`) SOLO en las 4 tablas de billing, prendida únicamente por `PrismaService.withBillingAdminContext()` — regla dura hermana de AD-1. Un SELECT a `sales` desde ese contexto devuelve 0 filas (test que lo fija: el bypass NO es global).
- Sin tabla de eventos: cada transición se audita con `AuditService.record()` (acciones `billing.*`; `userId` ausente en las del cron).

**Máquina de estados** — regla de oro: **el cron SOLO degrada; promover es siempre un acto humano (registrar el pago)**. Un bug del cron no puede regalar un plan.

```
registro (TenantsService.provision, MISMA tx) ──► trialing (plus, 14 días)
trialing ──pago──► active            trialing ──cron trial_ends_at──► free
active ──cron due_at──► past_due (gracia 10 días, avisos)
past_due ──pago──► active            past_due ──cron grace_ends_at (día 11)──► free
free ──pago──► active (re-ancla anchor_day al día del pago)
* ──Carlos──► canceled (cancel_at_period_end) ──vence período──► free · ──reactivate──► active
```

Pago tardío: `periodStart = servicePeriodEnd ?? paidAt` — no se regalan días; el DTO permite override explícito de `periodStart` para "reactivar desde hoy sin cobrar los meses muertos" (decisión de Carlos, no default). Matemática pura en `packages/shared/src/billing.ts` (`addBillingPeriod`, `resolveAnchorDay`, `graceEndsAt`, `computeChargeAmount`) sobre `localCalendarDate`/`dayRangeToInstants` — el día del NEGOCIO, no UTC (la lección del Kardex).

**Enforcement** — `EntitlementsService.resolve(tenantId)`: `trialing/active/past_due` → plan de la suscripción; `free/canceled/sin fila` → plan `free` (fail-closed con WARN). Caché Redis `entitlements:{tenantId}` TTL 300s con `DEL` explícito en cada cambio (NO va en el JWT: un token de 15 min conservaría el plan viejo tras la degradación de las 3 AM); si Redis cae, fail-open a Postgres — nunca a "todo permitido". `SubscriptionGuard` como 4º APP_GUARD (`Throttler → JwtAuth → Permissions → Subscription`: un 403 de rol nunca se disfraza de 402 de plan): deja pasar `@Public`/GET/HEAD/`@AllowedInFreeTier`/`/billing/*`/`/admin/*`; free tier + método mutante → **402** `billing.read_only`; `@RequiresFeature('x')` sin flag → 402; `@CheckPlanLimit('users'|'warehouses')` cuenta y bloquea al crear. `PlanRequiredException` propia (Nest no trae 402). El límite de 10 ventas/día NO va en el guard: se valida dentro de la transacción de la venta, ANTES de gastar folio, con la zona horaria del negocio. **Basic vende sin stock por la opción "asentar todo, permitir negativos"**: `allowNegative` en `resolveLotsFefo` y `StockLedgerService.apply` (solo se salta la validación; el `SELECT FOR UPDATE` ordenado NO se toca), activado únicamente en la venta con la regla efectiva `!entitlements.stockControl || tenant.sellWithoutStock` (el plan sin control O el toggle "Vender sin existencias" del admin — decisión de Carlos, 2026-08-27) — kardex completo, y el saldo negativo ES la lista de qué inventariar al subir a Pro (el conteo de F3 lo corrige).

**Backoffice de Carlos** — no existe SuperAdmin hoy (roles son por tenant). Auth mínima en AND: `is_platform_admin` **Y** email en `BILLING_ADMIN_EMAILS` (env, obligatoria en prod) **Y** status active **Y** email verificado → `PlatformAdminGuard` (el flag NO viaja en el JWT: query por PK solo en `/admin/*`). Sin app aparte: mismo login. Endpoints `/admin/billing/*` (fuera del SubscriptionGuard — Carlos no puede quedarse sin backoffice por su propia suscripción): lista cross-tenant con MRR, detalle, **registrar pago** (el corazón), anular con razón, PATCH subscription (plan/ciclo/custom_price/anchor), cupones, cancel/reactivate, GET/PATCH plans (edita precios y features sin migración), y run-daily manual del cron. Front: UNA pantalla `/admin/billing` (tabla + modal "Registrar pago"); el resto solo-API hasta que duela.

**Frontend** — `SubscriptionBlock` emitido por login y `GET /me` (patrón A1; `TenantBlock` NO se toca) → `AuthUser.subscription`. `GET /billing/plans` `@Public()` para la pantalla de planes (Premium sin precio) y `GET /billing/me` con el historial propio. `PlanGate` con el patrón exacto de `OnboardingGate` (compuesto después de él): free tier ve **children + PlansModal encima** — sin `Navigate`, porque el free tier VE todo; el dismiss vive SOLO en memoria, nunca en localStorage → reaparece cada sesión por construcción. Primitivo `Dialog` nuevo en `components/ui` (no existe). `BillingBanner` en `AppLayout`: trial "quedan N días", past_due rojo, free "N/10 ventas hoy". Sidebar por feature **con candado** (upsell: el cliente ve qué se pierde; click → PlansModal): el permiso decide si el ROL puede, el feature si el PLAN incluye. Interceptor 402 global → abre PlansModal con el motivo. `usePlan().canWrite` apaga los CTAs de crear/editar en free tier.

**Cron y correos** — `@nestjs/schedule` a las 3:00 `America/Mexico_City` (`BILLING_CRON_ENABLED/TZ/HOUR` en env). Un job, 5 pasos públicos testeables y disparables desde `/admin`: `expireTrials → openGrace → expireGrace → sendReminders → invalidateCaches`. Idempotente por construcción (`updateMany WHERE status` + el UNIQUE de notificaciones). 6 templates nuevos en la unión `MailTemplate` + `emails.json` es/en: `trial-ending` (T-3), `trial-ended`, `payment-due-soon` (T-7/T-3), `payment-past-due`, `plan-downgraded`, `payment-received` (este lo dispara `recordPayment`). Destinatario: el usuario activo más antiguo con `tenants:manage`.

---

### Módulo F7-SHARED — contratos y matemática pura

- [x] **F7-SHARED-01** *(cerrada el 2026-08-27 — packages/shared/src/billing.ts; PAYMENT_METHODS chocaba con el del POS → SUBSCRIPTION_PAYMENT_METHODS)* — Contratos de billing en `@sellpoint/shared`
  - **Salida:** `packages/shared/src/billing.ts` con `PLAN_CODES`, `SUBSCRIPTION_STATUSES`, `BILLING_CYCLES`, `PAYMENT_METHODS`, `DISCOUNT_KINDS`, `TRIAL_DAYS=14`, `GRACE_DAYS=10`, `planFeaturesSchema` (Zod estricto) y `subscriptionBlockSchema`. Exportado en `index.ts`.
  - **Verificar:** tests de shared en verde; `planFeaturesSchema` rechaza una key desconocida.
  - **Depende de:** — · **Estimación:** 1 h

- [x] **F7-SHARED-02** *(cerrada el 2026-08-27 — addBillingPeriod es pura de CALENDARIO (recibe/devuelve YYYY-MM-DD y avanza desde la fecha del vencimiento anterior, no del arranque del período); dueInstant/graceEndsAt traducen a instantes con límite abierto, criterio de day-range)* — `addBillingPeriod` + `resolveAnchorDay` + `graceEndsAt`
  - **Salida:** funciones puras con ancla y meses cortos: 5-ago→5-sep; 5-ago→5-ago-2027 (anual); 31-ene→28-feb→**31**-mar; 29-feb-2028→28-feb-2029. Resultado = fin del día LOCAL del negocio (usa `localCalendarDate`/`dayRangeToInstants`).
  - **Verificar:** ≥12 casos incluyendo bisiesto y cambio de horario.
  - **Depende de:** F7-SHARED-01 · **Estimación:** 2.5 h

- [x] **F7-SHARED-03** *(cerrada el 2026-08-27 — centavos enteros vía scaledInteger, jamás IEEE-754; customPrice gana siempre como override por tenant)* — `computeChargeAmount` (precio + cupón + Premium)
  - **Salida:** plan+ciclo → bruto; `custom_price` gana cuando el plan no publica precio; cupón `fixed_amount` resta con piso en 0; `free` deja neto 0.
  - **Verificar:** Plus + cupón $200 = $299; Premium sin `custom_price` lanza; cupón $600 sobre Basic $199 da 0, no negativo.
  - **Depende de:** F7-SHARED-01 · **Estimación:** 1.5 h

### Módulo F7-DB — modelo de datos

- [x] **F7-DB-01** *(cerrada el 2026-08-27 — migración 20260827230000)* — Tablas `plans` + `plan_prices` + CHECKs (SIN RLS)
  - **Salida:** migración `_f7_plans` con las dos DDL, CHECK de `code`, CHECK de precios positivos, CHECK `price_yearly = price_monthly * 10`, UNIQUE `(plan_id, country)`, y el comentario de por qué NO llevan RLS (catálogo global, criterio de `permissions`) y de por qué el precio vive por mercado.
  - **Verificar:** `prisma migrate dev` ok; insertar `code='bogus'` falla; dos filas del mismo (plan, país) → 23505.
  - **Depende de:** — · **Estimación:** 1 h

- [x] **F7-DB-02** *(cerrada el 2026-08-27 — seed verificado por test: 5 planes, 9 precios, anual = 10×)* — Seed de los 5 planes + 9 precios en la MIGRACIÓN
  - **Salida:** `INSERT … ON CONFLICT DO NOTHING` de free/basic/pro/plus/premium (límites 3/1 · 6/4 · 20/10, `daily_sales_limit=10` en free) + las 9 filas de `plan_prices`: MX $199/$349/$499 MXN · US $15/$29/$45 USD · CA $19/$39/$59 CAD, cada una con su anual ×10. Datos de referencia por el pipeline, no por `seed.ts`.
  - **Verificar:** 5 planes y 9 precios; free y premium sin filas de precio (test).
  - **Depende de:** F7-DB-01 · **Estimación:** 1.5 h

- [x] **F7-DB-03** *(cerrada el 2026-08-27 — CHECKs de coherencia por estado probados contra la DB)* — `tenant_subscriptions` + RLS + CHECKs de coherencia
  - **Salida:** DDL completa, policy `tenant_isolation` canónica, CHECKs por estado (`trialing⇒trial_ends_at`, `active⇒due_at+cycle+anchor`, `past_due⇒grace_ends_at`, `canceled⇒canceled_at`), índices `(status, due_at)` y `(status, trial_ends_at)`.
  - **Verificar:** `status='active'` sin `due_at` falla; SELECT sin contexto RLS devuelve 0 filas.
  - **Depende de:** F7-DB-01 · **Estimación:** 1.5 h

- [x] **F7-DB-04** *(cerrada el 2026-08-27 — CHECK amount=gross−discount, UNIQUE parcial de cupón activo y dedup de avisos probados)* — `subscription_payments` + `tenant_discounts` + `billing_notifications`
  - **Salida:** las tres tablas con RLS, CHECK `amount = gross - discount`, UNIQUE parcial de descuento activo, UNIQUE parcial de `external_id` y UNIQUE de notificación.
  - **Verificar:** dos descuentos activos del mismo tenant → 23505; misma notificación dos veces → 23505.
  - **Depende de:** F7-DB-03 · **Estimación:** 1.5 h

- [x] **F7-DB-05** *(cerrada el 2026-08-27 — el test del bypass acotado usa SET LOCAL ROLE sellpoint_app: la conexión local es superuser y las policies no se evalúan con ella)* — Policy `billing_admin_bypass` + `PrismaService.withBillingAdminContext`
  - **Salida:** segunda policy en las 4 tablas de billing; método nuevo en `prisma.service.ts` con docblock de regla dura (la ÚNICA puerta cross-tenant; solo cron y backoffice).
  - **Verificar:** desde el contexto se ven suscripciones de 2 tenants Y un SELECT a `sales` devuelve 0 filas — el test que fija que el bypass NO es global.
  - **Depende de:** F7-DB-04 · **Estimación:** 2 h

- [x] **F7-DB-06** *(cerrada el 2026-08-27 — updateUserSchema lo stripea por construcción; test lo fija)* — `users.is_platform_admin`
  - **Salida:** migración + campo Prisma `DEFAULT false NOT NULL`, excluido de `updateUserSchema` y de los SELECT públicos.
  - **Verificar:** `PATCH /users/:id` con `isPlatformAdmin: true` en el body NO lo escribe.
  - **Depende de:** — · **Estimación:** 45 min

- [x] **F7-DB-07** *(cerrada el 2026-08-27 — el test de F3 «el saldo de un lote nunca es negativo» se reescribió para fijar la regla nueva)* — Dropear los CHECKs `quantity >= 0`
  - **Salida:** migración `_f7_allow_negative_stock` que dropea `stock_by_warehouse_quantity_check` y `stock_lots_quantity_check`, con el comentario de que la barrera pasa a ser de plan (la impone `StockLedgerService`).
  - **Verificar:** un UPDATE a saldo negativo ya no falla; el test de F3 que asumía el CHECK se reescribe contra el ledger.
  - **Depende de:** — · **Estimación:** 1 h

### Módulo F7-CORE — resolver y servicio de suscripciones

- [x] **F7-CORE-01** *(cerrada el 2026-08-27)* — `EntitlementsService.resolve()` sin caché
  - **Salida:** servicio + interfaz `Entitlements`; `trialing/active/past_due` → plan de la suscripción, resto → `free`; tenant sin fila → `free` con WARN (fail-closed). `features` parseado con Zod, nunca `any`.
  - **Verificar:** unit con los 5 estados + tenant sin fila.
  - **Depende de:** F7-DB-04, F7-SHARED-01 · **Estimación:** 2 h

- [x] **F7-CORE-02** *(cerrada el 2026-08-27 — fail-open a Postgres, patrón PermEpoch)* — Caché Redis + invalidación
  - **Salida:** key `entitlements:{tenantId}` TTL 300s, `invalidate(tenantId)`, fail-open a Postgres con WARN si Redis cae.
  - **Verificar:** segunda llamada no toca DB; `invalidate` fuerza relectura; con Redis caído responde igual (no "todo permitido").
  - **Depende de:** F7-CORE-01 · **Estimación:** 1.5 h

- [x] **F7-CORE-03** *(cerrada el 2026-08-27 — misma tx, audit billing.trial_started)* — Trial en `TenantsService.provision()`
  - **Salida:** fila `trialing` (plan Plus, `trial_ends_at = +14 días` fin del día local) creada DENTRO de la misma transacción de `withNewTenantContext`, después de `setTenantContext`. Audit `billing.trial_started`.
  - **Verificar:** `POST /auth/register-tenant` deja la fila con 14 días; si el insert falla, el tenant no nace.
  - **Depende de:** F7-DB-03 · **Estimación:** 1.5 h

- [x] **F7-CORE-04** *(cerrada el 2026-08-27 — incluye el adelanto del template payment-received en la unión de mail)* — `BillingService.recordPayment()`
  - **Salida:** resuelve el precio por el `country` del tenant vía `plan_prices` (fallback US), valida plan/ciclo/`custom_price`, aplica cupón (`computeChargeAmount`), `periodStart = servicePeriodEnd ?? paidAt` (con override explícito), `periodEnd = addBillingPeriod(...)`, fija `anchor_day` en el primer pago, mueve a `active`, limpia `grace_ends_at`, incrementa `applied_periods`, audita, invalida caché y encola `payment-received`. El snapshot del pago guarda la `currency` resuelta.
  - **Verificar:** trial→active; past_due→active sin regalar días; con cupón cobra el neto; Premium sin `custom_price` → 422; tenant con `country='US'` cobra $45 USD y uno sin precio propio (ej. `'CO'`) cae a la tarifa USD.
  - **Depende de:** F7-CORE-02, F7-SHARED-03 · **Estimación:** 3 h

- [x] **F7-CORE-05** *(cerrada el 2026-08-27 — el estado presente se deriva de la historia corregida: active/past_due/free/trialing en cascada)* — `voidPayment()` y recálculo del período
  - **Salida:** marca `voided` con razón, recalcula `service_period_end` desde los pagos vivos y devuelve el status coherente. Audita.
  - **Verificar:** anular el último pago regresa la suscripción a `past_due`/`free` según corresponda.
  - **Depende de:** F7-CORE-04 · **Estimación:** 2 h

- [x] **F7-CORE-06** *(cerrada el 2026-08-27 — cancel deja el status INTACTO con cancel_at_period_end: el cron hace la transición al vencer)* — `changePlan()` / `cancel()` / `reactivate()` / cupones
  - **Salida:** transiciones del backoffice con razón obligatoria, audit e invalidación de caché en cada una. `cancel` con `cancel_at_period_end`; `reactivate` solo con período vivo.
  - **Verificar:** unit por transición; cancelar con período vivo mantiene el servicio hasta el corte.
  - **Depende de:** F7-CORE-04 · **Estimación:** 2.5 h

### Módulo F7-GUARD — enforcement

- [x] **F7-GUARD-01** *(cerrada el 2026-08-27 — billing.json quedó con 14 claves es/en)* — `PlanRequiredException` (402) + i18n `billing.json`
  - **Salida:** excepción propia con status 402 + `apps/api/src/i18n/{es,en}/billing.json` (read_only, feature_not_in_plan, daily_sales_limit_reached, user_limit_reached, warehouse_limit_reached, subscription_canceled, plan_not_found, custom_price_required, discount_overlap, payment_period_overlap, not_platform_admin).
  - **Verificar:** la excepción sale con `statusCode: 402`, mensaje traducido y `code` crudo (el `AllExceptionsFilter` ya la traduce sin tocarlo — test que lo fija).
  - **Depende de:** — · **Estimación:** 45 min

- [x] **F7-GUARD-02** *(cerrada el 2026-08-27)* — Decoradores `@RequiresFeature` / `@AllowedInFreeTier` / `@CheckPlanLimit`
  - **Salida:** tres decoradores con sus keys de Reflector, patrón `require-permissions.decorator.ts`.
  - **Verificar:** specs de metadata.
  - **Depende de:** — · **Estimación:** 45 min

- [x] **F7-GUARD-03** *(cerrada el 2026-08-27 — @RequiresFeature aplicado a nivel de CLASE en documents/transfers y por handler en lots/quotes; solo evalúa mutantes: la lectura de la propia historia nunca se bloquea)* — `SubscriptionGuard` como 4º APP_GUARD
  - **Salida:** guard con solo-lectura del free tier + features, registrado al final de la cadena en `app.module.ts` con el comentario del porqué del orden (403 de rol nunca se disfraza de 402). `@AllowedInFreeTier` aplicado a: `POST /pos/sales`, abrir/cerrar sesión de caja, cancelar venta, `PATCH /me`.
  - **Verificar:** free tier + POST → 402 `billing.read_only`; free tier + GET → 200; `@AllowedInFreeTier` pasa; Basic + `@RequiresFeature('lots')` → 402.
  - **Depende de:** F7-GUARD-02, F7-CORE-02 · **Estimación:** 3 h

- [x] **F7-GUARD-04** *(cerrada el 2026-08-27 — entrada formal en Bitácora por retroactivo)* — `@CheckPlanLimit` en `POST /users` y `POST /warehouses`
  - **Salida:** decorador aplicado a los dos endpoints existentes. **Entrada formal en Bitácora** (cambio retroactivo a tareas cerradas de F1/F3).
  - **Verificar:** Basic con 3 usuarios no crea el cuarto (402 `billing.user_limit_reached`); Basic con 1 almacén no crea el segundo; Premium (`max_users` NULL) crea sin tope.
  - **Depende de:** F7-GUARD-03 · **Estimación:** 1 h

### Módulo F7-POS — stock y ventas

- [x] **F7-POS-01** *(cerrada el 2026-08-28 — el shortfall se suma al ÚLTIMO lote del reparto: Σ stock_lots == stock_by_warehouse sigue en pie)* — `allowNegative` en `resolveLotsFefo`
  - **Salida:** opción nueva; con ella un `shortfall > 0` no lanza — el faltante se asigna al lote elegido o la línea sigue sin lote.
  - **Verificar:** stock 0 con `allowNegative` devuelve plan válido; SIN el flag sigue lanzando `inventory.insufficient_stock` (regresión F3/F4 intacta).
  - **Depende de:** F7-DB-07 · **Estimación:** 2 h

- [x] **F7-POS-02** *(cerrada el 2026-08-28 — solo se salta la validación del paso 4; el SELECT FOR UPDATE intacto)* — `allowNegative` en `StockLedgerService.apply`
  - **Salida:** flag en `LedgerInput` que salta SOLO el bloque de validación de salida. El `SELECT … FOR UPDATE` ordenado NO se toca (sigue siendo la barrera anti-carrera del saldo).
  - **Verificar:** salida sobre saldo 0 deja `quantity=-3` con su `stock_movement`; sin el flag sigue el 422.
  - **Depende de:** F7-POS-01 · **Estimación:** 2 h

- [x] **F7-POS-03** *(cerrada el 2026-08-28 — migración sell_without_stock aplicada SIN drift; la regla vive en crearVenta con los entitlements cacheados)* — La regla efectiva de vender sin stock (plan O toggle del admin)
  - **Salida:** migración `tenants.sell_without_stock BOOLEAN NOT NULL DEFAULT false` + `SalesService.crearVenta` pasa `allowNegative: !entitlements.stockControl || tenant.sellWithoutStock` a FEFO y al ledger. SOLO la venta: entradas/salidas/traspasos/conteos validan siempre. Decisión de Carlos (2026-08-27): vender sin stock es CONFIGURACIÓN del negocio, no solo consecuencia del plan — en Basic/Free queda implícita (sin control de inventario no hay bloqueo posible); en Pro/Plus/Premium la decide el admin.
  - **Verificar:** tenant Basic vende con stock 0 (201, kardex escrito, saldo negativo); tenant Pro con el toggle apagado sigue con 422; el mismo tenant Pro con el toggle prendido vende y el kardex documenta el negativo.
  - **Depende de:** F7-POS-02, F7-CORE-02 · **Estimación:** 2 h

- [x] **F7-POS-05** *(cerrada el 2026-08-28 — switch de guardado inmediato en los ajustes del negocio; en Basic/Free activado y bloqueado con la nota del plan)* — El toggle "Vender sin existencias" (PATCH + UI)
  - **Salida:** `sellWithoutStock` en `updateTenantSchema` (PATCH /tenants/me, permiso `tenants:manage`) y switch en los ajustes del negocio: en planes CON control de inventario es editable (default apagado); en Free/Basic se muestra activado y BLOQUEADO con la nota "incluido en tu plan". El bloque del tenant hacia el front expone el valor efectivo.
  - **Verificar:** admin Pro lo prende desde la UI y la venta sin stock procede; un Seller sin `tenants:manage` no ve el switch; en Basic aparece fijo.
  - **Depende de:** F7-POS-03, F7-WEB-01 · **Estimación:** 2 h

- [x] **F7-POS-04** *(cerrada el 2026-08-28 — SalesPlanGate antes de nextFolio, día del NEGOCIO, canceladas devuelven cupo; contraprueba off-by-one cazada)* — Límite de 10 ventas/día del free tier
  - **Salida:** `SalesPlanGate.assertDailySaleAllowed` llamado dentro de `withTenantContext` y ANTES de `nextFolio` (una venta rechazada no gasta folio). Cuenta con el índice `[tenantId, createdAt Desc]` y el día del NEGOCIO (`zonaDelNegocio` + `dayRangeToInstants`), excluyendo canceladas. Plan de pago = 0 queries. El off-by-one bajo concurrencia queda documentado como aceptado.
  - **Verificar:** venta 11 → 402 `billing.daily_sales_limit_reached` sin gastar folio; la venta del día siguiente (zona del negocio, no UTC) pasa.
  - **Depende de:** F7-GUARD-01, F7-CORE-02 · **Estimación:** 2.5 h

### Módulo F7-ADMIN — backoffice

- [x] **F7-ADMIN-01** *(cerrada el 2026-08-28 — cuatro llaves en AND; whitelist vacía = backoffice cerrado incluso en dev)* — `BILLING_ADMIN_EMAILS` + `PlatformAdminGuard`
  - **Salida:** env nueva (superRefine: obligatoria y no vacía en producción) + guard con el AND completo (flag + whitelist + active + verificado).
  - **Verificar:** flag sin email en whitelist → 403; email sin flag → 403; todo en orden → 200.
  - **Depende de:** F7-DB-06 · **Estimación:** 2 h

- [x] **F7-ADMIN-02** *(cerrada el 2026-08-28 — MRR desde pagos VIGENTES y POR MONEDA: dinero real, no aspiracional)* — `GET /admin/billing/tenants` (cross-tenant)
  - **Salida:** lista con plan/status/`due_at`/último pago/MRR vía `withBillingAdminContext`; detalle por tenant con pagos y cupón vigente. `/admin/*` excluido del `SubscriptionGuard`.
  - **Verificar:** e2e con 2 tenants: el admin ve ambos; un TenantAdmin normal recibe 403.
  - **Depende de:** F7-ADMIN-01, F7-DB-05 · **Estimación:** 2 h

- [x] **F7-ADMIN-03** *(cerrada el 2026-08-28 — DTO Zod sobre recordPayment; el admin/billing entero lleva @AllowedInFreeTier: pagar no depende de tener plan)* — `POST /admin/billing/tenants/:id/payments`
  - **Salida:** DTO Zod (`amount`, `method`, `paidAt`, `gatewayReference?`, `periodStart?`, `notes?`) sobre `recordPayment`. El `amount` se valida contra `computeChargeAmount`; si difiere se acepta con WARN en notes, pero el período JAMÁS se calcula desde el monto.
  - **Verificar:** e2e trial→active con `due_at` correcto; el segundo pago mueve al mes siguiente respetando el ancla.
  - **Depende de:** F7-ADMIN-02, F7-CORE-04 · **Estimación:** 2 h

- [x] **F7-ADMIN-04** *(cerrada el 2026-08-28 — reason obligatoria en todo; changePlan ganó anchorDay/notes como palancas de rescate)* — `void`, `PATCH subscription`, `cancel`, `reactivate`
  - **Salida:** los 4 endpoints con razón obligatoria y audit.
  - **Verificar:** e2e de cada uno; `audit_logs` guarda `before`/`after`.
  - **Depende de:** F7-ADMIN-03, F7-CORE-05, F7-CORE-06 · **Estimación:** 2.5 h

- [x] **F7-ADMIN-05** *(cerrada el 2026-08-28 — features con schema estricto; el anual SIEMPRE derivado ×10; el TTL de 300s absorbe la invalidación por plan, documentado)* — Cupones y edición de planes
  - **Salida:** `POST/DELETE` de cupones + `GET/PATCH /admin/billing/plans/:code` (features validados con `planFeaturesSchema`; editar precio invalida cachés).
  - **Verificar:** dos cupones activos → 409 `billing.discount_overlap`; editar `price_monthly` refresca los entitlements.
  - **Depende de:** F7-ADMIN-04 · **Estimación:** 2 h

- [x] **F7-ADMIN-06** *(cerrada el 2026-08-28 — warnings.negativeStock con sku/almacén/cantidad en el PATCH de suscripción)* — Aviso de stock negativo al subir de plan
  - **Salida:** `changePlan` hacia un plan con `stock_control=true` responde con `warnings.negativeStock: [{sku, warehouse, quantity}]` — la lista de qué inventariar.
  - **Verificar:** Basic con negativos → upgrade a Pro responde 200 con la lista.
  - **Depende de:** F7-ADMIN-04, F7-POS-03 · **Estimación:** 1.5 h

### Módulo F7-CRON — job diario

- [x] **F7-CRON-01** *(cerrada el 2026-08-28 — registro DINÁMICO vía SchedulerRegistry; BILLING_CRON_ENABLED default FALSE: degradar es opt-in del ambiente)* — `@nestjs/schedule` + env + run-daily manual
  - **Salida:** dependencia + `ScheduleModule.forRoot()`, `BILLING_CRON_ENABLED/TZ/HOUR` en env (apagado en tests), y `POST /admin/billing/jobs/run-daily`.
  - **Verificar:** con `BILLING_CRON_ENABLED=false` el cron no se registra; el endpoint corre `run()`.
  - **Depende de:** F7-ADMIN-01 · **Estimación:** 1.5 h

- [x] **F7-CRON-02** *(cerrada el 2026-08-28 — updateMany WHERE status = idempotencia; cancel_at_period_end vencido va a canceled sin gracia)* — `expireTrials()` + `openGrace()` + `expireGrace()`
  - **Salida:** las 3 transiciones con `updateMany` idempotente y audit sin `userId`. Lectura cross-tenant con `withBillingAdminContext`; mutación + audit dentro del `withTenantContext` del tenant afectado.
  - **Verificar:** unit con reloj fake: trial vencido→free; `due_at` vencido→past_due con gracia a 10 días; día 11→free; correr dos veces no duplica nada.
  - **Depende de:** F7-CRON-01, F7-CORE-06 · **Estimación:** 3 h

- [x] **F7-CRON-03** *(cerrada el 2026-08-28 — INSERT antes del mail; P2002 = ya avisado)* — `sendReminders()` con dedup
  - **Salida:** ventanas T-3 del trial, T-7 y T-3 del vencimiento, T-3 de la gracia; INSERT en `billing_notifications` ANTES del mail (P2002 = ya enviado); mail post-commit best-effort.
  - **Verificar:** dos corridas el mismo día → 1 solo mail por (suscripción, kind, ancla).
  - **Depende de:** F7-CRON-02, F7-MAIL-01 · **Estimación:** 2.5 h

- [x] **F7-CRON-04** *(cerrada el 2026-08-28 — DEL solo de los tenants tocados)* — `invalidateCaches()`
  - **Salida:** `DEL entitlements:{tenantId}` de los tenants tocados al cierre de `run()`.
  - **Verificar:** tras degradar, la siguiente request lee `free` sin esperar el TTL.
  - **Depende de:** F7-CRON-02, F7-CORE-02 · **Estimación:** 45 min

### Módulo F7-MAIL — plantillas

- [x] **F7-MAIL-01** *(cerrada el 2026-08-28 — payment-received se adelantó en CORE-04; los 5 avisos del ciclo llegaron con CRON; sin CTAs: son avisos, la acción es transferir)* — 6 templates de billing
  - **Salida:** unión `MailTemplate` extendida (trial-ending, trial-ended, payment-due-soon, payment-past-due, plan-downgraded, payment-received) + `emails.json` es/en con shape `{subject, greeting, body, cta}` + render en el driver. Vars como string (moneda/fecha se formatean en el emisor con helpers de shared).
  - **Verificar:** `MAIL_DRIVER=console` imprime los 6 con vars sustituidas; el test de la unión cerrada se actualiza.
  - **Depende de:** — · **Estimación:** 2 h

### Módulo F7-WEB — frontend

- [x] **F7-WEB-01** *(cerrada el 2026-08-28 — toSubscriptionBlock deriva del Entitlements cacheado; daysLeft en días de CALENDARIO del negocio; ambos emisores fijados por sus specs)* — `SubscriptionBlock` en login y `GET /me` + store
  - **Salida:** `subscription.types.ts` (tipo + `SUBSCRIPTION_SELECT` + mapper, patrón A1) emitido por los DOS endpoints; espejo en `apps/web/src/lib/billing/api.ts`; `AuthUser.subscription` en `auth.store.ts`. `TenantBlock` NO se toca. Incluye `daysLeft` calculado en el server con la zona del tenant.
  - **Verificar:** los dos emisores devuelven el mismo shape (test gemelo del de `TenantBlock`).
  - **Depende de:** F7-CORE-02 · **Estimación:** 2 h

- [x] **F7-WEB-02** *(cerrada el 2026-08-28 — listPublicPlans excluye free, resuelve por país con fallback US; /billing/me reusa el detalle del backoffice: es SU tenant)* — `GET /billing/plans` (`@Public`) y `GET /billing/me`
  - **Salida:** `billing.controller.ts`; los precios salen en la moneda del tenant autenticado (su `country`); sin sesión acepta `?country=` con fallback US. Premium sale sin precio (CTA "Contactar"); `/billing/me` con historial propio (permiso `tenants:manage`).
  - **Verificar:** sin token, `/billing/plans` responde 200 con los 4 planes visibles (free excluido); un tenant MX ve MXN y uno US ve USD.
  - **Depende de:** F7-DB-02 · **Estimación:** 1.5 h

- [x] **F7-WEB-03** *(cerrada el 2026-08-28 — portal + aria-modal + Escape + backdrop + foco adentro; cerrado se DESMONTA, sin foco fantasma)* — Primitivo `Dialog`
  - **Salida:** `apps/web/src/components/ui/dialog.tsx`: portal + backdrop + `role="dialog"` + `aria-modal` + focus trap + Escape.
  - **Verificar:** test de accesibilidad; cierre por Escape y por backdrop.
  - **Depende de:** — · **Estimación:** 2 h

- [x] **F7-WEB-04** *(cerrada el 2026-08-28 — el modal sin botón de pago a propósito: cobro manual, todo cambio pasa por contacto; el footer promete que nada se borra)* — `usePlan()` + `PlansModal`
  - **Salida:** hook (`hasFeature`, `canWrite`, `status`, `daysLeft`) + modal con las 4 tarjetas en la moneda del tenant, toggle mensual/anual (anual muestra 10×) y Premium con "Contactar".
  - **Verificar:** RTL: Basic ve Pro/Plus como upgrade; el toggle anual muestra los precios ×10; un tenant US ve USD.
  - **Depende de:** F7-WEB-02, F7-WEB-03 · **Estimación:** 2.5 h

- [x] **F7-WEB-05** *(cerrada el 2026-08-28 — montado en AppLayout y no ruta por ruta: una ruta nueva jamás olvida el gate; sin Navigate, el free tier VE la app con el modal encima)* — `PlanGate`
  - **Salida:** patrón exacto de `OnboardingGate`, compuesto DESPUÉS de él en todas las rutas protegidas: bootstrap → `SessionLoading` (nunca Navigate en la ventana, lección S6); status ≠ free → children; free → children + `PlansModal` encima. Dismiss SOLO en memoria.
  - **Verificar:** free tier ve dashboard + modal; el reload lo vuelve a mostrar; `active` no lo ve; sin flash en el bootstrap.
  - **Depende de:** F7-WEB-04 · **Estimación:** 2 h

- [x] **F7-WEB-06** *(cerrada el 2026-08-28 — clickeable hacia el modal; sin role=status: un banner persistente no es live region y usurpaba el rol de las pantallas)* — `BillingBanner` en `AppLayout`
  - **Salida:** trial "Te quedan N días de prueba (plan Plus)" / past_due rojo "Tu pago venció el DD/MM, te quedan N días" / free "Modo gratuito: N/10 ventas hoy". En `AppLayout`, no en `__root` (sin sesión no hay suscripción).
  - **Verificar:** RTL por estado; `active` no pinta nada.
  - **Depende de:** F7-WEB-01 · **Estimación:** 1.5 h

- [x] **F7-WEB-07** *(cerrada el 2026-08-28 — candado por fila en el map de movimientos + cotización + subcatálogos/campos; el permiso sigue mandando)* — Sidebar por feature (candado)
  - **Salida:** `app-layout.tsx` compone `has(perm) && hasFeature(x)`; los módulos que el plan no incluye se pintan con candado y abren `PlansModal` (upsell — no se ocultan).
  - **Verificar:** Basic ve "Movimientos" con candado; Plus lo ve normal; el permiso sigue mandando (un Viewer sin `inventory:read` no lo ve ni con Plus).
  - **Depende de:** F7-WEB-04 · **Estimación:** 2 h

- [x] **F7-WEB-08** *(cerrada el 2026-08-28 — interceptor 402 con import perezoso del store; canWrite compuesto en los canManage de products/services/warehouses)* — Interceptor 402 + solo-lectura en UI
  - **Salida:** el cliente HTTP abre `PlansModal` con el `code` de cualquier 402; `usePlan().canWrite` apaga los CTAs de crear/editar en productos, servicios, subcatálogos, campos, almacenes, movimientos y cotizaciones.
  - **Verificar:** free tier no ve "Nuevo producto"; un 402 del backend abre el modal con el motivo correcto.
  - **Depende de:** F7-WEB-05 · **Estimación:** 2.5 h

- [x] **F7-WEB-09** *(cerrada el 2026-08-28 — /settings/billing con estado del ciclo e historial; link en el nav con tenants:manage)* — Pantalla "Mi plan" (`/settings/billing`)
  - **Salida:** plan actual, ciclo, próximo vencimiento, cupón vigente e historial de pagos propio.
  - **Verificar:** requiere `tenants:manage`; muestra solo lo del propio tenant.
  - **Depende de:** F7-WEB-02 · **Estimación:** 2 h

- [x] **F7-WEB-10** *(cerrada el 2026-08-28 — /admin/billing con tabla, MRR por moneda y el modal Registrar pago; isPlatformAdmin expuesto en login y /me SOLO para pintar el link)* — Backoffice `/admin/billing`
  - **Salida:** tabla de tenants (plan, status, vencimiento, último pago, MRR) + modal "Registrar pago". Link del sidebar solo si `isPlatformAdmin`. El resto del backoffice queda solo-API.
  - **Verificar:** un no-admin no ve el link y la ruta le devuelve 403.
  - **Depende de:** F7-ADMIN-03, F7-WEB-03 · **Estimación:** 3 h

### Módulo F7-E2E — end to end

- [x] **F7-E2E-01** *(cerrada el 2026-08-28 — `billing-lifecycle.e2e-spec.ts`, 8 casos; el ancla del 31 verificada de punta a punta)* — registro → trial → pago → active → renovación
  - **Verificar:** el `due_at` de la segunda renovación respeta el ancla (caso 31-ene → 28-feb → 31-mar); el mismo flujo con un tenant `country='US'` cobra y registra USD.
  - **Depende de:** F7-ADMIN-03, F7-CRON-02 · **Estimación:** 2 h

- [x] **F7-E2E-02** *(cerrada el 2026-08-28 — `billing-free-tier.e2e-spec.ts`, 8 casos)* — trial vencido → free → 10 ventas/día + solo-lectura
  - **Verificar:** venta 11 = 402; `POST /products` = 402; `GET /products` = 200.
  - **Depende de:** F7-POS-04, F7-GUARD-03 · **Estimación:** 2 h

- [x] **F7-E2E-03** *(cerrada el 2026-08-28 — `billing-grace.e2e-spec.ts`, 7 casos; incluye cancelar ≠ no pagar)* — vencimiento → gracia 10 días → día 11 free → pago tardío reactiva
  - **Verificar:** días 1-10 escribe normal; día 11 no; el pago del día 12 devuelve `active` sin regalar días.
  - **Depende de:** F7-CRON-02 · **Estimación:** 2 h

- [x] **F7-E2E-04** *(cerrada el 2026-08-28 — `billing-basic-stock.e2e-spec.ts`, 9 casos; **cazó un bug real del conteo con teórico negativo**, ver bitácora)* — Basic vende con stock 0 y sube a Pro
  - **Verificar:** venta OK con saldo negativo y kardex escrito; el upgrade avisa los negativos; un conteo físico los corrige.
  - **Depende de:** F7-POS-03, F7-ADMIN-06 · **Estimación:** 2 h

- [x] **F7-E2E-05** *(cerrada el 2026-08-28 — `billing-discount.e2e-spec.ts`, 7 casos)* — Cupón: Plus $499 − $200 × 12 meses
  - **Verificar:** los 12 pagos cobran $299 y el 13º $499; `applied_periods` llega a 12.
  - **Depende de:** F7-ADMIN-05 · **Estimación:** 1.5 h

- [x] **F7-E2E-06** *(cerrada el 2026-08-28 — `billing-admin-isolation.e2e-spec.ts`, 10 casos; las cuatro llaves probadas una por una)* — Aislamiento del backoffice
  - **Verificar:** el admin lee suscripciones de 2 tenants y **0 ventas** de un tenant ajeno desde el mismo contexto.
  - **Depende de:** F7-DB-05 · **Estimación:** 1.5 h

### Módulo F7-DOC — documentación

- [x] **F7-DOC-01** *(cerrada el 2026-08-28 — README escrito con runbook completo y sección de Stripe; queda tu revisión, que es el criterio de Verificar)* — README del módulo billing + runbook de Carlos
  - **Salida:** `apps/api/src/modules/billing/README.md`: máquina de estados, modelo de datos, runbook del dueño (registrar un pago, anularlo, dar un cupón, correr el cron a mano, dar de alta un Premium con `custom_price`) y la sección del enchufe de Stripe (qué columnas ya existen, qué falta).
  - **Verificar:** revisado por Carlos.
  - **Depende de:** F7-E2E-06 · **Estimación:** 2.5 h

### Pospuestos de la Fase 7 (con nombre y razón)

- **Integración Stripe (pasarela automática)** — pospuesta por decisión de Carlos (2026-08-27): con 2-3 clientes fundadores el cobro manual cuesta minutos al mes; la pasarela son ~2 semanas de integración. **El enchufe queda listo**: `plans.gateway_product_id`/`gateway_price_*_id`, `tenant_subscriptions.gateway/gateway_customer_id/gateway_subscription_id`, `subscription_payments.gateway/gateway_reference/external_id` con su UNIQUE parcial (la idempotencia del webhook ya vive en la DB), y el período se calcula SIEMPRE en `recordPayment()` — el webhook de Stripe será un caller más de ese método con `gateway='stripe'`. Faltará: `StripeAdapter`, `POST /webhooks/stripe`, tabla `webhook_events` y el flujo de tarjeta en el front (Stripe Elements). El MCP oficial de Stripe se instala cuando esa sub-fase abra.
- **Impuestos y facturación fiscal por país** — decisión de Carlos (2026-08-27): manual mientras el volumen sea chico; se integra al crecer. Cubre los tres mercados: **México** CFDI 4.0 vía Facturapi (los competidores lo cobran como diferenciador — SICOVI por timbres — y SellPointy compite por precio mientras tanto); **EE.UU.** sales tax por estado (el umbral de *economic nexus* — típicamente $100k o 200 transacciones POR estado — está lejos con pocos clientes; al crecer, Stripe Tax lo resuelve junto con la pasarela); **Canadá** GST/HST federal (registro obligatorio al superar $30,000 CAD en 4 trimestres — antes de eso, small supplier sin obligación). Mientras tanto: los recibos son los registros de `subscription_payments` y cualquier factura que pida un cliente se emite a mano.
- **Apilar cupones** — un solo descuento activo por tenant (UNIQUE parcial); si algún día hace falta, se dropea el índice y se agrega orden de aplicación sin cambiar el modelo.
- **Contador exacto del límite diario bajo concurrencia** — el off-by-one del `COUNT` es aceptable para un tier gratuito; el refinamiento exacto (serializar con `nextSequenceValue` del día) queda documentado por si aparece contención.

---

**Estimación total Fase 7:** ~47 tareas, ~100 h ≈ **3 semanas** de trabajo enfocado.

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

> **Nota:** la cafetería (cliente **comprometido**) NO está en Fase 9 — productos compuestos + composición/BOM + stock decimal son **parte del core desde Fase 2** (ver [ARQUITECTURA.md § 3.5](ARQUITECTURA.md#35-modelo-de-productos-unidades-presentaciones-y-composición-bom)). El add-on F9-GASTRO-PRO de abajo es **gastronomía avanzada** (KDS, modificadores, control por turno) — NO el core.

### 9.0 Layouts por rubro (plantillas de campos sugeridas)

> **Diferido desde F2 por la LEY de genericidad (Carlos, 2026-08-16):** el motor de catálogos es agnóstico del rubro y **nada de negocio específico vive en la base de datos**. Los Layouts son azúcar sintáctica sobre ese motor: un catálogo de **sugerencias** que, si el tenant las acepta, se convierten en `catalog_fields` normales — indistinguibles de los que él hubiera creado a mano. Se construyen al final, cuando haya suficientes clientes reales para saber qué campos usa cada rubro de verdad en vez de inventarlos.

- **F9-LAYOUT-DEF** — Catálogo de layouts como **datos**, no como código de negocio: cada layout es una lista de campos sugeridos (etiqueta, tipo, requerido) versionada fuera del schema del producto. Ningún nombre de rubro entra en migraciones ni en constantes del API.
- **F9-LAYOUT-APPLY** — Endpoint que aplica un layout creando `catalog_fields` en el catálogo elegido, idempotente y sin pisar campos existentes. Aplicar es opcional y reversible (los campos se archivan como cualquier otro).
- **F9-LAYOUT-UI** — Galería de layouts con preview de los campos que agregaría, disponible desde el editor de campos y desde el wizard. `Tenant.templateChoice` (registrado desde F1) preselecciona la sugerencia.

### 9.1 Add-on genérico — Cotizador / Pedidos

> **⚡ ADELANTADO A F4 (2026-08-20):** el núcleo de la cotización —tabla con folio `COT`, API, pantalla tipo venta, ticket y `QuoteLookup` en el POS— vive ahora en **F4-DB-02, F4-QUOTE-01..04 y F4-TICKET-01**, por el caso de recepción-antes-de-caja de Carlos. Con dos simplificaciones sobre lo planeado acá: **sin vigencia ni estados `sent/approved/rejected/expired`** (la cotización no congela precios — al cargarla en el POS se recalculan del catálogo vigente) y **sin `customer_id`** (los clientes llegan en su fase). Lo que QUEDA para F9 de esta sección: la **vista pública compartible** (link por email/WhatsApp para que el cliente apruebe) como `F9-QUOTE-SHARE`, y reconsiderar estados de aprobación si un vertical los pide.

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
1. **F4-DB** reserva la FK nullable `Sale.clinical_document_id` (la de `quote_id` ya quedó ACTIVA: la cotización se adelantó a F4)
2. **F4-CART** diseña el input con strategy pattern — hecho: `QuoteLookup` ya es una strategy real, `PrescriptionLookup` de F9 es una más
3. **F7-STRIPE** maneja `subscription_items` en lugar de un solo `subscription_price`

Las 3 previsiones son baratas si se anticipan; caras si se omiten. La primera ya se cobró: adelantar la cotización a F4 costó cuatro tareas, no un refactor.

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
- **2026-08-12 (CIERRE)** — **`sdd/f1-rbac` ARCHIVADO**: PermissionsGuard + @RequirePermissions, CRUD usuarios/roles, GET /permissions, matriz RBAC, 6/6 tareas [x], desplegado en producción (system.laradoc.com, runs 31635548570→31637331174). **4 batches:** B1-2 (commits 3562607+33ddeac+e774645: guard+decorator+CRUD, 122/122 e2e), B3 (commit f393275: fix W1 acuñación + W2 lockout, 295 unit + 122 e2e), B4 (commits 44c147c+ff3c2d3: fix W1b asignación + W4 flaky + testTimeout, 304 unit + 126 e2e ✅ 2× sin flake). **Verify 3 pasadas:** P1 (PASS_WITH_WARNINGS, W1+W2 hallados), P2 (W1/W2 muertos, W1b+W4 hallados), P3 (W1b/W4 muertos, PASS). Decisiones LEY: (a) nadie acuña permiso no poseído (RolesService guard), (b) nadie asigna rol no poseído (role-assignment-guard), (c) lockout último admin bloqueado (409), (d) perm-epoch:{tenantId}/{userId} SIN TTL Redis, (e) tests NO asserten tamaño catálogo, (f) validar DELTA no diferencia. **Gates pre-primer-usuario (heredado):** W3 (F1-RBAC popula permissions cierra f1-auth gate), S1 (flujo aceptación invitación hereda a F1-WEB-AUTH). **Backlog NO bloqueante:** S2 (granularidad epoch, diferida), S3 (RLS pivot en F2+, heredado). Commits: 3562607 (B1-RBAC-01/02), 33ddeac+e774645 (B2-RBAC-03..06), f393275 (B3 W1/W2), 44c147c+ff3c2d3 (B4 W1b/W4). — `topic_key: sdd/f1-rbac/archive-report` (#276) — afecta: F1-TENANT (hereda validaciones escalada), F1-WEB-AUTH (hereda UI gestión usuarios/roles), F1-LOCALE (hereda i18n de permisos/roles), F2+ (hereda granularidad epoch + RLS pivot)
- **2026-08-13 (CIERRE)** — **`sdd/f1-scope` ARCHIVADO — ÚLTIMO MÓDULO BACKEND DE FASE 1**: modelo `UserWarehouseScope` (PK compuesta user_id+warehouse_id, warehouse_id SIN FK hasta F2), RLS ENABLE+FORCE con policy `tenant_isolation` patrón NULLIF, `WarehouseScopeInterceptor` (reemplazo crítico de middleware tras descubrimiento adversarial), decorator `@CurrentUserScope()`, 4/4 tareas [x]. **Historia:** F1-SCOPE-01/02 impecables (migration + RLS verificadas en producción), F1-SCOPE-03 original usaba middleware decodificando JWT SIN verificar firma (corría ANTES de guards) → verify P1 descubrió 2 CRITICAL en combinación: V3 anónimo con tenantId ajeno abría contexto RLS ajeno + fuerza trabajo DB inmune a throttler (AD-7 roto); V2 token forjado en @Public() dejaba scope atacante-controlado. **Remediación crítica (commit 779982d):** middleware → interceptor (corre DESPUÉS de guards, lee `req.user` verificado RS256+epoch). Estructura del pipeline Nest: middleware → guards (JwtAuthGuard) → **interceptores** → pipes → handler. Trabajo DB queda detrás de throttler, rutas @Public() sin scope poblado porque JwtAuthGuard retorna temprano sin poblar req.user. **Verify 2 pasadas:** P1 FAIL (2 CRITICAL, 4 WARNING), P2 PASS_WITH_WARNINGS (C1+C2 MUERTOS, 0 CRITICAL, 2 WARNING residuales). **Decisiones LEY:** (a) middleware ≠ interceptor es decisión de seguridad de Nest — NADA de identity/authz en middleware, solo observabilidad; (b) JwtAuthGuard ÚNICO escritor de req.user — invariante defendible vía grep; (c) bypass TenantAdmin por catálogo de permisos, no rol — fuente de verdad; (d) fail-closed a [], NUNCA 'all' — bloqueado por tests; (e) comentarios cuentan la verdad (auditoría de honestidad completada, 5/5 claims del docblock verificados). **E2E:** 6 tests nuevos de regresión (cross-tenant, @Public() scope, fail-closed, bypass real, caminos felices TenantAdmin+normal con tokens REALES). **Backlog F2 (NO bloqueante):** S3 resolución lazy (ahora eager por request autenticado, cero consumidores hoy), S4 FK warehouse_id→warehouses cuando tabla exista, S5/S6/S7 documentación/invariantes nombradas. **Producción:** desplegado sin incidentes (run 31747461614 SUCCESS, health 200). **Impacto fase actual:** con F1-SCOPE cerrado, BACKEND de Fase 1 queda COMPLETO — F1-DB 10/10, F1-LOCALE-backend 7/9, F1-TENANT 3/3, F1-AUTH 16/16, F1-RBAC 6/6, **F1-SCOPE 4/4**. Resta: F1-WEB-AUTH, F1-WEB-USERS, F1-WEB-ONBOARD (3 módulos UI; F1-LOCALE-07/08 se completan DENTRO de esos módulos: selector de moneda en F1-WEB-ONBOARD, selector de idioma en la página de perfil). Commits: 4258818 (U1-U4), 779982d (remediación C1+C2), 9c4cc9b (S5+S6). — `topic_key: sdd/f1-scope/archive-report` (#297) — hereda: F2-SCOPE (cablear con almacenes reales), F2-WARE/PROD/PRESENT/BOM (RLS pattern NULLIF + FORCE verificado)
- **2026-08-13** — **Identidad visual + SISTEMA DE TEMAS MULTI-MARCA (arranque de F1-WEB-AUTH)**: Carlos eligió la dirección **A · Cobalto** (azul profesional manda, verde reservado para venta/dinero, fondo `#f4f6fb` no-blanco, esquinas 8px) entre 3 propuestas comparadas con componentes reales. **Pero el pedido de fondo fue arquitectónico**: que un CLIENTE pueda elegir su tema y la plataforma se pinte para él. Implementado como **dos ejes ortogonales**: (1) **marca** = `data-brand` en `<html>`, la elige el TENANT en su config; (2) **modo** claro/oscuro = clase `.dark`, lo elige el USUARIO. Se combinan (`[data-brand="menta"].dark`). Las **3 marcas quedaron implementadas** (cobalto default, menta, teal) en claro y oscuro — un sistema de temas con una sola marca no está probado, con tres sí. **Decisiones LEY**: (a) los tokens **semánticos** (`--success`/`--warning`) viven FUERA de los bloques de marca: elegir tema no puede volver un error indistinguible de un éxito, y un test lo impide; (b) `:root` trae cobalto completo → sin JS o sin `data-brand` la app nunca aparece sin estilos; (c) `resolveBrand()` es fail-safe: una marca inválida (config corrupta, marca borrada del catálogo) cae al default en vez de romper; (d) consecuencia del login por email global (f1-auth): **el login NO puede conocer la marca del tenant** (no sabemos quién es hasta autenticar) → siempre se pinta con la marca de plataforma y la del tenant se aplica DESPUÉS del login. **Guardarraíl**: `brands.test.ts` lee el CSS y FALLA en CI si una marca declarada en TS no tiene sus bloques de tokens (claro Y oscuro) o si le faltan los tokens estructurales — agregar una marca a medias es imposible de mergear. **Agregar una marca nueva = 3 pasos** documentados en `lib/theme/brands.ts`. **PENDIENTE de backend** (cuando se necesite): columna `tenants.theme` (CHECK con los ids del catálogo, default `cobalto`) + exponerla en el bootstrap de sesión + `applyBrand(tenant.theme)` tras el login; el frontend ya está listo y no se toca. Archivos: `apps/web/src/index.css` (bloques de marca), `lib/theme/{brands,apply-brand}.ts`, `lib/theme/brands.test.ts`, i18n `theme.*` en es/en. — `topic_key: sdd/f1-web-auth/decisions-carlos` — afecta: F1-WEB-AUTH (todas las pantallas nacen con estos tokens), F1-WEB-ONBOARD (selector de tema en la config del tenant), F2+ (cualquier UI nueva hereda el sistema)
- **2026-08-14 (CIERRE DE GAP)** — **Gap S1 CERRADO: flujo de aceptación de invitación**. `POST /users` creaba un usuario `invited` sin password y **sin mandar ningún mail** — el empleado dado de alta no tenía NINGUNA forma de entrar, y el CRUD administrativo de F1-RBAC no era usable de punta a punta (por eso el verificador de f1-rbac lo marcó bloqueante y trabajó con usuarios `active` como parche). **Decisión: REUSAR el flujo de reset de password en vez de inventar un mecanismo nuevo.** El invitado necesita exactamente las dos cosas que reset ya hace y ya tiene auditadas — probar control del email Y definir una password — mientras que verify-email solo activa y lo dejaría `active` SIN password (el mismo callejón sin salida, corrido de lugar). Implementación: (1) `UserInvitationService` emite un **`PasswordResetToken` real** (misma tabla, mismo `OneTimeTokenService`, mismas invariantes: solo hash en DB, un solo uso, mensajes indistinguibles) **con TTL de 7 días** en vez de 30 min — una invitación no la lee nadie en media hora; es SOLO un `expiresAt` distinto, cero cambios de schema; (2) template de mail nuevo `invite-user` (es/en) apuntando a `{APP_URL}/accept-invitation?token=…`, best-effort post-commit (AD-9: un fallo de Resend no rompe el alta); (3) página web `/accept-invitation` que canjea contra el endpoint **existente** `POST /auth/reset-password`; (4) endpoint extra `POST /users/:id/resend-invitation` (`users:manage`, solo sobre `invited`) que invalida el link anterior antes de emitir el nuevo. **La pieza que hace que esto funcione sin código de canje nuevo ya existía y ahora está PROBADA end-to-end**: `AuthService.resetPassword` promueve `invited → active` y setea `emailVerifiedAt` (fix del "estado zombie", commit 474b183) — el e2e nuevo cubre el ciclo completo alta → mail → canje → login. **Decisiones LEY**: (a) TTL de invitación 7 días ≠ TTL de reset 30 min, misma tabla; (b) la invitación se emite SIEMPRE post-commit del alta, nunca dentro de la tx (`password_reset_tokens` no tiene RLS, AD-3); (c) `users -> auth` es dirección nueva de módulos y NO cierra ciclo — `AuthModule` exporta `AuthRepository`+`OneTimeTokenService` para que la emisión pase por el ÚNICO lugar con queries de auth en vez de duplicar SQL; (d) re-emitir invalida el link previo: nunca hay dos links canjeables a la vez; (e) `resend-invitation` es SOLO para `invited` (sobre un `active` sería un reset disfrazado que un admin podría dispararle a cualquiera; sobre un `suspended` reviviría un acceso cortado a propósito). **Verificación**: RED real demostrado deshabilitando el envío (6/7 e2e caen); 54 suites / 358 unit + 22 suites / 148 e2e + 12 files / 101 web, todo verde. **Pendiente NO bloqueante**: no hay UI donde poner el botón de reenvío hasta F1-WEB-USERS (endpoint listo); el mail no nombra al tenant ni a quien invita (evitaría una query extra, mejora de copy futura); el gate **W9** de f1-auth (SPF/DKIM sin verificar en Resend) sigue abierto y es lo único que separa esto de funcionar con usuarios reales. — `topic_key: sdd/f1-invitations/apply-progress` — cierra: S1 de `sdd/f1-rbac/archive-report`; afecta: F1-WEB-USERS (botón de reenvío), F1-WEB-ONBOARD (alta de equipo), F6 (W9 Resend)
- **2026-08-14 (CIERRE)** — **`sdd/f1-web-auth` ARCHIVADO — CIERRE DE TODA LA AUTENTICACIÓN DE PUNTA A PUNTA**: 11/11 tareas [x], desplegado en producción (system.laradoc.com, runs 31602735124→31832589187, 460 tests, 0 flake). **Historia honesta**: módulo construido verde (deploy U1 run 31602735124), pero uso real + dos verifies encontraron 8 problemas que los tests locales contra mocks no veían. **4 del usuario** (ruta mail `/verify` vs `/verify-email` linkada, throttle contando logins fallidos, alerta de certs Resend, token en logs nginx) + **4 de auditoría adversarial** (C1: caché React Query sin limpiar en logout, W2: nunca se mandaba Accept-Language, W5: 4 reintentos en cascada, W4: tokens en logs 7 días, S1: color crudo en home). **Remediación 2 batches:** Batch 1 (commits adc4507+b99b227+efb0739+f974d2e: C1+W2+W5+S1 muertos, Verify P1→P2 parcial) + Batch 2 (commits 8492779+2fff194: W4+W1+W6 nuevo, Verify P2 completa, PASS_WITH_WARNINGS). **Decisiones LEY**: (a) access token SOLO-MEMORIA verificado contra el bundle SERVIDO (no repo); (b) cerrar sesión con UN puerta (`clearAuth`), purga por cambio de `user.id` es suscripción, no tarea olvidable; (c) single-flight en refresh, React Query NO reintenta 4xx, N concurrentes → 1 POST; (d) links de mail con test guardián (`email-links.test.ts` falla en CI si ruta inexistente); (e) secretos en query = secretos en logs (3 vectores tapados nginx+pino, cierre DEFINITIVO pendiente: fragmento `#token=` en F1-WEB-ONBOARD); (f) auditar el ARTEFACTO SERVIDO no el repo (Tailwind escanea tests, el CSS que se sirve es la verdad); (g) arnés que aísla por construcción esconde bugs (C1 invisible 460 tests, `new QueryClient()` por render vs factory compartida app↔tests). **Números verificación P2:** C1/W2/W5/S1/W4 MUERTOS (5 hallazgos), W6 HALLADO (referer sin redactar en api), S6/S7/S8 SUGERENCIAS (purga overcaché, observadores sin desuscribir, `clearToken` trampa). **Commits batch 1:** adc4507 (C1), b99b227 (W2), efb0739 (S1), f974d2e (guardarraíl). **Commits batch 2:** 8492779 (W4), 2fff194 (W1). **Commit batch 3 (post-reverify):** 2b73049 — **W6 CERRADO** (redactar `referer`/`referrer` en pino, verificado en prod: token con Referer → 0 apariciones en el log de la api) y **S8 CERRADO** (eliminado el `clearToken` sin llamadores que revivía C1 en silencio; ahora `clearAuth` es la única puerta, con test que lo fija). **Números:** 137/137 tests web + API build verde, health 200, smoke OK. **Backlog NO bloqueante remanente:** W3 heredado (i18next no sincroniza con `user.locale` al bootear — 1 línea, pertenece al backlog de f1-auth), S2 (ErrorBoundary i18n), S3 (401 esperado del bootstrap ensucia la consola), S4 (`/verify-email` no navega tras el éxito → token queda en la barra), S5 (un test detecta por OOM en vez de assertion), **S6 (purga overcaché en ProtectedRoute — el que MÁS escala mal hacia F1-WEB-USERS)**, S7 (`watchSessionIdentity` nunca se desuscribe), y el residual de W2 (claim `locale` del JWT gana sobre el header en requests autenticadas hasta el próximo refresh). **Cierre arquitectónico pendiente de la clase "secreto en URL": llevar el token a fragmento `#token=` (que el navegador NUNCA manda al server) — se hace al implementar el flujo real de invitaciones en F1-WEB-ONBOARD.** **Impacto**: TODA la autenticación backend+frontend de punta a punta queda CERRADA. Resta Fase 1: F1-WEB-USERS (2 módulos UI: lista+editor usuarios, gestión roles) y F1-WEB-ONBOARD (wizard multi-step + invitación). Commits backend (fondo): 0b53a6e (temas), 871c7e3 (interceptor), a13c0ba (shell), 2b92546 (profile), 7f290f1 (ruta mail), 7db8311+dc376fd (throttle), 442ddfa (certs). — `topic_key: sdd/f1-web-auth/archive-report` (#321) — cierra: autenticación completa (backend+frontend); afecta: F1-WEB-USERS (hereda ProtectedRoute, layout), F1-WEB-ONBOARD (hereda temas, invitaciones), F2+ (hereda tokens semánticos, i18n, UI patterns)
- **2026-08-14 (CIERRE)** — **`sdd/f1-web-users` ARCHIVADO — GESTIÓN DE USUARIOS Y ROLES EN FRONTEND**: 5/5 tareas [x] (listado, alta/edición, menú acciones, editor roles, resync sesión), 16 commits en main listos para deploy (push pendiente al cierre de esta entrada). **Historia honesta**: módulo armado verde en 4 batches (apply-progress #333), pero verify-report (pasada 1) encontró **1 CRITICAL + 5 WARNING**. **C1**: `UserForm` sin `key` → editar Ana, luego Beto sin cerrar reasignaba los roles de Ana a Beto (cambio de privilegios sobre sujeto equivocado, UI silenciosa). **W1-W5**: roles:read faltante en alta, i18n untested, 3 acciones sin feedback, tooltip invisible Firefox/Safari + userCount oculto, resyncSession sin .catch(). **Remediación 2 ciclos:** Pasada 1→2: 8 commits (a37e8ab→3d943b2: C1+W1-W5+S2 MUERTOS con RED→GREEN estricto, introducido W6 por S2 remedial) → Pasada 2: 1 commit (64c14d4: W6 muerto, 2 tests nuevos) → Pasada 3: PASS_WITH_WARNINGS (0 CRITICAL, 0 WARNING, 5 SUGGESTION). **Decisiones LEY**: (a) nav por `:read`, acciones por `:manage` (rechazo: todo con `:manage`); (b) estado espejo (useForm, nameDraft) se resiembra en TODO punto que cambia la entidad, no solo en el handler obvio — lección de arquitectura para F1-WEB-ONBOARD y F2+; (c) resync sesión en hook, no container (consecuencia, no tarea olvidable); (d) mapeo por code, nunca índice (previene silencios escalada); (e) asimetría deliberada del disabled: agregar es restrictivo, quitar es gratis (diferencia vs API); (f) fix opcional en batch remediación merece auditoría completa (S2 en remediación del W1 introdujo W6). **Números:** 234/235 tests verdes (26 files), pnpm build 4/4, biome limpio. 16 commits (7 del módulo + 8 de remediación P1 + 1 de W6). **Backlog SUGGESTION (NO bloqueante):** S1 (códigos crudos), S3 (aserción vacua test), S4 (asimetría baseline), S5 (conserva selección post-409), S6 (i18n muerta editAction). **Impacto Fase 1:** con F1-WEB-USERS cerrado, FRONTEND queda COMPLETO (11 módulos de 12). Resta solo F1-WEB-ONBOARD. — `topic_key: sdd/f1-web-users/archive-report` (#343) — cierra: gestión usuario-rol punta a punta; hereda: F1-WEB-ONBOARD (lecciones arquitectónicas, purga overcaché S6 de f1-auth), F2+ (patrón estado espejo, Strict TDD, build = suite+tipos+linter)
- **2026-08-15 (CIERRE)** — **`sdd/f1-web-onboard` ARCHIVADO — WIZARD DE ONBOARDING, ÚLTIMO MÓDULO DE FASE 1**: 5/5 tareas del tablero [x] (datos del negocio+moneda, plantilla, almacén placeholder, invitar multi-fila, finalizar) + D3 (`#token=` en fragmento, cierre arquitectónico diferido de f1-web-auth) completo, 14 commits en main listos para deploy (push pendiente al cierre de esta entrada). **No era frontend puro**: requirió migración Prisma (`address`, `template_choice`) + módulo HTTP `tenants` nuevo (el guard de moneda de F1-LOCALE-06 estaba construido y huérfano) + permiso `tenants:manage` + extender `GET /me` **y** `POST /auth/login` con bloque `tenant` (dos emisores del store, no uno — lección de #350). **Historia honesta**: verify pasada 1 = FAIL (**C1 CRITICAL**: wizard accesible sin `tenants:manage`; **W1-W5**: no retoma paso derivado, resync fallido mudo, invitaciones indexadas por posición, `warehouseStepSeen` contradice la spec literal, "N invitaciones→N mails" sin probar en su frontera). Pasada 1 también **desmintió un claim obsoleto del apply** (3 suites Prisma "rotas por entorno" — corrían perfectas con DB real). **Remediación 3 commits** (`d705905` C1+W1+W2+W3, `9d20f14` W4 REVERTIDO con `prisma migrate diff` confirmando cero drift en dev, `c5d0475` W5) → **Pasada 2: PASS_WITH_WARNINGS**, los 6 hallazgos MUERTOS (repros re-ejecutados + contraprueba de revertir cada fix y ver su test fallar), 27/27 escenarios de la spec, **1 hallazgo nuevo N1** (la mitad del fix de W1 en el gate no tenía test propio — revertirla dejaba 27 pruebas verdes) → **cerrado en `98b991c`** con RED verificado empíricamente (se reintrodujo el bug, el test nuevo falló, se restauró byte-idéntico, volvió a GREEN). **Decisiones LEY**: (a) el bloque `tenant` va en `GET /me` Y en `POST /auth/login`, mismo shape — un solo emisor deja al gate ciego tras login en caliente; (b) `OnboardingGate` compuesto DENTRO de `ProtectedRoute` (no ruta ni `beforeLoad`) — el loop es imposible por construcción, la ruta destino no monta el gate; (c) el paso del wizard SIEMPRE se deriva de los datos del tenant, nunca de estado en memoria/localStorage; (d) `#token=` con fallback `?token=` OBLIGATORIO por 7 días (TTL de invitación) — deuda con fecha, no indefinida (**DEFER.1**); (e) tenants pre-existentes en producción SÍ pasan por el wizard en su próximo login (rechazada la migración de exención); (f) un fix con dos mitades necesita guardián en las dos (N1). **Números:** web 307/1 skip (34 suites), api unit 367 (55 suites), api e2e 161 (23 suites), tsc limpio ambos, Biome limpio. **Backlog SUGGESTION (NO bloqueante):** S1-S6 (guardián con paths hardcodeados, código muerto `getMyTenant()`, sin pantalla "paso 5" real, guard de shapes sin `/tenants/me`, impacto de deploy ya decidido, rollback manual de `tenants:manage`) + **DEFER.1** (retirar fallback `?token=`, fecha exacta la estampa el orquestador al deployar). **Impacto: con F1-WEB-ONBOARD cerrado, FASE 1 QUEDA COMPLETA — 12/12 módulos.** Siguiente: push/deploy (decisión del orquestador) y luego atomización de Fase 2 (Catálogos Dinámicos). — `topic_key: sdd/f1-web-onboard/archive-report` — cierra: Fase 1 completa; hereda: Fase 2 (patrón estado espejo, permisos por catálogo nunca por rol, gate por construcción no por condicional, deuda con fecha para deprecaciones)

---

- **2026-08-16 (ATOMIZACIÓN F2)** — **Fase 2 atomizada: motor de catálogos dinámicos** (12 módulos, 55 tareas). Pedido de Carlos: catálogos genéricos por tenant — Catálogo de Productos (principal, obligatorio, campos estándar no eliminables) + subcatálogos con la misma arquitectura, campos Texto/Numérico/**Lookup** entre catálogos por Código único. Decisiones de Carlos: (a) **precio/costo en `product_presentations`** con auto-presentación «Unidad ×1» desde el form de producto (una fuente de verdad, misma interfaz); (b) **editor de campos simple con guardas** en lugar del versionado v1/v2 de CU-CAT-01 (diferido); (c) las "relaciones entre productos" (1 kg azúcar → 50 cafés) son el BOM, capturadas por porción con "alcanza para N" calculado en vivo. Decisiones técnicas: productos siguen en tabla de primera clase (F3/F4/F5 le cuelgan FKs) compartiendo el motor de campos con los subcatálogos; **sin Ajv** (validador puro derivado de `catalog_fields`); lookup guarda id, muestra código; permisos `catalogs:read/write/manage` + `warehouses:read/manage` + `products:*` a producción; interceptor de scope pasa al default permisivo documentado; racks, imágenes (R2), import async y versionado quedan FUERA con nota. ARQUITECTURA §3.3 reescrita (muere JSONB+JSON Schema draft-07 como contrato; JSONB queda como storage), CU-CAT-01/VISTAS/FLUJOS sincronizados. — `topic_key: sellpoint/f2-atomizacion` — afecta: toda la Fase 2; hereda a F3 (StockByWarehouse nace acá en 0), F4 (POS lee precio de presentación default)

- **2026-08-16 (DEUDA)** — **Hueco de verificación de tipos en los TESTS del API → F6-TYPECHECK-TESTS.** Dos deploys en rojo seguidos (F2-CAT y el cierre de F2) por errores triviales que ningún gate local cazaba. La causa raíz eran DOS agujeros distintos: en `apps/api`, `tsconfig.build.json` excluye los `.spec.ts` y `ts-jest` transpila sin verificar tipos (`isolatedModules`); en `apps/web`, el `tsconfig.json` tiene `"files": []` y solo referencias, así que el `tsc --noEmit` que se venía corriendo como verificación **no chequeaba nada — pasaba en vacío**. Ambos paquetes tienen ahora `pnpm typecheck` con el mismo nombre y el mismo alcance que CI (`tsc -p tsconfig.build.json --noEmit` en api, `tsc -b` en web), verificados con contraprueba: se reintrodujo cada bug y los dos gates lo detectaron. Queda abierta la deuda de los TESTS del api (`pnpm typecheck:full`, 26 errores preexistentes) — ver F6-TYPECHECK-TESTS para el desglose. — `topic_key: sellpoint/typecheck-gap` — afecta: F6 (nueva tarea), método de verificación de toda fase futura

- **2026-08-16 (CIERRE)** — **FASE 2 COMPLETA — 55/55 tareas**, motor de catálogos dinámicos de punta a punta. Backend: 8 tablas con RLS, 7 permisos, motor de catálogos/campos/registros con lookups, productos con presentaciones y composición, almacenes, importación e alcance por almacén. Frontend: editor de campos, subcatálogos, productos con sus tres pestañas, almacenes y wizard de onboarding real. **Decisiones tomadas durante la ejecución autónoma** (Carlos pidió cerrar F2 sin consultas): (a) **la importación es CSV con BOM UTF-8, no .xlsx binario** — Excel lo abre y guarda nativo, la experiencia del usuario es idéntica y evita una dependencia de parseo binario; si un cliente exige xlsx real se cambia solo el serializador porque el service trabaja con filas, no con archivos; (b) el archivo viaja como TEXTO en el body JSON en vez de multipart, y el límite del body parser subió a 6 MB para que el 413 lo dé la regla de negocio (5 MB) y no un error crudo del parser; (c) **F2-SCOPE-01 invirtió el default del interceptor**: sin filas de alcance el usuario ve TODOS los almacenes (ARQUITECTURA § 3.4) — el fail-closed a `[]` de F1 era correcto cuando no existían almacenes, pero hoy dejaría a un tenant chico sin ver su propio inventario; el fail-closed del `catch` sigue en `[]`; (d) el paso 2 del onboarding **dejó de ofrecer rubros** y pasa a definir campos propios (LEY de genericidad), con `templateChoice` degradado a marca de "pasó por acá". **Hallazgos durante la ejecución:** un hook agregado después de un `return` temprano rompió el orden de hooks (lo cazó el test de la ruta); el `AuthUser` no tiene `id` sino `userId` y el deploy quedó en rojo porque los `.spec.ts` no los verifica NADIE (`tsconfig.build.json` los excluye y ts-jest transpila sin chequear por `isolatedModules`) → se agregó `pnpm typecheck` como gate local y `pnpm typecheck:full` que revela 26 errores preexistentes en tests viejos. **Números:** 444 unit API + 216 e2e API + 401 web + 41 shared. — `topic_key: sellpoint/f2-cierre` — cierra: Fase 2; hereda: F3 (StockByWarehouse nace en 0 y espera movimientos; la validación de fracciones por presentación ya tiene su flag), F4 (el POS lee precio de la presentación default y expande composición), Fase 9.0 (Layouts por rubro)

- **2026-08-16 (LEY DE GENERICIDAD)** — **El producto es agnóstico del rubro; ningún negocio específico vive en la base de datos.** Corrección de Carlos sobre la atomización de F2 recién hecha, disparada por leer `F2-BOM-03 — UI tab Receta`: *"no sólo serán negocios de farmacia, comida o cafeterías, deben ser todo tipo de negocios que cuenten con inventario y venta de productos"*. Dos problemas de distinto peso, ambos cerrados: **(1) vocabulario de comida fosilizándose en el modelo** — la columna era `ingredient_product_id` y la UI decía "Receta"/"Ingrediente"/"porciones"; ahora es **`component_product_id`** y el vocabulario es **composición / componente / unidades armables** en todo el core (F2, F3 y F4 alineados; el add-on F9-GASTRO conserva vocabulario gastronómico porque ESE sí es el vertical de comida, y las "recetas médica/oftalmológica" de F9 son otro concepto). **(2) el problema real: `F2-ONBOARD-01` sembraba `catalog_fields` de pharmacy/hardware/grocery definidos en el API** — exactamente lo que la ley prohíbe. Se reemplazó por "el paso 2 permite definir los campos propios (o dejarlo para después)"; `Tenant.templateChoice` se sigue registrando como preferencia pero **no siembra nada**. Las **plantillas por rubro (Layouts)** se difirieron a **Fase 9.0** como catálogo de *sugerencias* que el tenant acepta o no, para construirlas cuando haya clientes reales que digan qué campos usa cada giro en vez de inventarlos. La Definición de Fase 2 completa incorpora un criterio **verificable por grep** (ningún rubro nombrado en `apps/api` ni `apps/web/src`). Sincronizados los cinco `.md`: ARQUITECTURA (DDL, glosario, reglas, UX), CASOS_DE_USO (CU-AUTH-02, CU-CAT-06/07), VISTAS (paso 2 del wizard, tab Composición con ejemplo de óptica), FLUJOS (paso 2). — `topic_key: sellpoint/f2-ley-genericidad` — afecta: toda la Fase 2 (vocabulario y F2-ONBOARD-01/02), F3 y F4 (outlines realineados), F9.0 (Layouts, nuevo)

- **2026-08-16 (F2-IMPORT-05)** — **La importación pasó a ser UPSERT porque la plantilla ahora trae los productos existentes.** Pedido de Carlos: aceptar `.xlsx`, que la plantilla traiga lo ya dado de alta y que el "Choose file" sea un botón. Lo primero fue mecánico —la decisión (a) del cierre de F2 anticipaba que sumar xlsx era cambiar el serializador, y así fue: nació `products/spreadsheet.ts` (`exceljs`, xlsx en base64 dentro del mismo JSON, encabezado en negrita y congelado) sin tocar una línea del validador—. **Lo segundo obligó a una decisión de negocio**: si la plantilla trae los 400 productos del tenant, volver a subirla fallaría en las 400 filas por SKU repetido, así que un SKU existente ahora **actualiza** (nombre, unidad, stock mínimo, atributos y el precio/costo de su presentación default) en vez de dar 409. El SKU es la LLAVE, nunca se pisa. El reporte gana `created`/`updated` y la UI los muestra ANTES de confirmar: "245 válidas" no dice nada si 200 de esas pisan productos ya cargados. El duplicado *dentro* del archivo sigue siendo error (dos filas con el mismo SKU es una planilla mal armada, no una intención). El límite de 5 MB se mide sobre el contenido **decodificado**, porque en base64 un archivo pesa ~33% más y el límite terminaría siendo otro del que dice ser. Un xlsx corrupto da 400, no 500. El control de archivo es el input nativo `sr-only` + un `<label>` con estilos de botón (`peer-focus-visible` para el teclado): sigue siendo el input real, porque un botón que *simule* abrir el diálogo no puede abrirlo. Detalle de TS: `exceljs` declara `interface Buffer extends ArrayBuffer` en el scope **global** y choca con `@types/node` — se resuelve casteando al tipo que pide el propio método, no a `any`. — `topic_key: sellpoint/f2-import-xlsx-upsert` — afecta: F2-IMPORT (01-04 revisados), F3 (los movimientos futuros heredan el upsert como forma de corrección masiva)

- **2026-08-16 (F2-IMPORT-06)** — **El id del subcatálogo no sale nunca de la máquina: la planilla habla en códigos.** Carlos abrió la plantilla y vio `5ed124f7-1e5e-42df-aadd-699106ec9f41` en la columna `proveedor`. El almacenamiento **no cambió** —`attributes` sigue guardando el **id**, que es lo correcto: es estable ante renombres, y guardar el código haría que renombrar `kg` rompiera todos los productos que lo usan—. Lo que cambió es que la **traducción vive en los bordes**: la plantilla escribe el `code` y la importación lo resuelve de vuelta al id. Decisiones del resolutor: (a) el índice `id ↔ código` se arma en **una sola query** por catálogo destino, porque resolver dentro del bucle convertiría un archivo de 400 filas en 400 queries; (b) solo registros **activos**, igual que el alta por formulario; (c) coincidencia exacta primero y, si no la hay, sin distinguir mayúsculas — escribir `KG` donde el catálogo dice `kg` es un typo, no la intención de crear otra cosa—, salvo que dos códigos colisionen al bajarlos (el `UNIQUE(catalog_id, code)` es sensible a la caja y permite que `kg` y `KG` convivan), en cuyo caso ese código exige coincidencia exacta; (d) un código inexistente falla **la fila**, con el campo señalado, y no el archivo entero; (e) al exportar, un id que ya no resuelve (registro borrado o inactivo) deja la celda **vacía** en vez de escribir el UUID: mostrar basura es peor, y volver a subirla lo reviviría. — `topic_key: sellpoint/f2-import-lookup-por-codigo` — afecta: F2-IMPORT, F2-CAT (el código es la llave visible que ya prometía el diseño)

- **2026-08-16 (F2-PROD-07)** — **Los importes admiten 2 decimales, y ahora se DICE en vez de redondear callado.** Pedido de Carlos. El motivo real no era cosmético: `price` y `cost` son `DECIMAL(14,2)`, así que hasta hoy mandar `15.555` guardaba `15.56` **sin avisarle a nadie** — el usuario descubría semanas después que su costo no era el que escribió. La regla (`hasValidMoneyScale` + `MONEY_DECIMALS`) vive en **`@sellpoint/shared`** y no en el API: entra por las dos puntas —el formulario avisa mientras se escribe, el backend rechaza— y tenerla dos veces es garantizar que un día se corrija en una sola. Se compara `Number(value.toFixed(2)) === value` y NO multiplicando por 100, porque `1.15 * 100` da `114.99999999999999` en IEEE-754 y la cuenta ingenua rechazaría un precio perfectamente válido (hay un test que lo fija); la ida y vuelta por string además atrapa la notación exponencial (`1e-7`), que no tiene punto pero sí decimales. En el API la regla entra por **cinco** puertas —alta y edición de producto, alta y edición de presentación, y la planilla— y por eso hay un único `moneyAmount()`: repetir el `refine` en cada DTO es asegurar que un día se corrija en tres de las cinco. En la importación es **error de fila** con el campo señalado, no rechazo del archivo: una división en Excel deja 12 decimales sin que nadie los vea, y nadie revisa 400 filas a ojo. **Hallazgos:** dos mensajes del backend salían CRUDOS en pantalla por faltarles la clave en el i18n del front (`products.composition_cycle` —el que Carlos fotografió— y el nuevo `products.too_many_decimals`); ambos traducidos. **Queda abierto:** `DECIMAL(14,2)` también topa la MAGNITUD en 999.999.999.999,99 y eso no está validado — un importe mayor todavía revienta con un error crudo de Postgres. — `topic_key: sellpoint/f2-escala-de-importes` — afecta: F2-PROD, F2-PRESENT, F2-IMPORT; hereda: F4 (el POS escribe importes en las mismas columnas y debe usar el mismo validador)

- **2026-08-16 (F2-SCHEMA, responsive)** — **Un ítem de grid tiene `min-width: auto` y por eso la tarjeta de Campos se salía de la pantalla en celular.** Carlos reportó con captura que en `/catalog/schema` la tarjeta "Campos" desbordaba el margen y los botones quedaban cortados. El layout no tenía la culpa (`app-layout` ya lleva `min-w-0 flex-1`): el culpable era el `grid` de las dos tarjetas. Un grid item **se niega a encoger por debajo del ancho mínimo de su contenido** salvo que se le diga `min-w-0`, así que en una pantalla angosta la columna se ensanchaba hasta que entrara la fila más ancha —el `<li>` con nombre del campo + "Editar" + "Quitar"— y arrastraba la tarjeta entera fuera del viewport. **Segundo defecto, más silencioso:** el `truncate` de la fila estaba aplicado sobre un contenedor `flex`, donde `text-overflow` NO tiene efecto; movido al `<span>` de texto, que es donde sirve. Se agregó además `flex-wrap` en la fila para que los botones bajen de línea antes que empujar, y en el header de la tarjeta. **Nota de verificación:** es un arreglo razonado sobre el modelo de caja de CSS, no medido en un dispositivo — jsdom no calcula layout, así que la suite no puede probarlo; confirmado visualmente por Carlos. — `topic_key: sellpoint/f2-schema-responsive` — afecta: F2-SCHEMA-01/02; aplica como patrón a toda tarjeta dentro de un `grid`

- **2026-08-16 (F2-I18N-ERRORES)** — **51 de 84 claves de error no tenían traducción: toda la Fase 2 nació sin i18n en el API.** Carlos fotografió `catalogs.field_required` pintado bajo un campo del formulario. Era la TERCERA clave cruda en dos días (antes `products.composition_cycle` y `products.too_many_decimals`), así que en vez de parchear la de turno se midió el hueco: los namespaces `catalogs`, `products` y `warehouses` **no existían** en `apps/api/src/i18n/{es,en}` — se crearon con las 50 claves reales, más `users.warehouse_scope_invalid`. **Dos defectos estructurales detrás, no uno:** (1) `AllExceptionsFilter` traducía SOLO `body.message` y dejaba crudo `body.errors[].message`, que es justamente lo que el formulario pinta bajo cada input —el caso de la foto—; ahora traduce ambos y agrega `code` con la clave cruda en cada error por campo, mismo contrato que ya tenía el mensaje general. (2) el **dry-run de importación responde 200**, así que su reporte NUNCA pasa por el filtro; se le inyectó `I18nService` a `ImportService` y el locale viaja desde el controller con `getLocale(request)`, porque la ley del proyecto (ver el docblock del filtro) es que **el backend traduce** —la infra i18n sirve a cualquier cliente del API, no solo a la SPA—. **El guardián:** `src/i18n/message-keys.spec.ts` escanea el código fuente en busca de `message: "clave"` y exige que cada una exista en TODOS los idiomas. Sin él esto no se puede atrapar: una clave sin traducir no rompe nada —el filtro devuelve la clave, los tests pasan— y solo se descubre mirando la app, que es la peor forma. El propio guardián se defiende de volverse verde por vacío (asegura que el escáner encuentre >50 claves). **Efecto en los tests:** 5 e2e aseveraban sobre `message` con la clave cruda; migrados a `code`, que es lo estable ahora que el texto se traduce. — `topic_key: sellpoint/f2-i18n-errores` — afecta: todo el API (contrato de error), F2-CAT, F2-PROD, F2-IMPORT, F2-WH; hereda: F3/F4 (toda clave nueva la exige el guardián)

- **2026-08-17 (F2-UOM)** — **El selector de unidad base muestra el NOMBRE y sigue guardando el código.** Carlos pidió que el desplegable dijera "Kilogramo" en vez de `kg`. Los nombres descriptivos **ya existían** —la tabla maestra `units` los sembró desde F2-DB-01 con `name_es`/`name_en`—, solo que nadie los hacía llegar al front, que armaba las opciones con `UNIT_CODES.map(code => ({ label: code }))`. Se descartó exponer un `GET /units`: son nueve filas que no cambian nunca y no justifican una request ni un estado de carga para pintar un `<select>`. Se agregaron `nameEs`/`nameEn` a `UNITS` en **`@sellpoint/shared`**, que ya era la fuente compartida de las unidades y ya tenía un test de contrato contra la DB —se **extendió ese contrato** a los nombres, así que si alguien cambia uno de los dos lados el test de integración falla nombrando cuál difiere—. En el front, `resolveUiLocale()` (nuevo, junto a `resolveUiLanguage`) acota el idioma de i18next al tipo `Locale` que piden los helpers de shared. Se aplicó también en la pestaña Composición (columna Unidad y el picker), donde el mismo código crudo ya había llamado la atención: dejar el select en "Onza" y la tabla en `oz` habría sido peor que no tocar nada. **Lo que NO cambió, a propósito:** lo que se guarda en `products.base_unit` y lo que viaja en la columna `unidad_base` de la planilla siguen siendo el CÓDIGO — es un identificador, y traducirlo rompería la importación. — `topic_key: sellpoint/f2-uom-nombres-descriptivos` — afecta: F2-PROD-05, F2-BOM-03, F2-UOM-01; hereda: F3/F4 (toda pantalla que muestre una unidad usa `unitName`)

- **2026-08-17 (VALIDACIÓN DESCRIPTIVA)** — **El guardián de claves tenía un punto ciego, y "datos inválidos" no es un mensaje.** Carlos escribió `1000` en Merma % (que admite hasta 100) y recibió `products.invalid_body` crudo. **Dos problemas:** (1) la clave escapó al guardián de ayer porque **no se emite con `message:` sino como ARGUMENTO del constructor** de `ZodValidationPipe`; el escáner ahora tiene dos patrones y encontró 10 claves más de este canal, de las cuales 4 no existían. (2) Más de fondo: aunque estuviera traducida, "Los datos enviados no son válidos" **no dice qué campo ni por qué**. Ahora el pipe devuelve `errors: [{ key, message, args }]` con una entrada por campo malo: `key` es la RUTA completa (`lines.0.wastePercentage`) para que el formulario sepa qué fila pintar, y el texto sale interpolado ("Debe ser 100 o menos"). El mapeo de issues de Zod a claves **no es 1 a 1 a propósito**: `too_big` se abre en cuatro según `origin` e `inclusive`, porque "máximo 500 caracteres" y "debe ser 100 o menos" son la misma condición para Zod y dos frases distintas para quien llena el formulario; `invalid_type` se traduce como "falta este dato" y no habla de tipos, porque un usuario de POS no sabe qué es un `number`. **Gotchas encontrados por los tests:** (a) nestjs-i18n interpola con **una** llave (`{max}`), no con dos —el e2e devolvió el texto con el placeholder literal—; (b) el primer intento de test verificaba el inglés con `Accept-Language: en` en un request **autenticado**, donde el idioma sale del claim del JWT y no del header: habría pasado por el motivo equivocado, así que la verificación bilingüe se movió a una ruta sin auth. `args` se descarta del body al traducir: era insumo de la traducción, no información para el cliente. — `topic_key: sellpoint/validacion-descriptiva` — afecta: TODO endpoint con `ZodValidationPipe` (contrato de error); hereda: F3/F4

- **2026-08-17 (F2-PRESENT, etiquetas)** — **«Equivale en gr» pasó a «Equivale en gramos»: el plural es un DATO, no una regla.** Pedido de Carlos, continuación de los nombres descriptivos: las dos frases de la pestaña Presentaciones (la columna del factor y la ayuda de arriba) seguían interpolando el CÓDIGO de la unidad base. Se agregaron `namePluralEs`/`namePluralEn` a `UNITS` en `@sellpoint/shared` y `unitName()` tomó un tercer parámetro `{ plural }`. **Por qué el plural va escrito y no derivado:** en español "Unidad" hace "**Unidades**", no "Unidads" — cualquier `+ "s"` se rompe en la primera unidad del catálogo y produce texto que se lee mal delante de un cliente. Hay un test cuyo nombre lo dice explícitamente, para frenar a quien quiera "simplificarlo" a una regla. `unitName` devuelve el nombre **capitalizado** en singular y plural, y quien lo mete en medio de una oración lo baja a minúscula: la caja la decide la FRASE, no la unidad (el selector lo quiere capitalizado, la frase no). Los plurales viven solo en `shared` y no en la tabla `units`: la DB manda en la identidad y el API nunca muestra nombres de unidades, así que el contrato de integración sigue comparando lo que ambos lados tienen. Nace `presentations-tab.test.tsx` — los tests de `shared` probaban que el plural fuera correcto, pero nada probaba que la PANTALLA lo pasara; incluye el caso de una unidad desconocida, que cae al código en vez de dejar la frase coja. — `topic_key: sellpoint/f2-uom-nombres-descriptivos` — afecta: F2-PRESENT-02, F2-UOM-01

- **2026-08-17 (F2-PRESENT-05)** — **La tabla de presentaciones se podía mirar pero no operar; y el borrado real entra con condición.** Carlos reportó tres huecos: "Se compra"/"Se vende" eran un `✓` pintado, no se podía corregir una presentación mal cargada (su "Bolsa 2 kg" quedó con factor 1000) ni eliminarla. **Dos de los tres eran solo UI**: el `PATCH` ya aceptaba todos los campos desde F2-PRESENT-01. Los interruptores de compra y venta pasaron a checkboxes que guardan al instante —el mismo patrón que "Solo enteros", que ya estaba al lado— y el resto de la fila se edita con un modo explícito (botón Editar → inputs → Guardar/Cancelar). **Se descartó la edición que guarda al perder el foco**: acá hay precios, y un typo que se persiste solo sin confirmar es una venta mal cobrada. Vaciar el código de barras manda `null` explícito, porque si no no habría forma de quitar uno mal puesto. **El borrado sí exigía decisión, y Carlos eligió "borrar solo si nunca se usó"**: nace `DELETE /products/:id/presentations/:presentationId` (204) con tres guardas — la predeterminada y la última devuelven 409, y `assertDeletable()` queda como **punto único de extensión** para que F3 y F4 agreguen ahí el chequeo de movimientos y líneas de venta (hoy ninguna tabla referencia una presentación, así que no hay nada que verificar todavía; el método está vacío A PROPÓSITO y documentado). **Hallazgo del camino:** el API bloqueaba quitarle la marca de predeterminada a la única presentación default, pero **no bloqueaba desactivarla** — el mismo agujero por otra puerta, que dejaba al producto con una default inactiva y al POS de F4 sin saber qué ofrecer. Tapado, con su e2e. — `topic_key: sellpoint/f2-present-editar-y-borrar` — afecta: F2-PRESENT-02/03/04; hereda: F3 y F4 (ambas agregan su chequeo en `assertDeletable`)

- **2026-08-17 (F2-PRESENT, orden)** — **`ORDER BY factor` no define un orden: la tabla saltaba al tocar un checkbox.** Carlos mandó dos capturas con las mismas tres filas en distinto orden después de editar. La causa no era el front: sus dos bolsas quedaron con **el mismo factor (1000)** por un error de carga, y con empate Postgres devuelve el orden que le conviene —que cambia después de un `UPDATE` porque la fila se reubica en el heap—. Se pasó a un orden **TOTAL**: `factor` → `createdAt` → `id`, en los DOS lugares que listan presentaciones (el detalle del producto y el endpoint dedicado); si divergieran, la tabla saltaría según qué pantalla la haya cargado. El `id` no es decorativo: `now()` en Postgres es el del **inicio de la transacción**, así que todo lo creado en una misma transacción —la importación masiva, por ejemplo— comparte `created_at` al microsegundo y `createdAt` solo no alcanza. **Nota honesta sobre la verificación:** el e2e que acompaña el arreglo **no reproduce el salto**. Se intentó dos veces —primero comparando el orden antes y después de un UPDATE, después forzando ids en orden inverso al de inserción con `createMany`— y en ambos casos el motor eligió un orden que coincide con el esperado, así que el test pasaba también SIN el arreglo. No se puede probar de forma confiable la *ausencia* de una garantía: el test queda como documentación del orden esperado (falla si alguien lo cambia por `name` o invierte el sentido), y el arreglo se sostiene por el argumento, no por el test. — `topic_key: sellpoint/f2-present-orden-total` — afecta: F2-PRESENT-02; aplica como patrón a TODA lista paginada u ordenada del sistema

- **2026-08-17 (cierre)** — **El tope de los importes y el nombre de la presentación base.** Dos deudas que quedaron abiertas y Carlos pidió cerrar. **(1) Magnitud:** `DECIMAL(14,2)` son 12 enteros, y pasarse **no** se redondea callado como los decimales —Postgres lanza un overflow crudo—. Se agregó `MONEY_MAX = 999999999999.99` a `@sellpoint/shared` y los dos límites se validan **por separado**: "admite 2 decimales" sería una mentira si lo que se escribió fue un billón, así que hay clave propia (`products.amount_too_large`) y `moneyScaleError` del front pasó de devolver un booleano a devolver la CLAVE del problema. **(2) Nombre de la presentación base:** nacía con el literal `"Unidad"` aunque el producto se midiera en gramos. Ahora nace con el nombre de su unidad base (`basePresentationName`), en el idioma de quien crea el producto —es un dato editable del tenant, no una etiqueta que la UI traduzca al vuelo—. **Carlos pidió corregir su registro "directo en la base"; se hizo por MIGRACIÓN y no a mano**, por tres razones: no hay acceso a la DB de producción fuera del pipeline, un UPDATE manual saltea el registro de qué cambió, y sobre todo el problema no era ese registro sino el código que lo generaba —arreglar la fila sin arreglar el código lo reproduce en el próximo alta—. La migración toca lo mínimo: solo presentaciones con nombre EXACTO "Unidad", factor 1, predeterminadas y de productos que no se miden en `unit` (ahí el nombre ya era correcto); si el usuario la renombró, es suya y no se toca. Lleva un `NOT EXISTS` porque `UNIQUE(product_id, name)` haría reventar la migración entera por una sola fila en conflicto. — `topic_key: sellpoint/f2-cierre-importes-y-nombre-base` — afecta: F2-PROD-01/07, F2-IMPORT, F2-PRESENT

- **2026-08-17 (F2-PRESENT, confirmación)** — **Eliminar una presentación pregunta antes; desactivar sigue siendo de un clic.** Pedido de Carlos. Se reusó el patrón que ya existía en el editor de campos (`role="alertdialog"` inline con `data-testid`, no un `window.confirm` ni un modal nuevo): el diálogo **nombra** la presentación —en una tabla de varias filas hay que poder ver que se apuntó a la correcta—, avisa que se va el código de barras y el precio, y ofrece la salida alternativa ("si solo quieres dejar de usarla, desactívala"). **La confirmación va SOLO en el borrado, a propósito:** "Desactivar" se revierte de un clic y pedir confirmación para todo entrena al usuario a aceptar sin leer, que es justo cómo se pierde el borrado que sí importaba. Hay un test que fija esa asimetría. Si el API rechaza (es la predeterminada, es la última), el diálogo **se cierra** y el motivo se muestra arriba: insistir con el mismo botón no lo arreglaría. — `topic_key: sellpoint/f2-present-editar-y-borrar` — afecta: F2-PRESENT-04

- **2026-08-17 (CONFIRMACIÓN UNIFICADA)** — **Cuatro formas distintas de preguntar lo mismo, y la más cara no preguntaba nada.** Carlos reportó que "Quitar" un producto borraba sin confirmar; al inventariar aparecieron **cuatro** borrados destructivos con cuatro tratamientos: diálogo propio duplicado (editor de campos y presentaciones), un `window.confirm` (roles) y NADA (producto, que se lleva presentaciones, códigos de barras y composición). Nace `components/common/confirm-dialog.tsx` y los cuatro pasan por ahí. **Reglas que quedan escritas en el componente:** (1) confirmación **solo donde no hay vuelta atrás** —desactivar y archivar se revierten de un clic y NO preguntan, porque pedirlo para todo entrena a aceptar sin leer—; (2) el cuerpo **nombra** lo que se va a borrar, que en una tabla de varias filas es lo único que deja verificar que se apuntó bien; (3) el botón nombra la acción ("Eliminar producto"), nunca "Aceptar". El editor de campos además cambió de flujo: antes llamaba al API al primer clic y un campo **sin datos se borraba sin preguntar** —el diálogo solo aparecía si el 409 lo forzaba—; ahora pregunta primero y, si el API responde 409, vuelve a preguntar con el conteo, que no es la misma pregunta (cambió qué va a pasar: ya no se borra, se oculta). **Hallazgo del camino, encontrado por un test:** los botones del diálogo estaban dentro del `<form>` de producto y un `<button>` sin `type` es `submit` — confirmar disparaba también el submit, que empieza con `setError(null)` y se comía el mensaje del rechazo. `type="button"` explícito en el componente. — `topic_key: sellpoint/confirmacion-unificada` — afecta: F2-PROD, F2-SCHEMA, F2-PRESENT, F1-WEB-USERS (roles); aplica a TODO borrado futuro

- **2026-08-17 (F2-PRESENT, fila predeterminada)** — **La regla ya existía en el API; lo que faltaba era que se VIERA antes del clic.** Carlos propuso que la presentación que se autocrea con el producto no se pudiera editar ni eliminar, solo activar/desactivar. **Se rechazó la mitad de la propuesta, con su propio caso como evidencia:** su producto ENGRANERELOJ tiene una sola presentación, "ENGRANERELOJ 100K" con equivalencia 100 — nació como «Unidad ×1» y él MISMO la editó para vender solo por lote. Bloquear la edición habría convertido eso en tres pasos (crear otra, marcarla predeterminada, desactivar la original) y le habría dejado una fila gris inútil para siempre. **Lo que sí era cierto de su intuición:** esa fila es especial, pero no por ser la primera sino por ser la **predeterminada** —es donde el campo Precio de la pestaña Información escribe—, y el API ya rechaza con 409 desactivarla o eliminarla. El problema era de UI: los tres botones se veían idénticos en todas las filas y el límite se descubría a los golpes. Ahora Eliminar y Desactivar salen **deshabilitados con `title`** que explica qué hacer; Editar se queda. — `topic_key: sellpoint/f2-present-fila-predeterminada` — afecta: F2-PRESENT-02

- **2026-08-17 (F2-BOM, error sobre la fila)** — **El API ya decía qué fila estaba mal; el formulario lo escondía arriba.** Cierra el pendiente que quedó al hacer la validación descriptiva: el `ZodValidationPipe` devuelve `errors: [{ key: "lines.1.wastePercentage", … }]` desde el 2026-08-17, pero la pestaña Composición pintaba solo el mensaje general — con cinco componentes, leer "Debe ser 100 o menos" obligaba a revisar las cinco filas a ojo. Ahora el mensaje va **dentro de la celda**, con `aria-invalid` en el input, y **solo en la que falló**: si se pintaran todas, señalar la fila no serviría de nada. La ruta que consulta el front (`lines.${index}.quantity`) es **exactamente** la que arma el pipe en el API, así que no hay traducción de formatos entre las dos puntas —y hay tests de los dos lados fijando esa misma cadena—. Nace `lib/field-errors.ts` con `fieldErrorsOf()`: el casteo del `errors` vivía duplicado y con criterio propio en cada formulario, así que el de producto se migró también. Es tolerante a propósito (un 409 de negocio no trae campos; el reporte de importación usa `errors` con OTRA forma, `row`/`field`) y devuelve un `Map` indexado por ruta en vez de un árbol: el formulario ya sabe qué ruta le toca a cada input, reconstruir un árbol sería trabajo para volver a aplanarlo. **Detalle de UX:** el error del campo se borra apenas se lo toca —dejarlo en rojo con el valor ya corregido es mentir— y el mensaje general se OMITE cuando hay campos señalados, para no repetir arriba lo que ya está en la fila. — `topic_key: sellpoint/f2-bom-error-por-fila` — afecta: F2-BOM-03, F2-PROD-05; aplica a todo formulario con arreglos (F3 y F4 los van a tener)

- **2026-08-17 (F6-TYPECHECK-TESTS, CERRADA)** — **Los 27 errores de tipos en los tests escondían DOS agujeros de cobertura reales.** El grueso era mecánico —7 accesos `rows[0].campo` sin guarda, 6 `ConfigService` sin parametrizar con `<Env, true>`, 4 mocks de `Response` tipados `as never` (que dejaba `response.cookie` inexistente para TS, así que esas aserciones no se chequeaban)—, pero dos eran de fondo y valían por todo el ejercicio: **(1)** `updateUserPassword` ganó un quinto parámetro `promoteToActive` y el spec seguía llamándolo con cuatro: llegaba `undefined`, se comportaba como `false`, y **nadie probaba la promoción de la cuenta a `active`** —se agregó el caso—; **(2)** `UsersAdminController` recibió `WarehouseScopeService` en F2-SCOPE-02 y el spec seguía construyéndolo con un argumento: quedaba `undefined` y **los dos endpoints de alcance por almacén no tenían cobertura acá** —se agregaron—. Los tres tests nuevos (459 unit, antes 456) no existían porque el compilador no podía avisar. Criterio aplicado en los accesos a arreglos: **afirmar la fila antes de leerla** (`expect(rows).toHaveLength(1)`) en vez de poner `?.` a secas, que convertiría un resultado vacío en un test verde por el motivo equivocado. **Lo que cierra la deuda no es el cero, es el gate:** `pnpm --filter api typecheck:full` entró al job `checks` antes de los tests. Sin eso, arreglarlos hoy solo despejaba el camino para los de mañana. — `topic_key: sellpoint/f6-typecheck-tests` — afecta: 11 archivos de test del API, `.github/workflows/checks.yml`; cierra: F6-TYPECHECK-TESTS

- **2026-08-17 (DEFER.1 — LISTO, ESPERANDO FECHA)** — **El retiro del fallback `?token=` está hecho y commiteado en la rama `defer-1-retirar-fallback-token` (`6bb59e2`). NO mergear antes del 2026-08-22.** La fecha es una cuenta, no una preferencia: el deploy de D3 (`#token=` en el fragmento) fue el **2026-08-15** y el TTL más largo de un link de mail es el de la **invitación: 7 días** → el último link con formato viejo muere el **22**. La verificación de email (24 h) venció el 16 y el reset de password (30 min) el mismo 15. Mergearlo antes deja a quien tenga una invitación pendiente frente a una pantalla que no reacciona; el remedio es reenviarla desde el panel, pero primero ve algo roto. **El 22: `git merge defer-1-retirar-fallback-token` y push.** La entrada completa con el detalle técnico viaja en la rama y entra sola con el merge. — `topic_key: sellpoint/defer-1-token-query`

- **2026-08-17 (el gate se cayó en su PRIMER uso)** — **`pnpm --filter api typecheck:full` no construye `@sellpoint/shared`, y en CI no hay `dist` de una corrida anterior.** El paso recién agregado tumbó el build con doce `Cannot find module '@sellpoint/shared'`. En local había pasado por una razón que no vale: el `dist` ya estaba de haberlo construido antes en la sesión — el clásico "en mi máquina funciona", con la máquina limpia dando lo contrario. La causa es de orquestación: `pnpm --filter` invoca el script directo y **saltea el grafo de dependencias**, mientras que `pnpm test` va por `turbo run test`, cuyo task declara `dependsOn: ["^build"]`. Se agregó el task `typecheck:full` a `turbo.json` con la misma dependencia y un script en la raíz, así que el paso de CI es `pnpm typecheck:full`. **Contraprueba hecha, no supuesta:** se borró `packages/shared/dist` y se corrió el gate — turbo construyó `shared` y después el typecheck, que es exactamente lo que hace un runner limpio. Regla que queda: **cualquier paso de CI que compile contra `shared` va por turbo, nunca por `pnpm --filter`**. — `topic_key: sellpoint/f6-typecheck-tests` — afecta: `turbo.json`, `package.json`, `.github/workflows/checks.yml`

- **2026-08-17 (ATOMIZACIÓN F3)** — **Fase 3 atomizada: 45 tareas en 9 módulos, ~95 h, 3-4 semanas** (el outline decía 2-3 y no contaba kardex con saldo, stock por almacén, el conteo completo ni las guardas heredadas). Se resolvieron primero las **contradicciones internas del outline** (compuestos "sin stock" pero `production` "arma lote"; `StockByWarehouse` listada como modelo nuevo cuando ya existe desde F2-DB-08; Excel de conteo con lote/caducidad/ubicación que no existen en el modelo). **Seis decisiones de Carlos, LEY:** (1) **sin lote/caducidad/ubicación** — son conceptos de rubro, contra la LEY de genericidad; la plantilla de conteo es SKU + cantidad; va a Fase 9.0b; (2) el enum `reason_code` nace **completo** con `sale`/`sale_return` reservados para F4 y **sin `production`**; (3) los compuestos **nunca** tienen stock persistido; (4) el **costo promedio ponderado va a F5** — F3 solo registra `unit_cost` en `invoice`; (5) **sin bloqueo** de almacén durante el conteo — la aprobación relee con `FOR UPDATE` y audita el drift; (6) **tres permisos** `inventory:read/movement/manage`, con `manage` solo TenantAdmin (`MANAGER_EXCLUDED_CODES`). **Decisiones de diseño** (cruce de un agente de tablero y un revisor de modelo, verificadas contra el código): `stock_movements.seq BIGINT IDENTITY` como desempate cronológico —`now()` es del inicio de la tx y UUID v4 no ordena, así que sin `seq` el `balanceAfter` del kardex daría saldos intermedios **falsos** entre líneas de la misma factura: el bug del ORDER BY de F2-PRESENT en su peor forma—; `batch_id` por operación; `parent_product_id` en salidas expandidas; `reference` + `authorized_by` en vez de columnas de rubro; `discrepancies JSONB` **eliminado** (se deriva de `transfer_lines`); folio por `tenant_sequences` con `ON CONFLICT DO UPDATE … RETURNING` (reusable por F4); CHECKs de coherencia dirección×motivo y estado×timestamps como red; **append-only por `REVOKE UPDATE, DELETE`** a `sellpoint_app`; FKs `RESTRICT` desde movimientos (convierten el `assertDeletable` vacío de F2 en red de DB); la tabla de motivos vive en `packages/shared` con test de contrato contra el enum Prisma y el CHECK SQL; sin backdating, sin idempotencia (→ F4), sin recepciones parciales, entrada `transfer` huérfana no permitida, traspaso cancelado no devuelve stock; kardex bajo `/products/:id/kardex` con `balanceAfter` server-side; tránsito y stock por almacén incluidos; conteo stateless; `FOR UPDATE` ordenado por `(product_id, warehouse_id)` en TODA tx del ledger; UI de alcance por almacén en usuarios entra (deuda F2-SCOPE-03). **Hallazgo que sube el peso de F3-CORE:** este proyecto **nunca** hizo un `FOR UPDATE` ni un `$queryRaw` en código de negocio, ni usa `Prisma.Decimal` en un service — F3 es la primera concurrencia real y la primera aritmética decimal exacta; por eso el ledger (F3-CORE-05) es la tarea más grande y se prueba con transacciones concurrentes contra Postgres real. **Siete puntos de extensión que F2 dejó con nombre y F3 cierra:** `assertDeletable`, nota de `costEstimate`, `TenantTransactionsGate`, "no desactivar almacén con stock", `@CurrentUserScope()` (sin ningún consumidor hasta hoy), `availability` sin scope, `products.remove` sin guarda — más una violación viva de la LEY (`products.service.ts:328`, "su receta"). Clasificación SDD matizada como en F2: CORE/ENTRY/EXIT/TRANSFER/COUNT/KARDEX completo, DB/GUARDS/NAV ligero. Sincronizados ARQUITECTURA, CASOS_DE_USO, VISTAS y FLUJOS. — `topic_key: sellpoint/f3-atomizacion` — afecta: toda la Fase 3; hereda: F4 (`sale`/`sale_return`, ledger como único escritor, `nextFolio('VTA')`, `Idempotency-Key`, `hasTransactions` + sales), F5 (promedio ponderado, tránsito y kardex exportables, `effective_at`), lotes/caducidad/ubicación — **revertido el mismo día, ver entrada F3-LOTS**

- **2026-08-17 (F3-LOTS — lotes, caducidad y ubicación ENTRAN a F3)** — **Se revierte el diferimiento decidido horas antes, con un Excel real de cliente en la mano.** Carlos mostró la planilla de un cliente (KY6 TABLETA, lotes st30/st10/st60 con caducidades 01/10, 01/07 y 01/12 de 2026, ubicación, stock 20/10/1) y el requisito exacto: *"al vender, tiene que restar del que vence el 01/07 y dejar el stock en 9"*. Eso es **FEFO con un cliente que dice cómo opera** — desarma el argumento de "no diseñemos sin cliente" que sostenía el diferimiento. **Lo que Carlos propuso primero** —columnas en `stock_by_warehouse` que los tenants sin lote dejan en blanco con un default— **se rechazó con argumentos**: un `00-00-00` en caducidad es un string mentiroso (no ordena, no alerta), la clave del stock cambiaría para TODOS los tenants aunque el jabón no lo use, y el día que el del jabón quiera lotes tendría miles de filas con el default fantasma que migrar. **Lo que se adoptó: dos niveles.** `stock_by_warehouse` sigue siendo el total; `stock_lots (lot_id, warehouse_id, location) → quantity` es el detalle **solo** para productos con `products.tracks_lots = true`; `product_lots (product_id, lot_code, expires_at)` porque **la caducidad es del lote** (mismo lote en dos almacenes comparte fecha — Carlos) y **la ubicación parte el stock** ("5 en A-3 y 15 en B-1" son dos filas — Carlos), texto libre sin catálogo de racks. Invariante del ledger: `Σ stock_lots == stock_by_warehouse`, verificada por test de propiedad. **FEFO vive en `StockLedgerService.apply`** (F3-CORE-08): en salida sin lote explícito reparte por `expires_at ASC NULLS LAST` dentro de la misma tx y el mismo `FOR UPDATE`; el POS de F4 lo hereda sin diseñar nada. **"Tabla aparte" es una decisión de cómo se GUARDA, no de cómo se captura**: la plantilla de conteo es UNA sola — el producto con lote ocupa una fila por (lote, ubicación), el jabón una fila con esas columnas vacías; un lote nuevo en la planilla se crea. **La LEY de genericidad se mantiene**: lote/caducidad/ubicación son dimensiones genéricas del stock (farmacia, alimentos, refaccionaria, ferretería con rollos), no campos de rubro; el grep de la Definición de fase deja de prohibirlas. Nace el módulo **F3-LOTS** (flag con guarda para apagarlo, endpoint de lotes y ubicaciones, alertas de vencimiento sin cron, edición de lote auditada) y se ajustan DB (+2), CORE (+1 y `apply` bilateral), ENTRY/EXIT (captura y desglose), COUNT (plantilla por lote), KARDEX (columna lote, desglose FEFO). F3 pasa de 45 a **52 tareas** y de 3-4 a **4-5 semanas**. Fase 9.0b se retira. — `topic_key: sellpoint/f3-lots-fefo` — afecta: F3-DB, F3-CORE, F3-ENTRY, F3-EXIT, F3-COUNT, F3-KARDEX, F3-LOTS (nuevo); hereda: F4 (FEFO gratis en el POS; el ticket puede mostrar el lote), F5 (valorización por lote, reporte de vencimientos con export)
- **2026-08-17 (TAGS DE F1 Y F2 — la deuda era doble)** — **Faltaba `v0.3.0-fase2`… y también `v0.2.0-fase1`.** Carlos pidió cerrar el detalle suelto del tag de Fase 2 y al ir a crearlo aparecieron tres cosas: (a) el tag de Fase 1 tampoco existía (solo estaban `v0.0.0-init` y `v0.1.0-fase0`), (b) **ninguno de los dos checklists de "Fase completa" estaba marcado** pese a que la bitácora declaraba ambas fases cerradas, y (c) dos criterios eran falsos en HEAD. **Verificación real antes de tickear** (el precedente de F0 exige "el primer commit donde TODOS los checks son demostrablemente ciertos"): la cobertura de F1 se **midió** con `pnpm test:cov` — `modules/auth` 98.57 % y `modules/users` 88.54 % de sentencias, sobre el 70 % exigido; y el grep de genericidad de F2 devolvía 9 hits, de los cuales 7 son comentarios que **declaran** la ley ("acá no hay ni habrá un campo de farmacia", "`component`, nunca `ingredient`") y **2 eran residuo real**: el comentario "su receta" en `products.service.ts` (vocabulario de comida que la LEY prohíbe; estaba agendado para F3-GUARDS-02) y un `it.skip` en `onboarding.test.tsx` que afirmaba radios "Pharmacy / Hardware store / Grocery" de un selector de rubros **que ya no existe** — residuo que F2-ONBOARD-04 ("limpieza de residuos") no barrió. Ambos limpiados, más los fixtures `templateChoice: "pharmacy"/"grocery"` → `"sin-plantilla"` (el campo es `z.string()` libre, no un enum). **Commits elegidos, y por qué NO son los obvios:** `v0.2.0-fase1` → **`b68c7fc`** (cierra la bitácora de `f1-web-onboard`, Deploy verde) y `v0.3.0-fase2` → **`3d5af37`**, *no* `fe970ec` — `fe970ec` es el commit que dice "completa la fase 2" pero su Deploy quedó en **rojo** (el hueco de tipos del front), y un tag es una promesa de que todo estaba verde ahí. **Lección:** declarar una fase completa en la bitácora no la cierra; el checklist es el contrato y hay que ejecutarlo criterio por criterio, no leerlo. — `topic_key: sellpoint/tags-f1-f2`
- **2026-08-18 (F3-DB-01 — el libro mayor nace, y Prisma tenía dos opiniones propias)** — **`stock_movements` creada con 5 CHECKs, 7 índices, 8 FK y `seq` GENERATED ALWAYS AS IDENTITY** (migración `20260818013308_f3_stock_movements`, 32 tests en `inventory-schema.integration.spec.ts`, 491 unit + 239 e2e verdes, drift cero). Primera tarea de Fase 3. **Dos hallazgos que cambiaron el diseño respecto del tablero, los dos por defaults silenciosos de Prisma:** **(1) `ON DELETE SET NULL` en las FK opcionales.** Prisma se lo pone solo a toda relación opcional. En una tabla APPEND-ONLY eso es un **UPDATE silencioso de la historia**: borrar una presentación reescribiría movimientos ya asentados y el kardex dejaría de explicar en qué presentación se capturó cada línea. Las 8 FK van `RESTRICT` — el tablero solo lo exigía para `product_id`, `presentation_id` y `parent_product_id`; se extendió a `linked_warehouse_id` y `authorized_by` por el mismo argumento. Regla que queda: **en una tabla append-only, ninguna FK puede ser `SET NULL`.** **(2) `@default(now())` NO usa el default de la base: Prisma genera el timestamp en el CLIENTE y lo manda en el INSERT.** Lo descubrió un test que fallaba por 1 ms: afirmaba que dos movimientos de la misma transacción comparten `created_at` (que es exactamente el motivo por el que existe `seq`) y daban valores distintos. **Contraprueba**: dos INSERT crudos con `DEFAULT CURRENT_TIMESTAMP` en una transacción, con `pg_sleep(0.05)` en medio, dan **1** timestamp distinto; dos `create` de Prisma dan **2**. Para un libro mayor eso es la hora de un reloj de APLICACIÓN — no sincronizado entre instancias y capaz de ir para atrás con un ajuste de NTP: dos movimientos de dos pods pueden quedar guardados en orden invertido. `created_at` pasó a `@default(dbgenerated("transaction_timestamp()"))`. Se eligió `transaction_timestamp()` y no `CURRENT_TIMESTAMP` (mismo valor) porque dice explícitamente que es la hora de inicio de la transacción **y** porque Prisma normaliza `CURRENT_TIMESTAMP` a su `now()` al introspeccionar, lo que dejaba drift permanente en `migrate diff`. **Advertencia general: TODOS los `created_at`/`updated_at` del sistema (F0-F2) son hora de aplicación, no de base.** Para catálogos es inocuo; para cualquier tabla que se ordene cronológicamente, no. **Tercer hallazgo, menor pero destructivo:** el `UNIQUE` de `seq` escrito solo en el SQL de la migración **lo borraba el próximo `migrate dev`** — lo probó `prisma migrate diff --from-config-datasource --to-schema`, que emitía un `DROP INDEX stock_movements_seq_key`. Se declaró `@unique` en el schema (mismo motivo que los índices GIN de `products`) y el SQL se reescribió como `CREATE UNIQUE INDEX` con el nombre exacto que usa Prisma, para que no haya drift. **`migrate diff` quedó como parte del ritual de toda tarea F3-DB**: aplicar la migración no prueba que el schema y la base digan lo mismo. **Trampa avisada para F3-KARDEX-01:** `seq` es `BigInt` y `JSON.stringify` revienta con BigInt — sirve para ORDENAR, no para exponerlo en la respuesta. — `topic_key: sellpoint/f3-db-01`
- **2026-08-18 (FOLIOS, VISTA PREVIA Y PDF — el tablero crece por tercera vez, y otra vez por evidencia)** — **Toda operación que toca stock pasa a ser un DOCUMENTO con folio, se puede cargar por Excel, se revisa en una vista previa que muestra el stock resultante y se baja en PDF firmable.** Carlos frenó la construcción después de F3-DB-01 y señaló tres huecos del tablero: (1) **solo el traspaso generaba folio** — una entrada, una salida o un conteo se identificaban con un `batch_id` que es un UUID, imposible de dictar por teléfono, anotar en una libreta o buscar; (2) **entradas y salidas no tenían ni carga por Excel ni paso de previa** (el inventario físico sí: plantilla → `reconcile` en seco → `approve`), así que una entrada de 80 productos se cargaba a mano y se confirmaba a ciegas; (3) **nada se podía imprimir** — cero dependencias de PDF en el repo, y quien recibe mercancía necesita un papel con folio para firmar. **Tres decisiones de Carlos:** (a) **un prefijo por TIPO DE OPERACIÓN, 5 series** — `ENT`, `SAL`, `TRA`, `REC`, `INV`, con `VTA` reservada para F4; el motivo (factura, merma, ajuste) viaja DENTRO del documento, no en el folio (se descartaron 11 series por motivo, y una serie única `MOV` donde dos documentos distintos se ven iguales en un listado); (b) **pantalla dedicada `/movements/documents`** para buscar por folio y re-descargar el PDF, no solo bajarlo en el momento; (c) **PDF operativo con firmas** (negocio con `legalName`/`taxId`, folio, tipo, almacén, fecha, motivo, líneas, y pie Entregó / Recibió / Autorizó), **sin logo** — subir imágenes exige almacenamiento de archivos que no existe y es trabajo fuera de F3. **Decisiones de diseño que trajo el pedido:** nace **`inventory_documents`** como ENCABEZADO de toda operación (sin él, folio, tipo, motivo y autorizador se repetirían en CADA línea) y **`stock_movements.batch_id` se reemplaza por `document_id`** FK RESTRICT — tener las dos cosas sería la misma verdad escrita dos veces; la migración es limpia porque la tabla está **vacía en producción**, lo que hace que el momento de hacerlo sea AHORA (por eso F3-DOC-01 se ejecuta justo después de F3-DB-02: cuanto más tarde, más código que tocar). **`transfers.folio` desaparece**: el folio del traspaso ES el de su documento de despacho, y la recepción tiene el suyo (`REC`) ligado al mismo `transfer_id` — un folio, una fuente. **El folio se toma en el COMMIT, jamás en la previa**: una previa que quema números deja huecos cada vez que alguien mira y se arrepiente; es la regla que hace que mirar sea gratis. **La serie es sin huecos y eso cuesta serialización**: el `ON CONFLICT DO UPDATE` sobre `tenant_sequences` toma la fila `(tenant, key)` hasta el COMMIT, así que si la tx falla el número vuelve pero todas las operaciones del mismo tipo del mismo tenant se serializan — correcto y barato en inventario, **a medir antes de reusarlo para el folio de ventas de F4**. **La previa es stateless y acepta las dos formas de carga en UN endpoint** (`lines[]` o `file`+`format`, misma respuesta): por eso la pantalla es una sola, cargues como cargues; devuelve **`stockBefore`/`stockAfter` por línea** —el corazón del pedido— más `newLot`, la expansión de compuestos y el reparto **FEFO** que se aplicaría; no escribe nada y no pide folio. **El PDF se renderiza en el servidor con `pdfmake`** (elegido sobre `pdfkit` porque pagina la tabla solo y repite el encabezado, y un conteo son 500 líneas) y viaja como binario `application/pdf`, no como base64 en JSON: es el patrón que ya usa `downloadImportTemplate()` con axios `responseType: 'blob'`, porque un `<a href>` plano iría sin el Bearer y daría 401. **El PDF NO lleva total de unidades**: sumar 36 unidades + 2.5 kg + 400 ml da un número que no significa nada — el pie muestra total de LÍNEAS y la cantidad va por línea con su unidad; un total que miente es peor que no tenerlo. De paso, **`spreadsheet.ts` se muda** de `modules/products/` a `common/`: la usan conteo, entradas y salidas. **Números:** +1 módulo (F3-DOC, 6 tareas) y +4 tareas en ENTRY/EXIT → **62 tareas en 11 módulos, ~139 h, 5-6 semanas** (desde 52 / ~113 h / 4-5). Grafo verificado por script: sin ciclos, sin referencias rotas, 62/62 con las 4 sub-viñetas. **Patrón que se repite y vale anotar:** las tres veces que F3 creció —guardas heredadas de F2, lotes con FEFO, y ahora folios/previa/PDF— fue por evidencia concreta (código existente, un Excel de cliente, una revisión de flujo), nunca por especular con lo que alguien podría llegar a pedir. — `topic_key: sellpoint/f3-folios-previa-pdf` — hereda: F4 (folio `VTA` con el gotcha del lock ya medido, y el ticket reusa el renderer), F5 (mandar el documento por mail)
- **2026-08-18 (RE-ATOMIZACIÓN DE F3 — borradores retomables y 3 series; Carlos encontró una contradicción mía)** — **Todo movimiento pasa a ser un documento con ESTADO: nace en borrador con su folio, se guarda solo, se retoma por folio y al confirmar recién ahí escribe los movimientos.** Dos correcciones de Carlos sobre el diseño de folios que yo había escrito unas horas antes, y en las dos tenía razón. **(1) El traspaso no es un tipo de documento.** Yo había definido 5 series (`ENT`, `SAL`, `TRA`, `REC`, `INV`) justo después de escribir como regla que *«el motivo viaja dentro del documento, no en el folio»*. Carlos lo marcó: *«habíamos definido que un traspaso sería una Salida y la Recepción una Entrada, lo único que cambian son el motivo y algunos campos — ¿me recomiendas eso?»*. Es exactamente lo que dice el modelo desde CU-MOV-01/03: `transfer` es un `reason_code`, no un tipo. Quedan **3 series** — `ENT`, `SAL`, `INV` — y un traspaso es `SAL-000019` con su recepción `ENT-000043`. **Lección: una regla que uno mismo acaba de escribir es justo la que más fácil se viola en la línea siguiente.** **(2) Un movimiento a medio cargar tiene que sobrevivir.** *«Si llevas muchos productos agregados y se cierra el sistema, debes poder continuar el movimiento buscándolo por su folio»*. Eso chocaba de frente con dos cosas que yo había escrito: *«la previa es stateless, sin tabla de borradores»* y *«el folio se asigna al confirmar»*. Si se busca por folio, el folio existe desde el principio. **Consecuencias en cadena, todas para bien:** (a) `inventory_documents` gana `status { draft, confirmed, canceled }` y `updated_at`, y **deja de poder blindarse con `REVOKE`** — un borrador se edita; la inmutabilidad de lo confirmado pasa a un **trigger `BEFORE UPDATE OR DELETE` que revienta si `OLD.status <> 'draft'`**, el **primer trigger del proyecto**. `stock_movements` conserva su REVOKE: nace al confirmar y no se toca nunca. (b) Nace `inventory_document_lines` (mutable) con lo que el usuario CAPTURÓ, separado de los `stock_movements` que dicen lo que el ledger HIZO — no es duplicación: la línea dice *«3 cajas»* y los movimientos dicen *«36 del lote st10 + 12 del st30»*, porque FEFO parte una línea en N movimientos y un compuesto la expande. (c) **El borrador ES la vista previa**: desaparece el endpoint stateless `POST …/preview` y su detalle ya devuelve `stockBefore`/`stockAfter`, FEFO y errores por línea — un concepto menos y sin validaciones duplicadas. (d) **Tomar el folio se volvió más barato**: se toma al crear el borrador en una tx corta, no dentro de la del ledger, así que el lock de la serie dura milisegundos en vez de todo el posteo — el gotcha anotado para F4 se suaviza solo (el POS puede tomar folio al abrir el carrito). (e) La serie sigue **sin huecos** con mejor argumento: un borrador abandonado queda `canceled` con su folio, no desaparece. **Navegación (decisión de Carlos):** cada serie tiene su menú con **buscador por folio y estatus más botón de crear** — Entradas, Salidas, Inventario — y ese botón es el que genera folio y borrador; se cayó la pantalla única de «Documentos». Los tres listados son **el mismo componente montado tres veces**. **De paso se resolvió un ciclo de FKs que el tablero tenía sin declarar**: `transfers.dispatch_document_id` ↔ `inventory_documents.transfer_id` eran dos punteros al mismo hecho y el segundo era **imposible de rellenar** con documentos append-only (el documento se confirma después de crear el traspaso). Queda un solo puntero, en el documento, con UNIQUE parcial `(transfer_id, type)`. Y `stock_movements` pierde también `transfer_id`: es dato de cabecera, misma regla que motivó toda la tabla. **Números: 57 tareas en 11 módulos, ~131 h, 5-6 semanas** — **menos tareas que la versión anterior (62) y casi las mismas horas**: al volver el traspaso a ser una salida con motivo y el borrador a ser la previa, murieron cuatro tareas de previa stateless y la UI se concentró en maquinaria compartida. **Corregir el modelo salió más barato que parchearlo.** Grafo verificado por script: sin ciclos, sin referencias rotas, 57/57 con las 4 sub-viñetas. — `topic_key: sellpoint/f3-borradores-3-series` — hereda: F4 (el carrito es un borrador `VTA` con el mismo ciclo, y el folio se toma al abrirlo), F5 (mandar el documento por mail)
- **2026-08-18 (TERMINOLOGÍA — se cae el «Directa»)** — **«Entrada Directa» pasa a «Entradas» y «Salida Directa» a «Salidas»** en los cinco `.md` (61 reemplazos). Pedido de Carlos: *«creo que esto es más claro porque abarca cualquier tipo de Entrada o Salida»*. Tiene razón, y la palabra ya venía haciendo daño: **«Directa» servía para distinguir el movimiento manual del traspaso**, pero desde la corrección de las 3 series —donde un traspaso ES una salida con motivo— decir «Salida Directa» excluía justo lo que el concepto ahora abarca. Era un resto de una distinción que dejó de existir. **Alcance:** solo documentación (el módulo `inventory` todavía no está construido, así que salió gratis; en un mes habría sido un rename con migración de i18n). Se limpió también **«2 movimientos directos» → «2 tipos de movimiento»** y se renombraron los identificadores del tablero **`DIRECT_ENTRY_REASONS`/`DIRECT_EXIT_REASONS` → `SELECTABLE_ENTRY_REASONS`/`SELECTABLE_EXIT_REASONS`**: lo que agrupan no es «los de la entrada directa» sino **los motivos que el usuario puede elegir en el formulario**, frente a los reservados (`sale`, `sale_return`, `physical_count`) que solo emite el sistema — el nombre nuevo dice eso y no depende de una palabra que ya no usamos. Los títulos de sección van en **plural** (nombran la sección, no un documento) y los CU pasaron a «Registrar una entrada/salida»; se corrigieron las 3 anclas que apuntaban a los encabezados viejos y **una cuarta rota de antes** (`ARQUITECTURA.md#fase-3…-2-3-semanas`, que además decía 3-4 semanas cuando la fase estima 5-6). Verificado por script: todas las anclas internas de los cinco `.md` resuelven. **Patrón:** el vocabulario es parte del diseño — un nombre que describe una distinción muerta confunde más que uno genérico.
- **2026-08-18 (F3-DB-05/06/07 — permisos, lotes y la trampa de los NULL en un UNIQUE)** — **El esqueleto de datos de la fase queda cerrado**: los tres permisos `inventory:*`, las tablas de lotes con su RLS de nacimiento, y `lot_id` en movimientos y líneas de traspaso. **Tres hallazgos.** **(1)** El test de `role-catalog` salió rojo **antes de tocar nada**: `inventory:manage` le caía a Manager solo, por la regla implícita de que todo code fuera de `MANAGER_EXCLUDED_CODES` es suyo — la trampa que el propio comentario del archivo advierte. **(2)** Al agregar `lot_id` al `@@unique` de `transfer_lines`, la invariante **se debilitó en silencio**: Postgres trata dos NULL como DISTINTOS, así que `(traspaso, producto, NULL)` no colisiona consigo mismo y un producto sin lote podía repetirse en el mismo traspaso. Lo cazó un test de F3-DB-02 que se puso rojo al cambiar el índice. Se resolvió sacando el unique del schema y escribiendo **dos índices PARCIALES** que dicen la regla tal cual es — mismo gotcha que el unique de `barcode` en F2. **(3) Un diagnóstico de los 'flakes' del e2e que resultó FALSO** (ver la corrección del 2026-08-19): dije que era el throttler de `/auth/*` acumulando buckets en Redis con los workers de jest en paralelo, y que `redis-cli flushdb` lo resolvía. **Las dos mitades son falsas** — `jest-e2e.json` tiene `maxWorkers: 1` (no hay paralelismo) y `setup-env.js` pone `THROTTLE_ENABLED=false` para toda la suite (el throttler está apagado). El flush "funcionaba" por coincidencia leída como causa. La causa real sigue sin determinar. — `topic_key: sellpoint/f3-db-05-06-07`
- **2026-08-19 (CORRECCIÓN — el flake del e2e no era el throttler)** — Al ir a pagar la deuda "limpiar las claves `throttle:*` en el setup del e2e" descubrí que **la deuda no existía y el diagnóstico que la originó era falso**. `test/jest-e2e.json` tiene **`maxWorkers: 1`** (el e2e corre secuencial, no en paralelo) y `test/setup-env.js` pone **`THROTTLE_ENABLED ??= "false"` para TODA la suite** con su propio comentario explicando por qué (f1-auth U6-02); solo `auth-throttling.e2e-spec.ts` lo prende, sobre su propia instancia. O sea: **no hay 429 posible** en el resto de la suite, y el `flushdb` que yo corría antes de cada e2e y que "arreglaba" el problema fue **correlación leída como causa**. **La causa real sigue sin determinar**: los fallos observados caen en tests distintos cada vez (`catalogs`, `rbac` último-admin, `document-lines` anulados) y todos pasan corridos solos; sospecha viva pero NO confirmada de estado compartido en la base entre specs, que nadie limpia. **Lección de método:** escribí una causa raíz en engram y en este tablero basándome en una correlación, sin aislar la variable, y esa explicación falsa se propagó varias sesiones y casi me lleva a "arreglar" algo que ya estaba apagado. Antes de registrar una causa raíz: verificar la configuración que la haría posible. — `topic_key: sellpoint/e2e-flake-diagnostico`
- **2026-08-18 (EL TRASPASO NO TIENE PANTALLA PROPIA — la pregunta de Carlos destapó docs viejos)** — Carlos preguntó *«¿el traspaso no será desde la interfaz de Entradas o Salidas y solo cambiando motivo y almacén origen y destino?»*. **Sí, y así está construido** desde F3-EXIT-01: despacho = `SAL` con motivo `transfer` + destino, recepción = `ENT` con el mismo motivo y líneas precargadas; la pantalla `/movements/transfers` no captura nada, muestra el **estado del viaje**. La pregunta salió porque **los docs describían el diseño anterior**: `VISTAS.md` § 8.3 mostraba folios `TRA-…` y un **modal de recepción con su propia tabla** enviado/recibido/diferencia, y las § 8.1/8.2/8.4 apuntaban a rutas muertas (`/movements/entries/new`, `/movements/exits/new`, `/movements/inventory-count`). **El modal se descarta por dos razones:** sería una segunda copia de la tabla de líneas y divergirían en cuanto una gane una columna (lote, ubicación); y el borrador nace con folio, así que la recepción se retoma si se cierra el sistema a mitad de la descarga del camión — un modal no sobrevive a un F5. Queda un `ConfirmDialog` sin cantidades que crea el borrador `ENT` y navega a la pantalla del documento. **F3-TRANSFER-06 estaba contradiciéndose a sí mismo** (título «modal de recepción», cuerpo «navega al borrador»): era una edición mía a medio aplicar. **Lección: cuando cambia un modelo, los mockups mienten más rápido que el código** — el código lo corrige un test, al `.md` no lo corrige nadie. — `topic_key: sellpoint/traspaso-sin-pantalla-propia`
- **2026-08-18 (DISCO LLENO EN PRODUCCIÓN — un cleanup que nunca limpió nada)** — Dos deploys seguidos fallaron con `sed: couldn't flush: No space left on device`: el VPS estaba al 100% con **380 imágenes Docker (37.71 GB)**, 7 en uso. **La línea de limpieza era `docker image prune -f`, sin `-a`** — y eso solo borra imágenes *dangling*, mientras que acá todas llevan su SHA como etiqueta. Corrió en cada deploy exitoso durante meses **sin liberar un byte**; el log del propio run lo confirma con un `Total reclaimed space: 0B` justo después de que Carlos liberara 36 GB a mano. Segundo error de diseño: la limpieza vivía al FINAL y condicionada al smoke OK, así que **necesitaba disco sano para poder liberar disco** y cada fallo apretaba el trinquete. Se movió al principio, con `until=168h` (el rollback hace `up -d` sin pull: necesita la imagen previa local) y una guarda que aborta temprano con un mensaje accionable en vez de un `sed` críptico a mitad del deploy. **Lección: un cleanup sin una métrica que lo verifique es una línea decorativa.** Nadie miró nunca cuánto liberaba, y la respuesta era cero. Lo mismo aplica a cualquier `|| true` que nadie audita. — `topic_key: sellpoint/f6-disk-retention`
- **2026-08-19 (F3-GUARDS — cinco puntos de extensión, y uno que MENTÍA)** — F2 dejó cinco lugares marcados "F3 lo completa" y todos resultaron ser lo mismo: **una promesa que el código no cumplía**. El peor era `TenantTransactionsGate.hasTransactions()`, que devolvía `false` siempre porque en F1 no existían las tablas — o sea que la moneda del tenant **se podía cambiar con historia adentro**, y los importes ya escritos, que no tienen unidad propia sino que la heredan del tenant, se habrían reinterpretado en masa sin que ningún número cambiara. Un solo movimiento la congela ahora, sin umbral. **Descubrimiento del módulo:** las tres UIs involucradas (presentaciones, productos, almacenes) **ya pintaban `apiError.message`** y el filtro de excepciones lo devuelve **ya traducido** — así que la mitad "la UI mapea el 409" del criterio se cumplía escribiendo bien el mensaje del API, no tocando React. Lo que sí faltaba era la mitad proactiva: `GET /warehouses` gana `deactivationBlockedBy` y el botón queda `disabled` con `title`, porque **el 409 es el peor lugar para enterarse** — para cuando llega, el usuario ya se convenció de que iba a poder. Se eligió **un motivo y no dos banderas**: `update` corta en el saldo antes de mirar los traspasos, y dos banderas prometerían un orden que la guarda no respeta. La barrera anti-voseo rechazó el copy del 409 de stock ("dale salida", forma ambigua): **tercera vez que ataja algo que ningún test de comportamiento habría visto**. — `topic_key: sellpoint/f3-guards`
- **2026-08-19 (EL FLAKE DEL E2E ES `ECONNRESET`, NO ESTADO DE BASE — segunda corrección del mismo diagnóstico)** — Escribiendo el e2e de F3-GUARDS apareció un reproductor chico: `inventory-guards.e2e-spec.ts`, **14 tests, corriendo SOLO**, falla ~1 de cada 10 corridas. El detalle del fallo es una sola línea: **`read ECONNRESET`**. Eso es transporte, no aplicación — **mata la sospecha viva de "estado compartido en la base entre specs"** que quedó anotada el mismo día, y explica de una los tres síntomas que nunca cerraron: por qué cae en un test distinto cada vez (cualquiera puede perder el socket), por qué pasa al correrlo solo (no dependía de otros specs; solo hay que insistir), y por qué el `flushdb` "arreglaba" (no arreglaba nada, la corrida siguiente simplemente no perdía el socket). **Lo que NO se determinó todavía:** por qué se resetea. Los logs de pino muestran `connection: close` en cada request, así que la hipótesis obvia de keep-alive reusado por el cliente queda descartada de entrada. **Deuda concreta y acotada** (antes era "investigar los flakes", ahora es): reproducir con 30 corridas de un spec chico y probar una intervención por vez sobre el socket del servidor de pruebas. **Método:** esta es la segunda corrección de la misma causa raíz. La primera vez registré una correlación como causa; esta vez lo que cambió no fue pensar más, fue **capturar la salida del fallo en un archivo en vez de leerla por `grep` en la terminal** — los `grep` que usaba se comían el detalle y por eso durante sesiones solo vi "1 failed" sin el motivo. — `topic_key: sellpoint/e2e-flake-diagnostico`
- **2026-08-19 (LA WEB NO ESTABA EN `typecheck:full` — CI rojo por 15 fixtures)** — El commit de F3-GUARDS pasó `pnpm typecheck:full` en verde local y **murió en CI**: 15 `error TS2741` por fixtures de test que construyen `Warehouse` sin el campo nuevo `deactivationBlockedBy`. La causa no fue descuido sino un **hueco en la red**: `typecheck:full` existía **solo en `apps/api`**, así que `turbo run typecheck:full` corría 2 tareas y **ninguna era la web**. El único lugar donde la web se typechequeaba era dentro de `pnpm build` (`tsc -b && vite build`) — y "nunca hagas build después de cambiar" es regla del proyecto, con razón. O sea: **había un chequeo que solo existía en el comando que tengo prohibido correr**. Se agregó `"typecheck:full": "tsc -b"` a `apps/web/package.json` (mismo comando que su `typecheck`; `tsconfig.app.json` incluye `src`, o sea también los tests). Ahora son 3 tareas y la contraprueba lo confirma: al quitarle el campo a una fixture, `typecheck:full` sale rojo donde antes salía verde. **Se descartó** marcar el campo como opcional para no tocar fixtures: el API **siempre** lo manda, y un `?` habría sido una mentira en el tipo para ahorrarse quince líneas. **Lección: un guardarraíl que solo corre dentro de un comando que nadie ejecuta no es un guardarraíl.** Vale la pena preguntarle a cada script qué paquetes cubre de verdad, no cuántas tareas dice "successful". — `topic_key: sellpoint/typecheck-full-sin-la-web`
- **2026-08-19 (LAS `0.x` NO SE AGRUPAN — semver dice que el minor de un 0.x ES un major)** — Carlos preguntó por tres corridas rojas de GitHub creyendo que eran sus deploys; **ninguna lo era**: dos venían de Dependabot y la tercera era el propio updater de GitHub fallando con `unknown_error` en `@commitlint/cli` (infraestructura ajena, nada que arreglar). Pero la de PR #14 sí tenía sustancia: el grupo "minor-y-patch" traía **`pdfmake ^0.2.23 → ^0.3.11`** y reventó con `pdfmake_1.default is not a constructor`. **La causa no es Dependabot sino nosotros**: semver dice que mientras la mayor sea 0 *cualquier* cambio puede romper — **el hueco del minor ES el de la major** — así que agrupar por `update-types: [minor, patch]` barre cambios incompatibles dentro de un PR con otros veintiséis. Se agregaron `exclude-patterns` con **las seis** `0.x` del repo (`pdfmake`, `@types/pdfmake`, `argon2`, `class-variance-authority`, `reflect-metadata`, `source-map-support`), no solo la culpable: excluir una instancia deja viva la clase. **Y como una lista de exclusiones se pudre sola** — el día que entre una `0.x` nueva nadie se va a acordar — la fija una barrera, `dependabot-groups.test.ts`, que lee los cuatro `package.json` y el `yml` y falla por los **dos** lados: una `0.x` sin excluir, o una exclusión que ya no corresponde. **Quién cazó el bug:** `app.module.spec.ts`, el smoke que compila el módulo entero con toda la DI. Sin ese test el PR habría pasado verde. **Dos lecciones de método:** (a) las primeras contrapruebas de la barrera **no mordieron y casi las doy por buenas** — el `sd` no había aplicado y los tests pasaban por eso, no por estar bien; una contraprueba que pasa hay que auditarla igual que un test que falla, verificando que el archivo cambió de verdad; (b) el `typecheck:full` que se arregló horas antes **atrapó de inmediato mi propio archivo nuevo** (dos `TS2322`/`TS2532` bajo `noUncheckedIndexedAccess`) — el guardarraíl se pagó solo el mismo día. — `topic_key: sellpoint/dependabot-0x-sin-agrupar`
- **2026-08-19 (CORRECCIÓN DE LA CORRECCIÓN — el flake es UNA clase: desincronización HTTP)** — Por la mañana escribí acá que el flake **es** `ECONNRESET`, transporte, caso cerrado. **Demasiado estrecho.** A la tarde, verificando F3-NAV-03, aparecieron dos signaturas más en specs sin relación: `expected 201 "Created", got 404 "Not Found"` (invitación, traspasos, lotes) y **`Parse Error: Expected HTTP/, RTSP/ or ICE/`** (tenants-me). Esa última es la que unifica: un "Parse Error" significa que el cliente leyó bytes **que no son una respuesta HTTP**, o sea que la respuesta llegó desincronizada de la request — y un 404 sobre un route que existe encaja exactamente con leer la respuesta equivocada. Las tres son la misma clase, no tres bugs. Eso explica de una los síntomas que nunca cerraban: test distinto cada vez, siempre verde al correr el spec solo, y el `flushdb` "arreglando" por azar. **Frecuencia medida hoy: 1 de cada 3 corridas completas.** **Mecanismos descartados CON evidencia:** (a) keep-alive reusado por el cliente — pino muestra `connection: close` en cada request; (b) apps sin cerrar acumulando servidores — los 34 specs reales tienen `app.close()`. **La causa raíz sigue SIN determinar, y esta vez no se escribe ninguna.** **Lección, que ya es un patrón mío y no del bug:** tres veces seguidas convertí *una* evidencia en *la* causa sin esperar la segunda muestra — el throttler (falso), el estado de BD (no confirmado), el ECONNRESET (parcial). Lo que destrabó las tres fue lo mismo: **capturar la salida completa a un archivo y correr en bucle**, en vez de filtrar con `grep` en la terminal, que se comía el motivo. — `topic_key: sellpoint/e2e-flake-diagnostico`
- **2026-08-19 (REVISIÓN MANUAL DE CARLOS — dos huecos reales y un bypass que los tests no vieron)** — Con las 57 tareas en verde, Carlos probó el sistema a mano y en el primer flujo (alta de producto con lote → entrada) encontró lo que 600 tests contra mocks no habían visto. **(1) El lote no se podía capturar**: el API exige `lotCode` en un producto con `tracks_lots` (`inventory.lot_required`), el DTO lo acepta, el tipo del front lo declara… y la cara del documento **nunca pintó los inputs**. El error "falta indicar cuál" era un callejón sin salida — pedía algo que la pantalla no dejaba dar. La captura (lote + caducidad, autosave con debounce como cantidad y costo) vive ahora bajo el nombre del producto, **solo en entradas**: en la salida lo elige FEFO y en el conteo viene por la planilla. **(2) El selector duplicado**: el alta crea sola la presentación "Unidad" (factor 1) y el selector ofrecía además la opción sintética "Unidad base" — dos nombres para la misma cosa. **(3) El que Carlos no reportó pero estaba en su propia captura**: la opción sintética **no pasa por `allowFractionalInput`**, así que elegirla era un bypass de "solo enteros" — 0.9999 tabletas aceptadas, `0 → 0.9999` en la previa. La sintética ahora muere cuando una presentación de factor 1 ya representa la base, y se conserva solo mientras la línea siga guardada sin presentación (esconderla mentiría sobre el estado real). **Por qué los tests no lo vieron:** todos los fixtures de la cara de entrada usaban `tracksLots: false` y productos sin presentación de factor 1 — el camino feliz del que escribió los tests, no el del que da de alta un producto real, donde la presentación default SIEMPRE existe. La revisión manual de F1-WEB-AUTH había dejado la misma lección (4 hallazgos que 460 tests no vieron) y volvió a pagar. — `topic_key: sellpoint/revision-manual-lotes-y-presentaciones`
- **2026-08-19 (CATÁLOGO DE SERVICIOS — el POS no podía cobrar trabajo, solo mercancía)** — Carlos detectó un faltante de diseño: no existía forma de registrar **servicios** (código, descripción, costo, precio) y el POS de F4 los necesita — `SaleItem` exigía `product_id`, el carrito asumía presentaciones y códigos de barras, y lo más cercano a un servicio en todo el plan era «mano de obra»… diferido a **Fase 9** como vertical de pago. Un negocio de estética, un taller o un consultorio no habrían podido cobrar su trabajo. **La decisión de fondo: tabla propia `services`, NO un producto con bandera.** `Product` arrastra `base_unit`, `tracks_lots`, `stock_min`, composición y presentaciones — todo sin sentido para un servicio; meterlo ahí obligaría a media tabla en NULL y a que **cada query de inventario filtre servicios para siempre**. El costo real de la bandera no es el schema, es el `WHERE is_service = false` que alguien va a olvidar. Permisos propios `services:*` (Manager los recibe por la regla implícita — operación diaria; `POS_SELLER_CODES` gana el `:read` porque en F4 sin leerlos no hay qué vender). La coherencia con F4 queda como tarea explícita (F3-SVC-05): `SaleItem` pasa a `product_id` nullable + `service_id` nullable + CHECK exactamente-uno, la línea de servicio **no toca** el ledger de stock, y el Strategy del carrito gana `ServiceLookup`. Módulo **F3-SVC** con 5 tareas (~8 h); la fase pasa de 57 a 62 tareas. **Lección de alcance:** el hueco no lo encontró un test ni el checklist — lo encontró Carlos pensando en su cliente real. Los criterios de cierre verifican lo que el diseño contempló; lo que el diseño no contempló no tiene criterio que falle. — `topic_key: sellpoint/catalogo-servicios`
- **2026-08-19 (ALMACÉN ASIGNADO — el POS no sabía de dónde salen las ventas, y "sucursal" no era el problema)** — Segunda detección de Carlos en la misma sesión de planeación pre-POS: «el almacén del POS» aparece **una sola vez** en todo el corpus (VISTAS §9) y nunca se define — `CashboxSession` sin campos, `Sale` sin `warehouse_id`, y CU-SYS-04 (5a) presuponiendo un vínculo POS↔almacén que ningún modelo declara. La pregunta de Carlos venía envuelta en un dilema de nombres (¿renombrar Almacén a Sucursal? ¿crear un objeto Sucursales?) y **el análisis separó dos conceptos que viajaban disfrazados de uno**: el **alcance** (lista, dónde *puede* operar — ya existía, F2-SCOPE) y la **asignación** (uno solo, desde dónde *opera por defecto* — no existía en ningún lado). La venta no sale de "una lista": sale de un almacén concreto. **Se descartaron con evidencia las dos alternativas:** renombrar a Sucursal convierte la «Bodega Norte» del propio mockup en una sucursal falsa (el doc fuente del cliente ya decía «almacenes/sucursales» — el nombre lo pone cada negocio en cada almacén); y una entidad Branch nueva no responde la pregunta del POS, la **delega** (necesitaría su propio almacén default), contra un diseño que es plano tenant→almacén a propósito (ARQUITECTURA §3.4 declara el escalado a cadena «sin refactor» y F7 monetiza por `max_warehouses`). **Lo que entra:** módulo F3-HOME (5 tareas, ~8.5 h) — `users.default_warehouse_id` con backfill mono-almacén, selector en el form de usuarios, **el tenant nace con su almacén** («Almacén Central»/«Main Warehouse» por locale, creado en `provision()` y renombrable en el paso 3 del onboarding, que pasa de crear a renombrar), preselección en movimientos, y la coherencia F4 escrita: `usuario.asignado → turno de caja → venta → ledger`. La fase pasa de 62 a 67 tareas. **Regla que fija el diseño:** encoger el alcance por debajo del asignado da 409 explícito, NO auto-limpia — en F4 el turno depende del asignado y limpiarlo en silencio dejaría al vendedor varado sin explicación. — `topic_key: sellpoint/almacen-asignado`
- **2026-08-19 (F3-HOME — el almacén asignado, y un seed que llevaba meses roto)** — Implementadas las cinco tareas del módulo que separa **asignación** (uno solo, desde dónde opera) de **alcance** (una lista, dónde puede operar). **Tres hallazgos que no estaban en el plan.** **(1) El seed estaba roto**: `user.upsert` usaba `tenantId_email`, un unique compuesto que NO existe — el de email es un índice FUNCIONAL sobre `lower(email)`, como advierte el propio comentario del schema. Llevaba roto desde que ese índice se volvió funcional y nadie lo notó porque `db seed` solo corre a mano en dev. Lo destapó querer verificar que el tenant demo tuviera su almacén; de paso ese tenant dejó de estar `onboarded` **sin un solo almacén**, un estado que ningún tenant real puede alcanzar desde que `provision()` crea el suyo. **Un seed que produce estados imposibles es un seed que miente.** **(2) Un test propio cazó un bug propio**: la primera versión de la preselección inicializaba el listado con el asignado **a ciegas**, y el test de "un asignado fuera de las opciones no se fuerza" salió rojo — habría mandado al API un almacén que rechaza. La lógica se movió a `WarehouseSelect`, donde está la lista de opciones, y ahí compone con el auto-select de "hay uno solo" en vez de competir con él. **(3) El gotcha de React Query mordió por SEGUNDA vez el mismo día** (contexto como 2º argumento del `mutationFn` cuando se le pasa la función del api directamente) — y el repo **ya lo tenía documentado** en `movements-documents.test.tsx`; no lo busqué. Buscar en los tests del propio repo antes de depurar sale más barato que depurar. **Decisión de diseño que quedó fijada:** el PATCH manda el asignado **solo si cambió** — mandarlo siempre reescribía un campo que nadie tocó, y tres tests existentes que afirmaban el payload exacto hicieron de guardarraíl. Y el `typecheck:full` arreglado ayer atrapó **ocho** fixtures sin el campo nuevo. — `topic_key: sellpoint/almacen-asignado`
- **2026-08-19 (SERVICIOS POR ALMACÉN — el catálogo maestro y la disponibilidad explícita)** — Tercera iteración de diseño del día sobre servicios: Carlos definió que el menú Servicios es el **catálogo MAESTRO** y que cada servicio se asocia a **almacenes concretos** — en F4 el POS solo ofrecerá los servicios asociados al almacén del turno, y para productos solo lo que tenga stock ahí. **La decisión de fondo fue suya y va contra el precedente**: se le presentó el default permisivo del alcance de usuarios (vacío = todos) y eligió la semántica **EXPLÍCITA** — sin almacenes marcados, el servicio NO se vende. Su modelo mental: el checklist ES la disponibilidad. Se aceptó con **dos mitigaciones** que absorben lo que el default permisivo evitaba: el backfill de la migración asocia todo lo existente a todos los almacenes activos (nada deja de venderse en silencio al llegar F4), y el alta nace con todos marcados (desmarcar es restringir; el negocio chico no gestiona nada). **La consecuencia que queda viva y documentada**: un almacén nuevo nace sin servicios hasta que alguien los asocie. **Diseño**: tabla puente `service_warehouses` (molde `user_warehouse_scopes` MÁS el índice por `warehouse_id` que aquella omitió — la query estrella del POS es «servicios de ESTE almacén»); sin endpoints nuevos: `warehouseIds` viaja en el create/update existentes en la MISMA tx, porque todo vive en el form (Carlos eliminó la acción «Asignar almacenes» del listado que él mismo había propuesto — mejor una sola puerta). Módulo F3-SVC crece a 9 tareas; la fase pasa de 67 a 71. **Al implementarlo (mismo día) salieron tres cosas:** (a) `warehouseIds` quedó **requerido** en el alta y no opcional-con-default — con la semántica explícita, olvidarlo crearía un servicio invendible **en silencio**, así que el contrato obliga a decirlo aunque sea `[]`; eso rompió los siete e2e de F3-SVC-03 que no lo mandaban, y actualizarlos fue lo correcto porque el contrato cambió. (b) El canario nuevo que verifica **el índice por `warehouse_id`** no es ceremonia: `user_warehouse_scopes` omitió ese índice y acá la query estrella es la inversa. (c) El gotcha de React Query apareció en su forma **INVERSA** — `updateService` va por un wrapper y NO recibe el contexto, mientras `createService` sí lo recibe: la misma suite necesita `expect.anything()` en un caso y no en el otro. — `topic_key: sellpoint/servicios-por-almacen`
- **2026-08-20 (LAS TABLAS QUE SE DESBORDAN — arreglar la instancia dejó viva la clase)** — Carlos reportó que en celular los listados de Entradas, Salidas y Traspasos **se siguen desbordando**. El «se siguen» es la parte importante: el 2026-08-19 ya se había arreglado exactamente este defecto en la tabla del DETALLE del documento, y nadie miró si había más. **Había cuatro**, y la barrera las encontró — además de los dos listados que Carlos vio, **«Stock por almacén» y «Próximos a vencer»** tenían el mismo problema sin que él llegara a esa pantalla. **El hallazgo de fondo:** el `<Table>` compartido de `components/ui/table.tsx` **YA resuelve esto** — envuelve en `overflow-x-auto` y da `px-3` a las celdas. Seis archivos de inventario escribieron su propia `<table className="w-full">` a mano y se saltaron las dos cosas sin enterarse. Una `w-full` con más columnas de las que caben NO se encoge: desborda la página entera, y en un celular el usuario arrastra el menú y el encabezado de lado. **La clase la protege ahora `tablas-responsivas.test.ts`**, que escanea todo `.tsx` y exige que cada `<table>` cruda tenga un `overflow-x-auto` en las tres líneas de arriba (más lejos que eso ya no es envolver, es esperanza). **Dos errores propios en el camino, los dos repetidos del día anterior:** el comentario JSX como primer hijo de un ternario es inválido (mismo tropiezo que en `document-detail`), y como hijo directo de un elemento SÍ necesita llaves — el linter cazó el segundo. **Lección, que ya es un patrón:** cuando un bug de presentación aparece en un lugar, la pregunta no es «¿lo arreglé?» sino «¿dónde más vive el mismo código?». Acá la respuesta eran cinco archivos más. — `topic_key: sellpoint/tablas-responsivas`
- **2026-08-20 (EL CHECKLIST DE CIERRE DE F3 — ejecutado, no leído: tres criterios no se sostenían)** — Se corrieron los 23 criterios uno por uno, con el precedente de F1/F2 encima («declarar una fase completa no la cierra; el checklist es el contrato»). **Tres no se sostenían, y ninguno se habría notado leyéndolos:** **(1)** el criterio de RLS decía «las tablas nuevas pasan **los 4 canarios**» y `product_lots`/`stock_lots` solo tenían el test **estructural** de `pg_class` — la policy existía, pero nadie probaba que filtrara. Una policy que existe no es una policy que filtra: la contraprueba (borrarla) tiró los 10 tests, y antes no habría tirado ninguno. **(2)** El PDF de 300 líneas: `headerRows: 1` estaba escrito en el renderer desde F3-DOC y **ningún test lo tocaba** — de la hoja 2 en adelante habría columnas de números sin encabezado, y el criterio afirmaba que eso ya funcionaba. **(3)** `sinRecetaId`/`sinReceta` seguían vivos en `composition-expander.integration.spec.ts`: el vocabulario exacto que F3-GUARDS-02 limpió del service, sobreviviendo en un test que nadie volvió a leer. **Un cuarto hit se dejó explícitamente SIN resolver y documentado**: el placeholder «Limpieza, producción, mantenimiento…» matchea `production` en el grep de genericidad, pero ese término está en el patrón para cazar un **campo** `production` en compuestos, no una palabra de ejemplo. Pasa el espíritu y falla la letra — y **no se tocó el criterio para que pasara**, que habría sido mover la portería. **Lección, la misma de los tags de F1/F2 pero ahora con evidencia propia:** los criterios que se leen se creen; los que se ejecutan se caen. Tres de 23 — un 13% de un checklist que cualquiera habría jurado verde. — `topic_key: sellpoint/checklist-cierre-f3`
- **2026-08-20 (F4 ATOMIZADA + LA COTIZACIÓN SE ADELANTA DE F9)** — La fase pasa de un outline de 12 bullets a **25 tareas en 9 módulos (~54 h)**, y absorbe el **módulo de Cotización** que Fase 9 tenía como `F9-QUOTE-*`: Carlos lo necesita YA para un mostrador de recepción antes de la caja (y mañana para clínicas donde el médico arma la receta que el POS cobra). **El adelanto costó cuatro tareas y cero refactor** — la previsión de F4-DB (`Sale.quote_id` reservado) y del strategy de lookups (`QuoteLookup` nombrado) estaba pagada desde la atomización de F3. **Tres decisiones de Carlos fijaron el diseño:** permiso propio **`pos:quote`** (la recepción cotiza sin poder cobrar — y el médico de F9 heredará ese permiso sin caja); la cotización **no exige turno** (no toca dinero ni stock; filtra por el almacén ASIGNADO del cotizador); y —la que más simplifica— **la cotización no congela precios**: los impresos son referencia y al cargarla en el POS se recalculan del catálogo vigente, lo que elimina vigencias, estados `expired` y promesas de precio de un plumazo. **Dos hallazgos de la exploración quedaron resueltos en el plan:** `pos:view` era un **permiso fantasma** (VISTAS §9.3 lo exigía y no existía en el catálogo — nace en F4-DB-03 en vez de heredarse el hueco), y el renderer del PDF **no se reusa** para el ticket (es carta, con firmas y sin precios): el ticket es plantilla nueva con el mismo pdfmake, compartiendo patrón, service y transporte. **`F4-PRINT-BT` quedó DIFERIDA** (decisión de Carlos): sin impresora térmica real contra la que probar, implementarla sería código de fe. **Y la lección del cierre de F3 se aplicó al abrir F4:** la «Definición de Fase 4 completa» se escribió AHORA, antes de la primera tarea — con el criterio de los canarios de COMPORTAMIENTO explícito, porque una policy que existe no es una policy que filtra. — `topic_key: sellpoint/f4-atomizacion`
- **2026-08-20 (LA PÁGINA QUE SE DESLIZA — blindar la clase en vez de cazar la instancia)** — Carlos reportó que en su celular **la página entera** se corre de lado en la pantalla de Entradas. **Primera hipótesis, medida y DESCARTADA:** faltaba `min-w-0` en el `<main>`. Se midió en un navegador real, con el CSS del proyecto, a 390 px: **da 390 con y sin él** — en un flex COLUMNA el `min-width: auto` no aplica al eje horizontal, y el `min-w-0` que importa ya lo tenía la columna. Medirlo antes de deployar evitó vender un arreglo que no arreglaba nada; la barrera que quedó lo dice explícitamente para que nadie crea lo contrario en seis meses. **Segunda medición:** se replicó la pantalla (formulario de cabecera + tabla) a 390 px y **no se reprodujo el desborde** — el elemento culpable sigue SIN identificar. **Decisión: blindar en vez de adivinar.** Un cuarto intento a ciegas era peor que hacer la clase imposible: `overflow-x-hidden` en el `<main>` garantiza que la página no arrastre el menú de lado pase lo que pase adentro, y es seguro porque **todo lo ancho ya vive en su propia caja con scroll** — nada queda inaccesible, solo deja de empujar. **Y lo que Carlos eligió:** las tablas pasan a `<ScrollableTable>`, que además **avisa cuando hay más columnas de las que caben** (degradado en el borde + leyenda), midiendo el desborde de verdad en vez de adivinar por ancho de pantalla, y ocultando el aviso al llegar al final — una leyenda que está siempre se vuelve decorado y deja de leerse. **Verificado en navegador**, no solo en tests: con 9 columnas (646 px de contenido en 358 visibles) la página mide 390 y no se desborda, y el aviso se dispara. **Lección de método:** cuando dos intentos de arreglar un síntoma fallan, el tercero no debería ser otra hipótesis — debería ser una restricción que haga el síntoma imposible. — `topic_key: sellpoint/pagina-que-se-desliza`
- **2026-08-20 (UN LOTE VENCIDO DECÍA «VENCE PRONTO» — y FEFO lo PREFERÍA)** — Carlos reportó que un lote caducado hace 19 días mostraba la etiqueta ámbar «vence pronto». La causa: `expiringSoon` se calculaba solo con `expiresAt <= hoy+30`, y una fecha del PASADO también cumple eso. Se partió en dos estados **excluyentes** — `expired` (rojo, `destructive`) estrictamente antes de hoy y `expiringSoon` entre hoy y +30 — con la regla de que **el día que vence, el lote todavía sirve** (`<` estricto contra medianoche UTC). No era cosmético: FEFO ordena por caducidad ascendente, así que el vencido era literalmente **el primero que elegía** para la próxima salida. Arreglar el color destapó el agujero de fondo (entrada siguiente). Commits `1dd8f12` y `5f56ca9` (el aviso de stock insuficiente ahora nombra el SKU). — `topic_key: sellpoint/lote-vencido-en-rojo`
- **2026-08-20 (UN LOTE VENCIDO NO SE VENDE — la regla y sus dos puertas)** — «No puedes vender un producto vencido» (Carlos), y después: «no bloquees transfer, por ahora sólo venta y cotización». Nace **`REASONS_REJECTING_EXPIRED_LOTS = ["sale"]`** en `@sellpoint/shared` con `rejectsExpiredLots()`. Dos puertas, porque una sola no alcanzaba: **FEFO excluye los vencidos** cuando el motivo lo exige (con `expiredSkipped` en el plan para que el error diga «hay 12, pero está vencido» en vez del mentiroso «no hay stock»), y **el resolver rechaza el lote vencido elegido A MANO** (`expired_lot_not_sellable`) — sin eso bastaba teclear el código del lote para saltarse la regla. `expired`, `loss`, `adjustment`, `physical_count` y `transfer` siguen pudiendo moverlo: la mercancía caducada tiene que poder darse de baja y un conteo tiene que poder cuadrar. **Gotcha del shortfall:** filtrar vencidos ANTES de calcular el faltante hacía que «todo vencido» se viera igual que «producto sin lotes» y la venta pasara sin lote — por eso el reparto mira una lista y el faltante otra. **La cotización de F4 hereda la regla pero NO pasa por el ledger** (no tiene `reason_code`): su bloqueo va en la disponibilidad de F4-QUOTE-01, anotado ahí. Commit `0af80fe`. — `topic_key: sellpoint/lotes-vencidos-no-se-venden`
- **2026-08-20 (LA RECEPCIÓN DE UN TRASPASO ES DERIVADA, NO EDITABLE)** — Carlos recibió SAL-000002 en producción y reportó cuatro defectos con una causa: la recepción se trataba como documento cualquiera. El `<select>` de motivo recibía `value="transfer"` — que **no está** entre los elegibles, a propósito — y caía a la primera opción: la recepción se anunciaba «Factura de compra», y quien intentara corregirla solo podía elegir otro motivo, cuyo PATCH suelta el `linked_warehouse_id` y **rompe el vínculo** (el mismo 500 de ENT-000002 por otra puerta). Ahora la cabecera se MUESTRA (`CabeceraDeTraspaso`) y el API rechaza con 409 `transfer_header_locked` — pero solo los dos campos derivados: **la nota sigue editable** (un primer intento bloqueó el PATCH entero y el e2e de recepción con faltante lo cazó — el test rojo tenía razón). Además: «Almacén ORIGEN» en la entrada (era «destino»), caducidad del lote precargada para cotejar contra la caja, y la lista de tránsito dice «Continuar ENT-xxx» en vez de repetir «Recibir». Commit `a15a432`. — `topic_key: sellpoint/traspaso-recepcion-derivada`
- **2026-08-20 (ANULAR UNA RECEPCIÓN ENCERRABA EL TRASPASO PARA SIEMPRE)** — Carlos anuló ENT-000002 esperando recibir de nuevo, y el traspaso quedó sin salida: el índice único parcial de F3-DOC-01 (`UNIQUE (transfer_id, type)`) **no excluía los anulados**, así que decía «una recepción en toda la historia» en vez de «una recepción viva». El criterio del arreglo salió del propio sistema: anular es volver a empezar sin borrar el rastro (el folio se queda con el anulado, la serie no reusa números). El índice gana `AND status <> 'canceled'`, `createReceiptDraft` ignora recepciones anuladas, y el botón vuelve a decir «Recibir». La invariante que importa se conserva: a lo sumo una recepción VIVA — dos personas recibiendo a la vez siguen chocando. **Ojo**: el índice parcial vive solo en SQL de migración (Prisma no soporta `WHERE` en `@@unique`) — buscarlo en `schema.prisma` no lo encuentra. Commit `61a9a54`. — `topic_key: sellpoint/recepcion-anulada-reabre-traspaso`
- **2026-08-20 (EL NAMESPACE `pdf` NUNCA EXISTIÓ — todos los PDFs salieron con claves crudas)** — Carlos abrió el PDF de un traspaso real: `pdf.warehouse`, `pdf.type.exit`, `pdf.reason.transfer` impresos tal cual. No había `src/i18n/{es,en}/pdf.json` y nestjs-i18n devuelve la clave cuando no la encuentra — **desde F3-DOC-07, ningún PDF salió traducido y ningún test lo vio**, porque el spec del renderer usa `t = (key) => key` para verificar ESTRUCTURA: con esa `t`, roto y sano son idénticos. Se creó el namespace (con `pdf.reasonLabel` porque `pdf.reason` no podía ser etiqueta y prefijo a la vez), el otro almacén se llama **ORIGEN** en la entrada (mismo criterio que la pantalla), y quedaron **dos barreras**: `message-keys.spec.ts` gana el canal `t("ns.clave")` (solo escaneaba claves de ERROR) y `pdf-keys.spec.ts` recorre el **CONTRATO** (`MOVEMENT_REASONS`, `INVENTORY_DOCUMENT_TYPES`) porque `pdf.reason.${code}` se arma en runtime y ningún regex la ve — cuando F4 estrene `sale`/`sale_return`, se pone rojo solo. **Recordatorio que dejó**: hay DOS catálogos i18n (API y web) y las claves de error van en el del API. La verificación final fue ejecutar el renderer DENTRO del contenedor de producción — el navegador servía respuestas viejas y midió mal. Commit `c2811fe`. — `topic_key: sellpoint/pdf-i18n-namespace`
- **2026-08-20 (QUÉ PRODUCTO MIRAS ES PARTE DE DÓNDE ESTÁS)** — Carlos: estando en el Kardex, clic en «Productos» no volvía al listado. No era un clic perdido: el producto abierto vivía en un `useState`, así que detalle y listado compartían la URL `/catalog/products` — el menú navegaba a donde ya estabas y el router, con razón, no hacía nada. El producto y la pestaña pasan a la URL (`?open=<id>&tab=kardex`) con `validateSearch` como aduana (una pestaña inventada cae en `info`). El menú funciona como **consecuencia**, no como parche — y de regalo: la flecha ATRÁS funciona, F5 deja donde estabas, y el kardex de un producto es un enlace compartible. Alcance deliberado: **solo Productos** — Servicios, Subcatálogos y Campos muestran su formulario ENCIMA de la lista (no la reemplazan) y meter un form a medio llenar en la URL prometería una vuelta que es falsa. Commit `4ca0453`. — `topic_key: sellpoint/detalle-en-la-url`
- **2026-08-20 (LOS DECIMALES LOS DECIDE LA UNIDAD, NO LA COLUMNA)** — Carlos vio `+12.0000` y saldo `262.0000` en el kardex de un producto en piezas: la columna es `numeric(_,4)` y la pantalla pintaba el string tal cual. Propuso recortar ceros valor por valor; se le recomendó lo contrario y aceptó: **la precisión es propiedad de lo que se MIDE** — un kardex se lee en vertical y con decimales variables el ojo no compara magnitudes. Nace `formatQuantity(valor, unidadBase)` en `@sellpoint/shared` junto a `units.ts` (la regla sale de la **categoría** que la unidad ya conocía: `count` → 0, `weight/volume/length` → 3), con **válvula de seguridad**: un decimal que NO cabe en su unidad se muestra igual — `262.5` piezas es un dato imposible y redondearlo a 263 lo escondería; el número raro tiene que verse raro. Aritmética de strings, no `Number` (un float puede correr un dígito). Aplicado en kardex, stock por almacén y documento; el PDF ya salía limpio. **Gotcha de proceso**: 227 tests rojos tras el cambio NO eran el cambio — Colima estaba apagado; el rojo no siempre acusa a lo último que tocaste. Commit `322bcbb`. — `topic_key: sellpoint/formato-cantidades`
- **2026-08-20 (LA UNIDAD `unit` SE LLAMA PIEZA — y el nombre se COPIA al crear el producto)** — Pedido de Carlos, con una razón mejor que el gusto: el campo se llama «Unidad base» y ofrecía «Unidad» entre sus opciones — la misma palabra para el envase y uno de sus contenidos. Solo cambia el NOMBRE (es/en y plurales): el código sigue siendo `unit` y `products.base_unit` no se mueve. **El deploy se cayó y CI tenía razón**: un e2e afirmaba que el alta crea la presentación base «Unidad ×1» — y destapó que `basePresentationName` **COPIA** el nombre a la fila al crear el producto (dato del tenant, editable), así que renombrar la unidad no alcanzaba: el catálogo quedaba partido («Unidad ×1» los viejos, «Pieza ×1» los nuevos). Migración quirúrgica: solo filas con `factor = 1`, producto en `unit` y el nombre **exactamente** el autogenerado — una presentación renombrada a mano se respeta. **Costo declarado, no tapado**: «Unidad→Unidades» era el ÚNICO plural no derivable con `+"s"` y sostenía el test «el plural es un DATO»; con «Pieza» las nueve unidades pluralizan regular y ese test perdió los dientes — quedó reescrito diciéndolo. **Dos lecciones de proceso**: `pnpm test` NO incluye el e2e (son CUATRO suites: test, test:e2e, vitest web, typecheck+lint) y `packages/shared` se consume por `dist` (editar su fuente sin `pnpm build` deja al API leyendo lo viejo). Commits `439b6c7` + `75867df`. — `topic_key: sellpoint/unidad-renombrada-a-pieza`
- **2026-08-21 (F1-LOCALE-07 ESTABA HECHA — y su única viñeta pendiente se había retirado a propósito)** — Carlos preguntó por qué seguía sin cerrar la única tarea abierta de una fase declarada completa. **Estaba implementada**: el `<CurrencySelector>` vive en el paso 1, el submit persiste `tenant.currency` y los 67 tests del onboarding pasan. Se hizo DENTRO de `F1-WEB-ONBOARD-01` (commit `7aabc2d`), tal como la bitácora del 2026-08-13 anticipó — y a su gemela `F1-LOCALE-08` sí le pusieron la cruz. **Dos desvíos deliberados**, ambos mejores que lo escrito: el default se **deriva del país** en vez de ser MXN fijo (`5bb12b3`), y la **advertencia de inmutabilidad se retiró** (`8f86df2`, decisión de Carlos) — correcta entonces, porque `hasTransactions()` devolvía `false` siempre y advertía de un bloqueo inexistente. **Lo que cambió y nadie miró:** desde F3-GUARDS-01 el gate cuenta `stock_movements` de verdad, así que hoy la moneda **sí** se congela con el primer movimiento y la pantalla no lo dice. **Lección:** un checkbox sin cruz no significa «falta hacerlo» — puede significar «se hizo en otro lado y nadie volvió». Y arreglar un guard puede reactivar una advertencia que se había retirado por inútil: los cambios de circunstancia no avisan. — `topic_key: sellpoint/f1-locale-07-cierre-retroactivo`
- **2026-08-21 (SINCRONÍA PRE-F4 — los cuatro documentos cuentan el mismo diseño ANTES de la primera tarea)** — Carlos pidió re-verificar la atomización de F4 y actualizar los documentos: la fase ya estaba atomizada (2026-08-20) y cubría todo lo re-pedido, pero **los cuatro documentos de diseño no sabían del adelanto de la cotización** — VISTAS con CERO menciones, ARQUITECTURA vendiéndola como add-on de pago de F9 con estados/vigencia que contradicen las decisiones de Carlos, CASOS_DE_USO sin CU-POS-04/05, FLUJOS prometiendo el Bluetooth diferido. La sincronía que F4-DOCS-01 preveía al FINAL se hizo AHORA (VISTAS §9.5 + sidebar como grupo + fantasmas `pos:close_cashbox`/`pos:annul` fuera; CU-POS-01..03 revisados y 04/05 nuevos; FLUJOS §6.1 con turno/folio-en-tx/idempotencia y §6.2 cotización; ARQUITECTURA con la Fase 4 real, CINCO series y el glosario corregido), y F4-DOCS-01 queda como sincronía FINAL post-implementación. **Del repaso de bitácora salieron ajustes a tareas**: pdfmake sigue en 0.2.x a propósito (F4-TICKET-01), el ticket usa `unitName`/`formatQuantity` (nunca el código crudo), el gotcha ICU de monedas (2026-07-16) va al display de precios, «almacén nuevo nace sin servicios» al verificar de `ServiceLookup`, y una tarea nueva **F4-TICKET-03**: el PDF de documentos de F3 imprime `30 unit` en vez de `30 piezas` — defecto preexistente, más visible tras el renombre. 25 → **26 tareas (~55 h)**. — `topic_key: sellpoint/sincronia-pre-f4`
- **2026-08-21 (F4-CART — el buscador, el carrito, el numpad y el escáner)** — Las cuatro tareas del módulo, con tres hallazgos que corrigieron el tablero. **(1) `products.barcode` nunca existió**: el tablero pedía que `BarcodeLookup` cayera a esa columna "legacy" después de `product_presentations.barcode`, y el esquema no la tiene — el código de barras nació en la presentación con F2-PRESENT. Se implementó solo la real y se corrigió la Salida de F4-CART-01; un catálogo con códigos alfanuméricos igual se encuentra por `TextSearchLookup`. **(2) Filtrar por `stock_by_warehouse > 0` habría escondido TODOS los compuestos** — un compuesto no tiene saldo propio, lo que sale del almacén son sus componentes. De ahí salió `sellableStock`, que además descuenta lo vencido de los productos con lotes (FEFO lo rechazaría en la caja) y usa la MISMA fórmula que F2-BOM-02 para lo armable. **(3) La aritmética del navegador no se podía hacer con `Number`**: `0.1 * 3` da `0.30000000000000004` y un POS que imprime eso perdió la discusión antes de empezarla — nacieron `multiplyMoney`, `addQuantities` y `parseQuantity` sobre enteros escalados, con `decimal-text.ts` como parser único. **Decisiones de diseño**: las strategies exactas (código, SKU, folio) CORTAN la cadena y vienen marcadas `exact` para que escanear vaya derecho al carrito, mientras las difusas corren juntas y se suman; un acierto exacto que NO existe no corta —cae a la difusa—, porque corta el acierto y no el intento; las cantidades del carrito son TEXTO porque `"12."` es un estado legítimo que ningún `number` representa; el faltante se MARCA y no bloquea, porque quien tiene el saldo del instante es el API. `@zxing/browser` entra diferido (pesa y casi ningún turno abre la cámara) y excluido del grupo de Dependabot por ser 0.x. — `topic_key: sellpoint/f4-cart-buscador-y-carrito`
- **2026-08-21 (DEFER.1 CERRADA — la deuda con fecha se cobró, y la fecha se verificó midiendo)** — **Mergeada `defer-1-retirar-fallback-token`: el lector de `?token=` ya no existe, solo `#token=`.** Lo que vale la pena recordar no es el merge sino cómo se decidió el momento. La regla escrita decía «no antes del 2026-08-22», y la fecha era una CUENTA: deploy de D3 el 15/08 + el TTL más largo (invitación, 7 días) = último link viejo muerto el 22. Pero una fecha calculada sigue siendo un proxy de la pregunta real —**¿queda vivo algún link con formato viejo?**— y esa se puede MEDIR. Se midió en producción: las tres invitaciones canjeables son del **16/08** (posteriores al deploy, ya con `#token=`), no hay un solo token sin usar anterior a esa fecha, el más viejo (15/08 05:16) se canjeó un minuto después, y `email_verification_tokens` no tiene ninguno vivo (TTL 24 h). **Cero links rotos posibles**, así que se mergeó el 21 con la aprobación de Carlos. **Lección:** una deuda con fecha es mejor que una deuda indefinida, pero una deuda con CONDICIÓN MEDIBLE es mejor que las dos — la fecha te dice cuándo mirar, la medición te dice si ya. De paso se corrigió el autor del commit (`carlos@quotanda.com` → `carls.hlm@gmail.com`): la rama nunca se había pusheado, así que no fue reescribir historia publicada sino evitar un commit 308 con el correo equivocado. — `topic_key: sellpoint/defer-1-token-query`
- **2026-08-21 (F4-UI-01/02 — el POS ya cobra, y dos correcciones al tablero)** — La pantalla de venta y el panel de cobro. **La decisión que importa: la `Idempotency-Key` nace al ABRIR el panel, no en el clic**, y el primer test que escribí para probarlo era FALSO — hacía dos clics seguidos y pasaba igual con la clave generada en el clic, porque lo que frenaba el segundo era el botón deshabilitado. Probaba el botón, no la clave. El escenario real de la idempotencia es otro: **fallo y reintento** —el cobro falla, el cajero vuelve a tocar, el servidor ya había asentado la venta—, y ahí lo único que impide cobrar dos veces es que el reintento traiga la misma clave. El test reescrito sí se pone rojo con la contraprueba. **Dos correcciones al tablero:** (a) el rechazo por stock es **422**, no el 409 que decía la tarea —el ledger usa `UnprocessableEntityException`, el mismo código de todo el inventario desde F3—; (b) para que el rechazo cayera SOBRE su renglón hubo que mandar el `sku` culpable **fuera de `args`**: el filtro consume `args` para traducir y lo descarta, así que un dato de RUTEO no podía viajar ahí. La alternativa —que el front sacara el SKU parseando el mensaje ya traducido— se rompe al cambiar de idioma o al retocar una coma del copy. Ese pasaje («todo lo que no sea `args` sobrevive») era un ACCIDENTE del `{ args, ...rest }` sin nada que lo fijara, y ahora tiene test propio: el día que alguien ponga una lista blanca de claves, el POS dejaría de señalar la línea y nadie se enteraría hasta verlo en un mostrador. — `topic_key: sellpoint/f4-ui-cobro`
- **2026-08-21 (EL FLAKE DEL E2E TIENE CAUSA — supertest quema un puerto efímero por request)** — **Diagnosticado y medido**, después de días abierto. Los síntomas eran `read ECONNRESET` y `Parse Error: Expected HTTP/`, en un spec distinto cada corrida y siempre verde aislado. **La causa:** los e2e hacen `app.init()`, que NO deja el servidor escuchando, así que supertest abre un listener efímero **por cada petición** y lo cierra al recibir la respuesta. La medición sobre `pos-lookup`: **110 requests → 110 puertos distintos**; agregando `await app.listen(0)` en el `beforeAll`, **110 requests → 1 puerto**. Una corrida completa quema más de 4.000 puertos contra el rango efímero de macOS (49152-65535, ~16k) con TIME_WAIT de 15 s: cuando un puerto se recicla mientras el anterior sigue en TIME_WAIT, el cliente lee basura y sale `ECONNRESET`. Explica las tres propiedades del flake que lo hacían incomprensible: por qué cambia de spec (el puerto que colisiona es azaroso), por qué siempre pasa aislado (una sola suite no agota el rango) y **por qué empeoró hoy** (correr la suite entera muchas veces seguidas no deja drenar el pool). `maxWorkers` ya era 1, así que nunca fue paralelismo. **APLICADO el mismo día** con la aprobación de Carlos: un helper `startTestApp(app)` en `test/e2e/support/` que hace `init()` **y** `listen(0)`, con la explicación completa en UN solo lugar, más los 38 specs migrados. Y una **barrera** en la suite unitaria (`e2e-harness.spec.ts`) porque el arreglo es invisible: un spec nuevo copiado de un archivo viejo, o escrito de memoria con el `app.init()` que sale en toda la documentación de Nest, reintroduciría el bug sin que nada se ponga rojo. La barrera **encontró un caso que el script de migración no vio** (`auth-throttling` menciona `app.init()` en un comentario) y se ajustó para ignorar comentarios: una barrera que se dispara con prosa es una que la gente aprende a esquivar reescribiendo comentarios en vez de arreglando código. **Resultado medido:** 3.142 requests → **39 puertos** (uno por suite), **cero `ECONNRESET`** (había 18) y **tres corridas completas seguidas en 510/510**. — `topic_key: sellpoint/flake-e2e-puertos-efimeros`
- **2026-08-21 (F4-QUOTE — la cotización, y dos cosas que el tablero no había previsto)** — Las cuatro tareas del módulo. La cotización es **una lista con folio, no una operación**: no escribe un solo `stock_movement`, no reserva nada y no exige turno de caja — cotizar es responder "¿cuánto me sale?", y eso pasa en el mostrador o por teléfono. De ahí sus tres diferencias con la venta (`pos:quote` en vez de `pos:sell`, almacén del cotizador en vez del turno, precios de REFERENCIA que se relean al cargar). **Cerró el lado de la regla de Carlos que F3 no pudo:** lo vencido no se cotiza, y su bloqueo vive sobre `sellableStock` —la misma consulta que alimenta al buscador— porque una cotización no tiene `reason_code` del cual colgarlo. **Lo que el tablero no previó (1):** cotizar no exige turno pero el LOOKUP sí lo exigía con un 409, así que la pantalla de cotización no habría podido buscar nada. Se resolvió aditivamente —`warehouseId` explícito que se usa solo sin turno; con turno, gana el turno— y al agregarlo apareció **un agujero de seguridad**: `assertWarehouseInScope` con alcance `all` acepta cualquier uuid, así que un almacén de OTRO TENANT devolvía 200 con lista vacía, confirmando de paso que el identificador tenía forma válida. Hacen falta las DOS guardas; `assertActiveWarehouse` es la que contesta 404. Lo cazó un e2e que escribí para la funcionalidad nueva. **Lo que el tablero no previó (2):** volcar la cotización al carrito necesitaba que el `for-sale` devolviera lo que el carrito sabe consumir. En vez de inventar una segunda estructura parecida, se devuelve **el mismo `LookupItem` del buscador** (`conDisponibilidad` y `SELECT_PRODUCTO` pasaron a exportarse): así volcar es un `add()` por línea, sin traducción y sin dos formas que un día diverjan. **Un 500 cazado por el e2e:** la transición de la cotización a `loaded` estaba DESPUÉS del `sale.create`, así que el UNIQUE `sales.quote_id` saltaba primero con un P2002 crudo. Movida antes, la colisión es un 409 con mensaje. — `topic_key: sellpoint/f4-quote-cotizacion`
- **2026-08-21 (F4-TICKET — el papel, y una barrera que ya existía para este error)** — Las tres tareas. **F4-TICKET-03** saldó la deuda de F3: el PDF firmable decía `36 unit` —el CÓDIGO de la unidad— y ahora dice `36 piezas`, con la cantidad por `formatQuantity()`. El tablero suponía que el renderer recibía el locale y **no lo recibía**: solo una `t(key)`, que traduce claves y no sabe de idiomas. Se agregó `locale` al input, y va aparte de `t` a propósito — el nombre de un kilo vive en `UNITS` de shared, no en el namespace `pdf`, y duplicarlo como `pdf.unit.kg` sería tenerlo en dos lugares. **F4-TICKET-01**: plantilla nueva, no reuso del renderer de F3 — aquel es carta con firmas y costos de compra, este una tira de 58/80 mm con precios de venta y sin dónde firmar; compartirlos habría dado un archivo lleno de `if (esTicket)`. Lo que SÍ se comparte es el patrón: función pura que devuelve el `docDefinition` para poder testear **qué dice el papel** en vez de comparar bytes. **La cotización se ve distinta de un ticket** —marca COTIZACIÓN y la leyenda de que el precio final se calcula en caja— y eso no es cortesía: los precios no se congelan, así que sin la leyenda el cliente vuelve en un mes reclamando un número que el sistema ya no reconoce. **Lo que vale la pena recordar:** el ticket arma `t(\`ticket.method.${paymentMethod}\`)`, una clave DINÁMICA que ningún escáner de literales ve — exactamente la trampa para la que se construyó `pdf-keys.spec.ts` en F3. Se extendió esa barrera en vez de escribir una nueva: el día que entre un método de pago (vales, monedero, crédito) el test se pone rojo antes de que un cliente reciba un ticket que diga `ticket.method.voucher`. **F4-TICKET-02 con desvío deliberado**: el tablero pedía `window.print` + CSS `@page`; se abre el PDF del servidor porque hacerlo con CSS obligaba a mantener dos plantillas del mismo papel. — `topic_key: sellpoint/f4-ticket-el-papel`
- **2026-08-21 (LA PRUEBA DE PUNTA A PUNTA — `VTA-000001` gastada, y un defecto que solo se veía en producción)** — Con el ticket desplegado se hizo la prueba completa contra la base real, la que se había pospuesto a propósito para gastar el primer folio una sola vez. **La cadena entera verificada:** turno abierto → buscar «advil» (dijo «250 piezas disponibles · 15 vencidas», el descuento de lo caducado funcionando sobre datos reales) → carrito → cobro con vuelto ($100 → $50.00) → `VTA-000001` cobrada → ticket `200 application/pdf VTA-000001.pdf` de 2.296 bytes → historial → anulación con motivo → cierre de caja. **Los dos números que importan:** el stock hizo 265 → 264 → **265**, exactamente donde empezó; y los movimientos fueron `exit sale` del lote **`st1`** y `entry sale_return` **al MISMO `st1`**. FEFO eligió el lote que vence primero ENTRE LOS VIVOS —`st1` vence el 23/08, saltó el `cad12` vencido el 01/08 y no tocó el `st2` de 2030— y el reverso volvió al lote del que salió, no a un montón genérico: si hubiera vuelto a `st2`, el saldo cuadraría y la caducidad estaría mintiendo. El arqueo cerró en $0.00 con «0 ventas», porque una anulada deja de sumar. **El defecto que destapó:** el carrito decía **«1 piezas»**. Cuatro pantallas —carrito, buscador, saldo por almacén, detalle de documento— llamaban a `unitName(..., { plural: true })` por su cuenta, así que el plural no miraba la cantidad. Se centralizó en `formatQuantityWithUnit` y `unitLabelFor` (dos formas de la MISMA decisión: una arma el texto completo, la otra sirve a los mensajes de i18n que interpolan cantidad y unidad por separado). **Lo que NO se tocó:** `presentations-tab` pluraliza siempre y está BIEN — «las equivalencias se expresan en piezas» es una etiqueta suelta, no acompaña a ningún número. **Lección: un defecto de una sola letra que ningún test unitario iba a encontrar, porque todos los fixtures usaban cantidad 2.** — `topic_key: sellpoint/prueba-punta-a-punta-pos`
- **2026-08-21 (F4-PWA-01 y F4-DOCS-01 — CIERRE DE LA FASE 4)** — **PWA:** manifest instalable (`standalone`, `scope`, icono `maskable` con zona segura — Android RECORTA el icono con la forma que el fabricante elija, y el favicon llena su lienzo de borde a borde) + service worker propio. Se descartó `vite-plugin-pwa`: precachear la lista del build hace falta para servir TODO offline, y acá solo importa que la app ABRA. **La regla del worker: el API NUNCA se cachea**, ni por origen ni por ruta — servir un `/pos/lookup` guardado mostraría el stock de hace una hora y el cajero vendería lo que ya no está. El aviso de sin conexión dice **qué no se puede hacer**, no solo que no hay red: la app abre y muestra la pantalla de venta completa, así que un «sin conexión» a secas dejaría al cajero deduciendo por qué no pasa nada. Barrera propia (`pwa-contract.test.ts`) porque un manifest y un `sw.js` son archivos estáticos que ningún `render()` toca. **DOCS — las divergencias que la implementación reveló, corregidas del lado que estaba mal:** (a) FLUJOS §6.1 prometía `GET /products?barcode=` y el buscador es `GET /pos/lookup?q=` con cinco strategies; (b) el rechazo por concurrencia decía 409 y son **422** con el `sku` culpable fuera de `args`; (c) los tres docs prometían `window.print()` + CSS `@page` y se abre el **PDF del servidor** —hacerlo con CSS obligaba a mantener dos plantillas del mismo ticket—; (d) ARQUITECTURA §4 listaba `escpos-buffer` + Web Bluetooth y `vite-plugin-pwa` como tecnologías: **ninguna de las tres se usó**, y ahora la tabla dice qué se usó Y por qué se descartaron; (e) el wireframe del historial mostraba «# Venta 4523» y filtros de fecha/vendedor/turno que existen en el API y no en la pantalla — se documentó la diferencia en vez de fingir que no está. **El grep de genericidad sigue con sus hits conocidos**, todos ejemplos de wireframe (un tenant de muestra, un email), no supuestos de rubro en el código. — `topic_key: sellpoint/f4-cierre-pwa-y-docs`
- **2026-08-21 (ATOMIZACIÓN DE F5 — 24 tareas en 9 módulos, y cuatro fantasmas menos en los docs)** — La Fase 5 pasó de un outline de 8 líneas a 24 tareas (~40 h) con su «Definición de Fase 5 completa» escrita ANTES de la primera tarea (regla de F4-DOCS-01: el checklist es el contrato). **Las decisiones:** (1) el permiso es **`reports:read`** — ya vivía en producción asignado a 4 roles y con CERO endpoints que lo exigieran (la barrera `permissions-catalog.spec.ts` lo había detectado huérfano); los docs decían `reports:view`, mandó el código. (2) **`reports:export` NO se crea**: era un fantasma de VISTAS §11.2 que nunca existió en ningún catálogo — exportar es leer (criterio «reimprimir es leer» de F4-UI-03), y la matriz daba asignación idéntica a ver y exportar: dos permisos con la misma asignación es un permiso de más. (3) **Exportación SÍNCRONA con tope de filas** (~10 000; superarlo → 400 que pide acotar filtros, nunca un Excel truncado en silencio — se lee como completo); la cola Redis + worker + S3 + URL firmada que FLUJOS §8 prometía **nunca se construyó** y queda DIFERIDA con el criterio F4-PRINT-BT: sin caso real, código de fe. El diagrama se reescribió al flujo real. (4) **Costo promedio ponderado GLOBAL por producto** (decisión de Carlos, cerrando el «a decidir» que la Bitácora de F3 dejó el 2026-08-17): un traspaso no cambia lo que costó la mercancía; si un día cada sucursal compra a precios muy distintos, se migra. (5) **Catálogo/usuarios/almacenes son export directo sin pantalla** — una tabla duplicaría los listados existentes; y el export de catálogo necesita SU endpoint porque el de la plantilla de importación exige `products:manage` y un Viewer no podría usarlo (hueco que la exploración destapó). **Lo que se reusa y quedó fijado en las tareas:** `serializeSpreadsheet` de F2 (solo se parametriza hoja/filename), `kardex.service.list` para el export (cero segunda implementación del saldo), el builder de `where` de ventas compartido con el POS sin tocar la semántica de `GET /pos/sales`, y el helper de descarga de blob que hoy está copiado CUATRO veces en el front. VISTAS §10 pasó de 6 a 8 tarjetas (entran Vencimientos y Tránsito, herencias F3) y CASOS_DE_USO ganó CU-REP-05 (exports directos). — `topic_key: sellpoint/f5-atomizacion`
- **2026-08-22 (EL MENÚ NO SE PODÍA DESPLAZAR EN EL CELULAR — y `min-h-0`, la clase que nadie recuerda)** — Carlos reportó con captura que en móvil el menú se corta y no hay forma de llegar a Usuarios ni Roles. **Medido en el navegador antes de tocar nada** (regla del 2026-08-19: los bugs de CSS no se diagnostican en jsdom): en una pantalla de 700 px el menú mide **844** de contenido, «Roles» terminaba en el píxel **892** y `overflow-y` era `visible` — sin scroll posible. El síntoma clave estaba en un solo número: `clientHeight === scrollHeight === 844`, o sea que el `<nav>` **se desbordaba del `<aside>`** en vez de estar contenido. **El arreglo son TRES clases y ninguna sobra:** `flex-1` (para que el nav ocupe el resto y no crezca libre), `overflow-y-auto` (la barra) y **`min-h-0`** — la que nadie recuerda: un hijo de flex tiene `min-height: auto` y se NIEGA a encoger por debajo de su contenido, así que sin ella `overflow-y-auto` no se activa nunca. Verificado sobre el DOM real de producción aplicando las clases en vivo: el alto visible pasó de 844 a **644** (el nav quedó contenido) y deslizando 200 px «Roles» entra en pantalla. **Barrera nueva** `lib/ui/menu-desplazable.test.ts`, molde de `tablas-responsivas.test.ts`: es un test de FUENTE y no de render porque en jsdom `scrollHeight` vale 0 y un test montado pasaría verde con el bug puesto — lo que se fija es el contrato de las tres clases, con contraprueba de cada una por separado. **Dos lecciones de test frágil, las dos mías:** (a) mi propio selector exigía `<nav ` con espacio y se rompió solo cuando el formateador partió la etiqueta en varias líneas; (b) el arreglo puso rojo a una barrera EXISTENTE (`app-layout.test.tsx`) que buscaba «la primera línea con `flex-1` y `flex-col`» — mi nav se convirtió en ese primer match y el test empezó a vigilar un elemento que no era el suyo. Se precisó a `<div` con esas clases: **un selector que agarra «la primera línea que se parezca» mide lo que encuentra, no lo que le importa.** — `topic_key: sellpoint/menu-movil-no-scrolleaba`
- **2026-08-22 (DOS ITEMS DEL MENÚ RESALTADOS A LA VEZ — el prefijo que enciende de más)** — Carlos reportó que al entrar a Cotización, Historial o Cierre de caja, «Venta» quedaba resaltado también. **Medido en producción:** en `/pos/quotes` había **2 links con la clase `active`** — `/pos` y `/pos/quotes`. La causa es el default de TanStack Router: un `<Link>` se marca activo cuando la ruta actual EMPIEZA con su destino, así que `/pos` se enciende en sus tres hijos. Dos items resaltados no es solo feo: el menú deja de responder la única pregunta que tiene, «¿dónde estoy?». **El arreglo es `activeOptions={{ exact: true }}` en `/pos`**, pero la barrera vigila la CLASE, no el caso: `lib/ui/menu-activo-exacto.test.ts` deriva del propio archivo qué links son PREFIJO de otro y exige `activeOptions` en cada uno. Contraprobada dos veces: quitando el fix (rojo nombrando `/pos`) y **simulando un F5 futuro** con `/reports` + `/reports/stock` sin exact (rojo también) — que es la razón de que la barrera exista, porque hoy `/pos` es el único infractor y arreglar solo esa línea dejaba la trampa armada para el próximo grupo con hub e hijos. **Nota de método:** la primera versión de esa segunda contraprueba insertó las rutas como líneas sueltas en vez de dentro de un `<Link>`, así que el parser no las vio y la contraprueba «pasó» sin medir nada — se rehízo con JSX real. Una contraprueba mal armada no prueba que el test sea débil: no prueba nada. — `topic_key: sellpoint/menu-prefijo-resaltado-doble`
- **2026-08-22 (LA CÁMARA QUE SE APAGABA SOLA — un efecto no puede depender de un estado que él mismo cambia)** — Carlos reportó con captura que al elegir «Escanear con la cámara» daba el permiso, la imagen aparecía **un milisegundo** y la pantalla quedaba negra. No era el permiso: el componente se apagaba solo. **La causa, leída en el código:** el `useEffect` que enciende la cámara tenía `estado` en sus dependencias y adentro llamaba a `setEstado("leyendo")` tras un arranque exitoso. React ejecuta el **cleanup** en esa transición, y el cleanup hace `controles.stop()`. Encendía, pintaba un cuadro y moría. **El colmo:** el comentario que yo mismo había escrito en ese archivo decía que el ref «tiene que sobrevivir al cleanup» — identifiqué el riesgo y tres líneas después escribí el código que lo provoca. **El arreglo separa dos cosas que estaban fusionadas en un solo `useState`:** la **INTENCIÓN** (`encendida`, un booleano que es la ÚNICA dependencia del efecto) y la **FASE** que se pinta (`apagado`/`encendiendo`/`leyendo`/`sin-camara`), que ahora cambia sin volver a disparar nada. La regla general, que aplica a cualquier efecto que abre un recurso — sockets, observers, timers, streams: **un efecto no puede depender de un estado que él mismo cambia, porque cada cambio equivale a desmontarlo.** De paso, el apagado se unificó: el botón solo baja la intención y el `stop()` lo hace el cleanup, en vez de dos lugares que apagan sin saber uno del otro. **Segundo defecto encontrado de camino:** al `<video>` le faltaban `autoPlay` y `muted`. Los tres atributos son necesarios y `muted` no es cosmético — sin él la política de autoplay del navegador móvil **bloquea la reproducción** y el stream queda adjunto sin correr: la misma pantalla negra por otra causa. Efecto colateral simpático: con `muted`, la regla `useMediaCaption` de Biome dejó de dispararse sola (un video sin audio no tiene qué subtitular) y el `biome-ignore` que la suprimía quedó marcado como supresión inútil — una supresión menos. **Por qué los 30 tests de `pos-cart.test.tsx` no lo vieron:** en jsdom NO hay cámara, así que el camino de arranque exitoso caía SIEMPRE en «sin cámara» y nunca se ejercitaba; el bug vivía en las líneas que ningún test recorría. El nuevo `barcode-scanner.test.tsx` simula `@zxing/browser` para poder recorrerlo, y su test principal se llama «tras encender, NADIE apaga la cámara». Contraprobado devolviendo la dependencia (4 rojos) y quitando `muted` (1 rojo). **Nota de método, segunda vez esta semana:** la primera contraprueba de `muted` **no midió nada** — mi `replace` buscaba el atributo en su propia línea y Biome ya había colapsado el `<video>` a una sola, así que el parche no se aplicó y el test «pasó». Ahora los scripts de contraprueba llevan un `assert` que revienta si el patrón no coincidió: **una contraprueba que no se aplicó se ve idéntica a un test débil.** — `topic_key: sellpoint/f4-cart-04-camara-pantalla-negra`
- **2026-08-22 (EL ESCÁNER QUE NO LEÍA NADA — tres defaults de la librería que se suman)** — Con la cámara ya visible, Carlos: «no detecta el código de barras o no sé qué estoy haciendo mal». **No estaba haciendo nada mal.** Antes de tocar código se descartó la mitad barata del problema **midiendo en producción con Playwright**: se tecleó `064042603179` a mano en el buscador de cotización —misma cadena de búsqueda que la venta, y sin turno— y el producto apareció con su precio. Backend, stock, almacén y turno: los cuatro sanos. El problema estaba entero en el lector. **Tres defaults de `@zxing/browser@0.2.1`, leídos en su fuente y no adivinados:** (1) `decodeFromVideoDevice(undefined, …)` arma `{ video: { facingMode: 'environment' } }` **y nada más** — sin `width`/`height` el navegador entrega su default, típicamente **640×480**; un UPC-A son 95 módulos, así que ocupando media pantalla quedan **~3 px por barra**, al filo de lo decodificable y a merced de cualquier temblor. (2) `delayBetweenScanAttempts` vale **500 ms**: DOS intentos por segundo, o sea aguantar el pulso como en una foto larga. (3) Sin `TRY_HARDER`, `OneDReader.doDecode` mira **`maxLines = 25`** filas alrededor del centro y no rota la imagen; con el hint mira el alto completo y reintenta a 90°. **Ninguno de los tres se ve leyendo el componente** — son defaults de la librería, y esa es justamente la razón de que los fije el test. Se pasó además de `BrowserMultiFormatReader` a **`BrowserMultiFormatOneDReader`**: una caja escanea EAN, UPC y Code-128, y probar QR, Aztec, PDF417 y DataMatrix en cada ciclo gastaba el presupuesto del intento en formatos que nadie va a presentar en un mostrador. **Detalle de dependencias:** `TRY_HARDER` se escribe como el literal `3` con su porqué en el comentario — el enum `DecodeHintType` vive en `@zxing/library`, que no es dependencia declarada de la app, y agregar el paquete entero al bundle por una constante numérica no se paga; el valor queda fijado por el test. **Lo que Carlos tenía mal, y que NO era el bloqueo:** había capturado el código en el **SKU** del producto, no en el campo «Código de barras» de la presentación (que es donde vive: `barcode` solo existe en `ProductPresentation`). Igual lo encontraba, porque una estrategia exclusiva que **falla** no corta la cadena —solo corta el ACIERTO— y caía a `SkuLookup`, que hace match exacto. Se le señaló igual: **funciona por coincidencia**, y el día que le ponga un SKU interno tipo `OAT-001` escanear deja de andar. — `topic_key: sellpoint/escaner-defaults-zxing`
- **2026-08-22 (LA SEGUNDA PANTALLA NEGRA — la carrera que mi propio arreglo dejó armada)** — Carlos, minutos después del deploy anterior: la cámara volvió a quedar negra, **y esta vez sin pedir permisos**. Ese detalle era el diagnóstico entero. La carrera: el `<video>` se montaba cuando la FASE dejaba de ser «apagado», pero la fase se enciende DENTRO del efecto — y el efecto corre tras un commit en el que el video **aún no existía**. Con `@zxing/browser` ya en caché, el `await import` resuelve en un **microtask**, que le gana al re-render de React (tarea del scheduler): `videoRef.current` era `null` y el código hacía un `return` **MUDO** — ni `getUserMedia`, ni permisos, ni error, solo el rectángulo `bg-black` para siempre. **Por eso la primera prueba de Carlos funcionó y la segunda no:** la primera vez el chunk de zxing se descargaba POR RED y React alcanzaba a repintar antes de que el import resolviera; con el módulo en caché la carrera se pierde siempre. Un bug que se cura solo la primera vez y aparece a partir de la segunda es de los que más confunden al que reporta. **El arreglo:** el `<video>` se monta con la **INTENCIÓN** (`encendida`) — React asigna los refs en el commit y corre los efectos DESPUÉS, así que con ese gate el ref existe siempre que el efecto corra, gane quien gane la carrera del import. Y el `return` mudo se murió: un video `null` ahora LANZA y cae al aviso de «sin cámara» — **un fallo que no se dice es el más caro de diagnosticar**. La lección que completa la del turno anterior: separar intención y fase estuvo bien, pero quedó a medias — **lo que el efecto necesita en el DOM se monta con la intención, no con la fase**; la fase es solo para lo que se pinta alrededor. **Por qué la fija una barrera de FUENTE y no un test de comportamiento:** en jsdom la carrera no se reproduce — `act` aplana los renders antes de drenar los microtasks, así que el video siempre llega a tiempo y los 9 tests de comportamiento pasaban con el bug puesto. La barrera exige que la guardia JSX del video lea `encendida` y prohíbe `fase`/`estado`, contraprobada devolviendo el gate a la fase. **Y el tropiezo repetido, tercera vez en la semana:** la primera versión de la barrera hizo `indexOf("<video")` y midió un `<video` de un COMENTARIO — la misma lección del `<nav>` del día 20. Quedó anclada en `ref={videoRef}`, que solo existe en el JSX real. — `topic_key: sellpoint/escaner-carrera-video-ref`
- **2026-08-22 (LA LENTE EQUIVOCADA — tercera pantalla negra del día, y esta vez la cámara SÍ arrancaba)** — Carlos, desde su Samsung: el punto verde de Android aparece (~2 s) y el recuadro sigue negro. Ese punto verde era el dato que cambiaba todo: **`getUserMedia` corría** — el fallo ya no estaba en el arranque sino en lo que la cámara entregaba. (Nota al margen: en Android 12+ el indicador se MINIMIZA a un puntito a los pocos segundos; que «se quite» no significa que la cámara se apagó.) **La causa es un problema documentado de los teléfonos con varias cámaras traseras:** cuando `getUserMedia` recibe `facingMode` JUNTO con una resolución, Chrome a veces resuelve el pedido eligiendo una lente auxiliar —macro, profundidad— que entrega **cuadros negros con el stream perfectamente vivo**. Y la resolución 1920×1080 la metí YO en el arreglo del lector: cada arreglo de esta cadena destapó al siguiente (mudo → configuración → carrera → lente), porque cada uno dejaba llegar más lejos. **El arreglo son DOS pasos:** `getUserMedia` solo con `facingMode: "environment"` (el navegador elige la trasera PRINCIPAL) y `applyConstraints(RESOLUCION_IDEAL)` sobre el track **ya elegido** — `applyConstraints` no cambia de dispositivo, sube la resolución de la lente buena, y si el modo no existe se queda en lo que dé. La regla que queda fijada por par de tests: **la resolución no puede participar en la ELECCIÓN del dispositivo.** **Y dos silencios menos, cazados de paso:** (1) el track ahora se VIGILA — `ended` → aviso de «sin cámara», porque si otra app toma la cámara o el sistema la corta, el stream muere SIN excepción y quedaría el cuadro negro mudo; (2) el `catch` ya no traga: apaga el stream propio (sin esto, un fallo post-getUserMedia dejaba la luz de la cámara prendida sin imagen) y hace `console.error` — ese catch ya se había tragado DOS bugs en silencio, y con un teléfono por USB `chrome://inspect` ahora muestra la causa en una línea. **Límite del método, dicho honestamente:** este bug NO se pudo reproducir localmente — el navegador de pruebas no tiene cámara y los tests de jsdom simulan el stream; el diagnóstico sale del síntoma (arranca + negro) más el problema conocido de los multi-lente, y las cuatro defensas quedaron contraprobadas una por una (resolución de vuelta en getUserMedia, sin applyConstraints, sin vigilancia, catch sin apagar). Si aún así sigue negro, el console.error convierte la siguiente ronda de adivinanzas en una lectura. — `topic_key: sellpoint/escaner-lente-samsung`
- **2026-08-22 (CUARTA PANTALLA NEGRA: ERA TRY_HARDER — y la primera vez que el bug se MIDIÓ en vez de teorizarse)** — Carlos probó desde su MacBook Air y falló igual que en el Samsung: eso **enterró la teoría de la lente** como causa (el fix anterior sigue siendo correcto para los multi-lente, pero no era ESTE bug). La diferencia del cuarto intento: **por fin se pudo reproducir** — un Chrome lanzado con `--use-fake-device-for-media-stream` (cámara falsa, sin permisos del sistema) contra el chunk desplegado, con `getUserMedia` y `track.stop()` interceptados para tener cronología. El resultado: track vivo a los 302 ms, y a los **764 ms `disposeMediaStream` DE LA PROPIA LIBRERÍA** apagándolo — con `srcObject = null`, sin excepción hacia afuera y sin tocar ningún estado nuestro. **El A/B de configuraciones lo aisló en una línea:** con `TRY_HARDER`, el PRIMER cuadro sin código lanza `Error: Could not create a Canvas element.` — el camino de rotación de `@zxing/browser@0.2.1` está roto — y zxing, ante un error que no es NotFound/Checksum/Format, **mata el stream él solo**; sin el hint, NotFoundException continuo (lo normal mientras no hay código a la vista) y el track sigue `live`. O sea: el escáner se suicidaba al primer cuadro **en cualquier dispositivo**, y el hint lo había pedido yo dos arreglos atrás para «mirar la imagen entera». Se va, y el test que exigía su presencia ahora fija su **AUSENCIA** — el mismo test, invertido, con la autopsia en el comentario. El costo real de perderlo: ~25 filas del centro y sin rotación, es decir, el código se presenta horizontal como en cualquier escáner de mostrador. **Por qué las tres vigilancias anteriores no lo vieron, y la que sí lo ve:** `track.stop()` programático **NO dispara "ended"** — los navegadores lo reservan para muertes de origen físico — así que el listener del track era ciego a esta muerte; la huella que sí queda es el `srcObject = null`, que dispara **"emptied"** en el `<video>`: vigilancia nueva con su test, y ahora CUALQUIER auto-destrucción de zxing muestra el aviso en vez del cuadro negro. **Verificación de cierre, misma vara que el diagnóstico:** re-corrida la reproducción instrumentada contra producción ya desplegada — track `live` a los 7 s, video `ready=4` a 1920×1080 reproduciendo, cero `stop()`. Antes: muerto a los 764 ms. **Las dos lecciones que valen más que el fix:** (1) cuando el mismo síntoma sobrevive a dos arreglos razonados, la inversión correcta no es la tercera teoría sino el arnés de medición — la cámara falsa + interceptar `stop()` costó veinte minutos y convirtió tres días de adivinanzas en un A/B de cuatro casos; (2) un feature pedido con buena intención (TRY_HARDER «para leer mejor») puede ser el asesino exacto de lo que quería mejorar — la única defensa es medir el camino completo en el entorno real, porque jsdom con mocks pasaba en verde con el escáner suicidándose en producción. — `topic_key: sellpoint/escaner-try-harder-asesino`
- **2026-08-22 (EL ESCÁNER, ESTADO AL CIERRE DEL DÍA — queda UNA variable: el enfoque)** — Tras el TRY_HARDER asesino hubo dos rondas más el mismo día. **Quinta:** enfoque continuo (`focusMode: "continuous"`) y zoom 2× vía `applyConstraints({ advanced })`, cada ajuste en su propio set y SOLO si `getCapabilities()` los declara; de paso quedó verificado que zxing decodifica al tamaño REAL del stream (`videoWidth`, no el CSS). **Sexta:** la captura de Carlos mostró el código en el TERCIO INFERIOR — el lector 1D barre ~25 filas del CENTRO — así que nació la **guía de centrado** (línea al centro del video + pista i18n) y el zoom pasó a ser **del usuario**: botones 1×/2×/5× filtrados por el tope de la lente. Dos cazas internas en el camino: la barrera de theming rechazó `bg-red-500` crudo (token `bg-destructive`), y el deploy falló en `typecheck:full` por un cast que mi typecheck local había bendecido — **los dos scripts son idénticos (`tsc -b`); la diferencia era el `.tsbuildinfo` rancio**: cuando el CI contradice al typecheck local, la sospecha es el caché, y la verificación que vale es `tsc -b --force`. **El estado, con las tres capturas de Carlos a 1×/2×/5×:** el zoom SÍ se aplica (su Samsung expone zoom vía web — los botones aparecen y actúan), el encuadre a 5× es perfecto con la línea cruzando el código… **y la imagen está desenfocada en los tres niveles**: barras corridas, y un 1D necesita nitidez a nivel de barra. La escena además está oscura (obturación lenta → blur de mano encima). `focusMode: continuous` o no está en las capabilities de esa lente o Chrome no reenfoca de cerca con él. **PLAN PARA MAÑANA, en orden de palanca:** (1) **`BarcodeDetector` nativo de Chrome Android primero, zxing de fallback** — es ML Kit por debajo: tolera blur, rotación y poca luz muchísimo mejor que zxing y es el candidato a resolver todo de un golpe; feature-detect con `"BarcodeDetector" in window`. (2) **Torch**: si `capabilities.torch`, botón de linterna — más luz = más profundidad de campo + obturación corta, ataca el blur por las dos vías. (3) **Enfoque manual cercano**: si las capabilities traen `focusMode: "manual"` + rango `focusDistance`, fijar ~10–15 cm, que es lo que hacen los escáneres dedicados. (4) **Diagnóstico previo a todo**: volcar `getCapabilities()` completo a consola (`console.info`) y leerlo con el teléfono por USB en `chrome://inspect` — decidir (2) y (3) con datos de ESA lente, no adivinando. La decodificación efectiva sigue sin confirmar en hardware real; todo lo demás del escáner (arranque, vida del stream, encuadre, zoom, avisos de muerte) quedó verificado y con barreras. — `topic_key: sellpoint/escaner-pendiente-enfoque`
- **2026-08-23 (EL ESCÁNER LEE — el detector nativo cerró la cacería, y la franja de mostrador)** — Se ejecutó el plan anotado al cierre del 22, y **el primer punto bastó**: con `BarcodeDetector` nativo de Chrome Android (ML Kit por debajo) como camino preferente, **la caja se leyó al primer intento** pese al desenfoque que zxing nunca pudo superar — confirmado por Carlos en su Samsung, en producción. Los tres puntos quedaron implementados igual: (1) **nativo primero, zxing de fallback universal** — y el import de zxing se movió DENTRO de la rama de fallback, así que el camino nativo ni siquiera lo descarga; solo formatos 1D, mismo criterio de siempre; en el camino nativo el componente es su propio loop (`detect()` cada 100 ms, attach manual del stream, `stop()` propio que para tracks y suelta `srcObject` — lo que de paso dispara la vigilancia «emptied» existente, con `cancelado` cubriendo el caso legítimo). (2) **Linterna** si `capabilities.torch` — y el botón APARECIÓ en el Samsung de Carlos: su lente lo expone. (3) **Foco fijo de mostrador** (~15 cm acotado al rango) si hay `focusMode: manual` + `focusDistance`, en el MISMO set de advanced (van juntos o no van) y sin pedir el continuo a la vez. `getCapabilities()` completo quedó en `console.info` para diagnósticos futuros por USB. **Remate de UX pedido por Carlos con el escaneo ya vivo:** el recuadro abarcaba casi todo el celular; quedó como **franja de ~190 px** estilo escáner de paquetería — para leer no hace falta ver la escena, hace falta ver la línea y el código sobre ella, y una franja baja obliga a centrar. La finura técnica: `object-cover` recorta solo lo VISUAL — el detector sigue recibiendo el cuadro completo — y el recorte simétrico deja el centro visible exactamente donde la guía dice. **Dos tropiezos de proceso, anotados sin anestesia:** (a) reporté un push como hecho cuando el pre-commit lo había RECHAZADO (biome quería partir una línea del test que no formateé) — Carlos lo cazó con «no veo el push»; la verificación de un push es el hash en el remoto, no el comando lanzado; (b) el mismo formateo faltante había pasado mi `biome check --write` porque solo listé 3 de los 4 archivos tocados. **Saldo de la cacería completa (22–23 de agosto): siete rondas, cuatro pantallas negras, un lector ciego, un desenfoque y una franja — todo con RED→GREEN, contraprueba y verificación en producción.** El escáner del POS queda FUNCIONAL en hardware real. — `topic_key: sellpoint/escaner-lee-detector-nativo`
- **2026-08-27 (F6-DRILL-01, CERRADA — el backup restaura de verdad, y en 19 segundos)** — Primer restore drill end-to-end: dump real de R2 (`rclone copy`) → api del sandbox parado → `pg_restore --clean --if-exists` por stdin de `docker exec -i` conservando owners (los roles existen en ambos clusters con el mismo nombre; sus passwords NO viajan en el dump) → api healthy. **RTO medido: 19 s de máquina** con la DB actual de 388 KB (re-medir cuando crezca); **RPO real: la edad del dump** — cron diario a las 09:15 UTC, así que hasta 24 h (en el drill: 7 h 38 m). Verificación de oro: login en sandbox.sellpointy.com con credenciales de PRODUCCIÓN y la venta VTA-000022 con su barcode servida desde la base restaurada. Efecto lateral asumido: el sandbox queda como ESPEJO de prod (el tenant de prueba propio se pierde con `--clean`) — es una feature, no un daño: sandbox con datos realistas. — `topic_key: sellpoint/f6-restore-drill` — cierra: F6-DRILL-01
- **2026-08-27 (F6-DRILL-02, CERRADA — el guardián del deploy revierte de verdad, visto tres veces)** — Rollback drill contra el sandbox con fallo inducido, sin un solo commit basura: los overrides del script (`SMOKE_DOMAIN` inválido) son la palanca. **Ensayo A** (tag inexistente): el migrate falla y el script revierte `IMAGE_TAG` SIN desplegar — servicio 200 intacto durante todo el ensayo. **Ensayo B1, hallazgo fino:** un "rollback" entre commits SOLO de infra es un no-op benigno — buildx + cache reproducen el mismo digest y ambos tags apuntan a la misma imagen; la rama corre entera pero no hay binario que intercambiar. **Ensayo B2, la prueba real** (sha de ayer con código distinto + smoke saboteado): desplegó la versión vieja, el smoke falló 30×5s y `rollback_and_exit` recreó la original — el `StartedAt` fresco del contenedor con la imagen correcta es la evidencia del intercambio ida y vuelta. **Bonus aprendido:** `prisma migrate deploy` con imagen vieja contra una DB más nueva NO falla (ignora migraciones aplicadas que no conoce) — el riesgo del rollback lejano es el código viejo contra el schema nuevo, exactamente el argumento de la retención de 24 h. — `topic_key: sellpoint/f6-rollback-drill` — cierra: F6-DRILL-02
- **2026-08-27 (F6-BACKUPS-01 y 02, CERRADAS — el backup grita al fallar y viaja cifrado)** — `backup-postgres.sh` ganó un `trap ERR` con paso marcado (`PASO=`) que manda correo vía Resend con las MISMAS credenciales del .env que cert-expiry-check (fail-mode benigno: sin credenciales, solo log — avisar jamás rompe el respaldo), y cifrado `age` con la clave pública en `/opt/sellpoint/age-recipient.txt` — la PRIVADA vive con Carlos fuera del server; sin recipient el backup se degrada a subir sin cifrar Y LO AVISA (degradación visible, nunca silenciosa). Verificación triple el mismo día: corrida real dejó `sellpoint-20260827-1725.dump.age` en R2; el objeto descifra a un pg_dump válido de `sellpoint_prod` (`age -d | pg_restore --list`); y una copia con bucket roto disparó el trap en el paso correcto («subida a R2») con su correo. El procedimiento de restore del docblock ganó el paso de descifrado. — `topic_key: sellpoint/f6-backups-endurecidos` — cierra: F6-BACKUPS-01, F6-BACKUPS-02
- **2026-08-27 (F6-WATCH-01 y 02, CERRADAS — ojos externos sin cargarle un gramo al server)** — UptimeRobot free con 2 monitores a los `/api/health` de app y sandbox (5 min, alertas al correo personal; ambos Up 100% desde el arranque). Sentry SOLO errores en sus dos proyectos: el front con `@sentry/react` de import DINÁMICO tras doble gate (DSN presente Y hostname `app.sellpointy.com` — la misma imagen sirve al sandbox y jamás debe reportar desde ahí; apagado, el SDK ni se descarga) y el api capturando en `AllExceptionsFilter` SOLO los 5xx (los 4xx son del cliente), con `Sentry.init` condicionado a `SENTRY_DSN` del .env. Tracing/replay/profiling apagados por la LEY de la fase — hasta el wizard de Sentry terminó configurado igual. Verificación de punta a punta: evento de fuego enviado desde el contenedor de prod (`flush: ENVIADO`), DSN del front confirmado horneado en el bundle desplegado, y el issue VISTO por Carlos en su dashboard. — `topic_key: sellpoint/f6-watch` — cierra: F6-WATCH-01, F6-WATCH-02
- **2026-08-27 (F6-EDGE, F6-SUPPLY y F6-SECRETS, CERRADOS — la cola de la fase en una tarde)** — EDGE: Permissions-Policy en el snippet común con **camera=(self) y no camera=()** — cerrar la cámara del todo habría roto el escáner del POS, el gotcha que justifica leer el propio sistema antes de copiar un header de un blog; CSP pragmática self-only en app y sandbox (la SPA no carga nada externo, verificado por grep; unsafe-inline solo styles; blob: para el PDF del ticket y el worker del escáner); `limit_req` zona 1m 30r/m+burst 10 SOLO en /api/auth (el throttler fino de la app gobierna el resto), estado 429. SUPPLY: ghcr-retention.yml semanal (30 versiones/paquete); api ya era non-root, migrate ganó USER node, y web pasó a **nginx-unprivileged en 8080** (vhosts actualizados en el mismo deploy); Trivy CRITICAL informativo con continue-on-error — un gate duro de CVEs frena más de lo que protege a este tamaño. SECRETS: los DOS .env cifrados con age viajan a R2 en el cron nocturno con nombre fijo (la última versión, no historial; sobreviven la retención de 14 días porque se reescriben a diario), verificados en el bucket. **Rotación de JWT (procedimiento documentado):** generar par nuevo en el server (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` + extraer pública), reemplazar ambas claves base64 en el .env del ambiente y recrear el api — las sesiones vivas mueren y todos re-loguean; con 2-3 clientes la ventana de convivencia de dos llaves no paga su complejidad, se rota en horario valle y listo. **Hallazgos post-deploy:** el smoke de Playwright contra prod cazó una violación real — la librería del escáner LEE por fetch el blob de su propio worker y `connect-src 'self'` la bloqueaba; fix en 585c354 (`connect-src 'self' blob:`); el ticket no lo necesitaba (abrir la pestaña blob: es navegación, no fetch). Y el PRIMER escaneo de Trivy ya pagó la tarea: encontró CVE-2026-59873 (gzip bomb en el node-tar del npm embebido de node:22-alpine) — resuelto en 2107f0a borrando npm/npx/corepack del runtime del api, que solo ejecuta `node dist/main`. — `topic_key: sellpoint/f6-secrets` — cierra: F6-EDGE-01, F6-EDGE-02, F6-SUPPLY-01, F6-SUPPLY-02, F6-SECRETS-01
- **2026-08-27 (FASE 7 REDISEÑADA — 4 planes, tres mercados, cobro manual; impuestos quedan manuales a propósito)** — Carlos rediseñó el negocio de la fase tras analizar la competencia mexicana: Basic/Pro/Plus + Premium a precio dinámico, trial 14 días nivel Plus, free tier de 10 ventas/día, cupones con vigencia, ancla de cobro al día de pago y 10 días de gracia; cobro MANUAL desde un backoffice nuevo (no existía plano de administración: los roles son por tenant) y Stripe pospuesto con el enchufe en el modelo. Mercados iniciales **México → Canadá → EE.UU.** con precio POR MERCADO en `plan_prices` (MX $199/$349/$499 MXN · US $15/$29/$45 USD · CA $19/$39/$59 CAD; un país sin precio propio cae a la tarifa USD): convertir por tipo de cambio habría puesto a SellPointy en $11 USD contra Square ($29+) — regalado; Carlos eligió entrar DEBAJO de Clover ($15) a propósito. **Impuestos y facturación: manual por decisión explícita** mientras el volumen sea chico — CFDI (México), sales tax por estado (EE.UU., el economic nexus queda lejos) y GST/HST (Canadá, small supplier hasta $30k CAD) quedan nombrados en los Pospuestos de la fase con sus umbrales, para integrarse (Facturapi / Stripe Tax) cuando el número de clientes lo pague. Los recibos mientras tanto son los registros de `subscription_payments`. — `topic_key: sellpoint/f7-diseno-billing` — commits dc07be8, 76455a1
- **2026-08-27 (F7-DB CERRADO — y el drift que casi se cuela a producción)** — Las 7 tareas del modelo de datos en verde (18 tests de integración + 881 totales). El hallazgo serio no fue de billing: el PRIMER `prisma migrate dev` de la fase generó una migración «noop» de 104 líneas que **dropeaba 12 FKs de ventas/cotizaciones y las recreaba con `ON DELETE SET NULL`** — las migraciones a mano de F3/F4 las crearon `RESTRICT` a propósito, pero el schema nunca lo declaró y Prisma asume `SetNull` en relaciones opcionales. Ese drift existía desde F4 y cualquier `migrate dev` lo habría «normalizado» reescribiendo la semántica de borrado en producción. Se revirtió la DB local a mano (FKs RESTRICT de vuelta, índices renombrados restaurados, 2 índices recreados, defaults originales), se borró la noop, y se alineó el SCHEMA a la verdad de las migraciones: `onDelete: Restrict` explícito en las 12 relaciones, `map:` en los índices de nombre deliberado, defaults reales (`transaction_timestamp()` en services). Validación: `prisma migrate diff --from-config-datasource --to-schema` devuelve «empty migration» — cero drift por primera vez desde F4. **Regla que queda: después de toda migración a mano, correr el diff y exigir vacío; el schema declara `onDelete` SIEMPRE.** Del propio F7-DB: el bypass del backoffice se probó ACOTADO con datos reales (suscripciones de 2 tenants visibles, el almacén del tenant A invisible desde el mismo contexto), y los tests de RLS usan `SET LOCAL ROLE sellpoint_app` porque la conexión local de dev es superuser con BYPASSRLS — sin eso, un test de aislamiento pasa en falso. — `topic_key: sellpoint/f7-db` — cierra: F7-DB-01 a F7-DB-07
- **2026-08-27 (DECISIÓN: vender sin stock es un TOGGLE del admin, no solo del plan)** — Carlos corrigió el diseño antes de implementar F7-POS: bloquear la venta sin stock no puede depender únicamente del plan — un negocio Pro con inventario desactualizado y fila en caja perdería la venta por un conteo pendiente. La regla efectiva pasa a ser `!stockControl || tenants.sell_without_stock`: en Free/Basic la venta sin stock es implícita (sin control de inventario no hay bloqueo posible), y en Pro/Plus/Premium la decide el admin con el switch "Vender sin existencias" (default apagado = comportamiento estricto). El kardex se asienta SIEMPRE: el negativo documenta qué ajustar en el siguiente conteo. F7-POS-03 reescrita y F7-POS-05 nueva (la fase pasa a 47 tareas). — `topic_key: sellpoint/f7-vender-sin-stock`
- **2026-08-27 (F7-CORE CERRADO — el motor de cobro manual completo)** — Las 6 tareas con TDD (36 tests unit nuevos entre entitlements, trial y BillingService; 918 totales; 3 contrapruebas por mutación cazadas). Las decisiones finas que quedaron fijadas por test: (1) `cancel()` NO toca el status — deja `cancel_at_period_end` + `canceled_at` con el servicio vivo hasta el corte (semántica Stripe) y la transición la hace el cron al vencer, coherente con la regla de oro «el cron solo degrada, promover es un pago»; el resolver puede entonces mandar `canceled → free` sin mirar fechas. (2) `free → active` RE-ANCLA al día del pago y arranca ahí (los meses muertos ni se cobran ni se acreditan); `past_due → active` encadena con el período anterior SIN regalar días. (3) La fecha desde la que avanza el ancla es la del VENCIMIENTO anterior — como el instante guardado es límite abierto (arranque del día siguiente), su día legible es el del milisegundo anterior (`dueAt − 1ms`), encapsulado con comentario. (4) El monto registrado es SIEMPRE el calculado (el CHECK `amount = gross − discount` no admite otra cosa); lo transferido de más o de menos queda dicho en notas. (5) `payment-received` se adelantó a la unión `MailTemplate` con sus i18n (CORE-04 lo dispara); los 5 avisos del cron siguen en F7-MAIL-01. (6) `billing.json` es/en nació con las 6 claves que las excepciones de CORE ya usan; F7-GUARD-01 lo completa. — `topic_key: sellpoint/f7-core` — cierra: F7-CORE-01 a F7-CORE-06
- **2026-08-27 (F7-GUARD CERRADO — y el cambio RETROACTIVO de F7-GUARD-04)** — El enforcement completo con TDD (17 tests nuevos, 935 totales, contraprueba del read_only cazada). **Cambio retroactivo a tareas cerradas de F1/F3 (entrada formal):** `POST /users` (users-admin.controller, F1) ganó `@CheckPlanLimit("users")` y `POST /warehouses` (warehouses.controller, F3) ganó `@CheckPlanLimit("warehouses")` — el SubscriptionGuard cuenta lo existente contra el max_* del plan y responde 402 al tope, SOLO al crear (un downgrade jamás suspende ni borra; los invited ocupan asiento, los suspendidos no). Decisiones del guard fijadas por test: (1) es el 4º APP_GUARD — un 403 de rol nunca se disfraza de 402 de plan, y no gasta roundtrips en requests que rebotan antes; (2) **`@RequiresFeature` solo evalúa métodos MUTANTES**: el free tier y Basic LEEN toda su historia (un ex-Pro degradado sigue viendo su kardex — "ver todo" es literal), pero crear lo que el plan no incluye responde 402; eso permitió decorar documents y transfers a nivel de CLASE sin bloquear sus GET; (3) el orden de los checks es estado→feature→límite: el free tier recibe `read_only` (el mensaje que explica su situación) y no un confuso `feature_not_in_plan`; (4) los escapes (@Public, sin user, @AllowedInFreeTier, GET) no resuelven entitlements — cero costo en lo que no aplica. `@AllowedInFreeTier` quedó en: vender, abrir/cerrar caja, cancelar venta y PATCH /me. — `topic_key: sellpoint/f7-guard` — cierra: F7-GUARD-01 a F7-GUARD-04
- **2026-08-28 (F7-POS + F7-WEB-01 CERRADOS — la venta obedece al plan y el front ya sabe qué plan tiene)** — Seis tareas con TDD (los dos integration specs de inventario extendidos, gate y mapper con unit propios; API 949 y web 1016 en verde; contraprueba del off-by-one del límite diario cazada). Las piezas: `allowNegative` atraviesa FEFO → ledger → venta con la regla efectiva `!stockControl || sell_without_stock`, y **el shortfall se suma al ÚLTIMO lote del reparto** — el saldo negativo cae en un lote real y la invariante Σ stock_lots == stock_by_warehouse no se rompe ni vendiendo sin stock. El límite de 10 ventas/día corre DENTRO de la transacción y ANTES de `nextFolio` (un rechazo no gasta numeración), cuenta el día del NEGOCIO y las canceladas devuelven cupo. `SubscriptionBlock` viaja en login y GET /me desde el MISMO mapper (patrón A1) derivado del Entitlements cacheado — `daysLeft` son días de CALENDARIO del negocio con la matemática del límite abierto (el último día hábil vale 0, jamás un negativo). El switch "Vender sin existencias" guarda al instante desde los ajustes del negocio; en Basic/Free se pinta activado y bloqueado con la nota "incluido en tu plan". Costo del contrato nuevo: 41 archivos de test del front ganaron el fixture compartido `SUBSCRIPTION_PLUS` (src/test/subscription-fixture.ts) — el tipo `AuthUser.subscription` es REQUERIDO a propósito: un campo opcional invita a olvidar el gate. — `topic_key: sellpoint/f7-pos` — cierra: F7-POS-01 a 05, F7-WEB-01
- **2026-08-28 (F7-ADMIN CERRADO — el backoffice de Carlos, con sus cuatro llaves)** — Las 6 tareas con TDD (12 tests nuevos entre guard y service; 963 unit + 673 e2e locales en verde ANTES del push — la lección del contrato aplicada). `PlatformAdminGuard` exige CUATRO llaves en AND (flag en la base + email en `BILLING_ADMIN_EMAILS` + active + verificado): ni un UPDATE malicioso ni un email reasignado bastan solos, y el flag NO viaja en el JWT — se consulta por PK solo en `/admin/*`, revocarlo es inmediato. La whitelist vacía cierra el backoffice también en dev (fail-closed), y en producción el env la EXIGE (superRefine + test). Endpoints: la lista cross-tenant con **MRR desde pagos VIGENTES y POR MONEDA** (un trial no aporta, un anual aporta su doceava parte — sumar MXN con USD daría un número que no existe), registrar/anular pagos, PATCH de suscripción (con `warnings.negativeStock` al mover a un plan con control — la lista exacta de qué inventariar), cancel/reactivate, cupones, y GET/PATCH de planes con las features pasando por el schema estricto y el anual derivado siempre (×10, el CHECK manda). Dos guardias de la casa volvieron a cazar huecos: `message-keys.spec` exigió las claves i18n de los DTOs y `env.schema.spec` obligó a declarar la variable nueva en el fixture de producción. **Falta operativo**: al desplegar, `BILLING_ADMIN_EMAILS` debe entrar al .env de prod (y el flag `is_platform_admin` al usuario de Carlos) — sin eso el deploy REVENTARÁ el arranque del api por el superRefine. — `topic_key: sellpoint/f7-admin` — cierra: F7-ADMIN-01 a F7-ADMIN-06
- **2026-08-28 (F7-CRON + F7-MAIL CERRADOS — el sistema ya degrada y avisa solo)** — Las 5 tareas con TDD (8 tests del job + 971 unit + 673 e2e locales). El barrido en dos piezas: `BillingDailyJob` es lógica PURA testeable sin cron (5 pasos públicos que reciben `now`) y `BillingCronRegistrar` es el único que conoce el reloj de pared — registro DINÁMICO vía SchedulerRegistry porque hora y zona vienen del env. **`BILLING_CRON_ENABLED` nace en FALSE** (a diferencia del throttle): degradar es opt-in explícito del ambiente — los tests jamás registran el cron; prod y sandbox lo prendieron por .env ANTES del push. Reglas fijadas por test: el cron SOLO degrada (updateMany WHERE status = idempotencia — la segunda pasada mueve 0 filas y ni audita ni avisa); un active vencido CON cancel_at_period_end va directo a `canceled` sin gracia (su período se respetó completo); los avisos rebotan en el UNIQUE de billing_notifications (INSERT antes del mail, P2002 = ya enviado); el audit de transiciones va SIN userId. Los 5 templates sin CTAs a propósito y todos con la promesa explícita de que nada se borra — el miedo a perder los datos es la razón #1 de pánico en un aviso de pago. `POST /admin/billing/jobs/run-daily` corre el barrido a demanda. — `topic_key: sellpoint/f7-cron` — cierra: F7-CRON-01 a 04, F7-MAIL-01
- **2026-08-28 (F7-WEB COMPLETO — la fase ya tiene cara)** — Las 9 tareas de WEB cerradas (02-04 en la tanda anterior; 05-10 en esta, con API 973 + e2e 673 + web 1038 en verde). Decisiones que quedaron: el **PlanGate vive en AppLayout** y no ruta por ruta (mejora sobre el plan: una ruta nueva jamás puede olvidar el gate); el free tier NUNCA se redirige — ve la app con el modal encima, y que reaparezca cada sesión lo garantiza el store en memoria, no un condicional; los **candados del sidebar** son botones que abren el modal (upsell: se ve lo que te pierdes) con el permiso siempre mandando por encima del plan; el interceptor 402 abre el modal con import perezoso del store (el bundle del login no carga billing); `isPlatformAdmin` se expone en login y /me SOLO para pintar el link del backoffice — la verdad siguen siendo las cuatro llaves del guard en cada request, y en el front es OPCIONAL a propósito (su ausencia es un link oculto, jamás un privilegio). Gotcha cazado por la suite: el banner usaba `role=status` y usurpaba las live regions de las pantallas — un banner persistente no es un anuncio en vivo. — `topic_key: sellpoint/f7-web` — cierra: F7-WEB-05 a F7-WEB-10
- **2026-08-29 (EL LIMBO ENTRE EL VENCIMIENTO Y EL BARRIDO — un no-bug que sí escondía un hueco)** — Carlos movió a mano el `due_at` de un tenant al pasado en producción y entró: la app no le decía nada. **Verificado antes de tocar código: no era un bug.** El cron estaba registrado y habilitado (`Cron de billing registrado: 3:00 America/Mexico_City`), y él cambió el dato a las 10:01 de la mañana — el siguiente barrido era al día siguiente. El `status` es un DATO que el cron persiste, no un cálculo por request, y eso es deliberado: una sola fuente de verdad para el corte, la gracia y los correos. **Pero la prueba destapó un hueco real de producto**: el banner solo reaccionaba a `trialing`, `past_due` y `free`, así que un `active` con la fecha ya pasada **no pintaba nada** — el cliente no se enteraba de que su pago venció hasta que el cron pasara (normalmente unas horas, de medianoche a las 3 AM). Decisión de Carlos: **avisar al instante sin tocar la máquina de estados**. El `SubscriptionBlock` gana `overdue: boolean`, calculado en el SERVER con la zona del negocio (el instante del vencimiento es límite abierto: alcanzarlo ya es haber vencido) y solo para `active` — `past_due` ya tiene su propio aviso. El banner lo anuncia primero que nada, en rojo, con la fecha. **Lección: cuando alguien reporta que "no pasa nada", verificar el reloj antes que el código — y aun cuando el sistema tenga razón, preguntarse si el usuario tenía forma de saberlo.** — `topic_key: sellpoint/aviso-vencimiento-inmediato`
- **2026-08-29 (LOS CUATRO HALLAZGOS DE CARLOS EN PRODUCCIÓN — y el peor era invisible)** — Carlos revisó el sistema desplegado y reportó cuatro cosas. Las cuatro eran reales y las cuatro están arregladas con TDD (974 unit + 745 e2e + 1042 web; 4 contrapruebas por mutación cazadas). **(1) El backoffice mostraba solo los negocios nuevos**: la lista partía de `tenant_subscriptions`, así que quien no tenía fila no existía — **8 de 10 negocios de producción invisibles**, y son justo a los que hay que cobrarles. Ahora parte de `tenants` y los muestra con `status: "none"` sobre el plan free; registrarles un pago **crea** la suscripción (exige `planCode`: no hay plan previo del que heredar), así que el backfill pendiente de la fase se resuelve desde la UI. **(2) Un pago de $100 activaba un plan de $499**: el monto recibido solo iba a notas. Decisión de Carlos: rechazar con 422 `billing.amount_below_charge` diciendo cuánto falta, y permitir forzarlo con `allowPartial` (casilla explícita en el modal) — pagar de MÁS nunca se rechaza. **(3) No había historial por cliente**: el endpoint existía desde F7-ADMIN-02 pero nadie lo pintaba. El nombre del negocio abre su expediente con la tabla de pagos, el período que cubrió cada uno, sus notas y anular con razón; y `getTenantDetail` dejó de dar 404 para los negocios sin suscripción (su propio dueño también abría "Mi plan" contra una pared). **(4) El modal de planes cobraba en dólares a negocios mexicanos** — el más grave, y el más escondido: `JwtAuthGuard` hacía `if (isPublic) return true` ANTES de leer el token, así que `@CurrentUser()` era SIEMPRE `undefined` en `/billing/plans` aunque el front mandara el Bearer, y el país nunca se resolvía. Peor: el MISMO fallback vivía en `resolvePrice`, o sea que un negocio con `country` NULL y moneda MXN habría sido **COBRADO en USD**. Ahora la autenticación es OPCIONAL en rutas públicas (best-effort, nada lanza) y una sola función de shared, `resolveMarket` (país → moneda → US), resuelve el mercado para la vitrina Y para el cobro. **Lecciones: (a) una lista de cobranza jamás debe partir de la tabla que al deudor le falta;** **(b) un endpoint público que igual mira la sesión hay que probarlo CON sesión** — los e2e de F7 probaban `listPublicPlans(country)` a nivel de servicio, que siempre funcionó, y nunca el endpoint autenticado; **(c) `@Public()` significaba "no exijo token", no "ignoro el que venga", y ese matiz costó un precio equivocado en pantalla.** — `topic_key: sellpoint/hallazgos-produccion-f7`
- **2026-08-28 (F7-DOC CERRADO — LA FASE 7 COMPLETA, 47/47)** — `apps/api/src/modules/billing/README.md`: la máquina de estados con sus reglas fijadas por test, el modelo de datos con el bypass acotado, el enforcement, y el **runbook del dueño** — registrar/anular un pago, cupones, correr el barrido a mano, alta de Premium con `custom_price`, cancelar/reactivar y editar el catálogo, cada operación con su `curl` funcional (la semanal además por UI en `/admin/billing`). Cierra con la sección del **enchufe de Stripe**: las columnas `gateway/*` que ya existen (product/price IDs, customer/subscription IDs, `external_id` con UNIQUE parcial para la idempotencia del webhook) y las 5 piezas que faltan (adapter, webhook → el MISMO `recordPayment`, front de tarjeta, convivencia gracia-vs-reintentos, impuestos). Pendiente de la tarea: la revisión de Carlos. **Pendiente operativo de la fase (decisión de Carlos):** los tenants ANTERIORES a F7 están en modo gratuito por el fail-closed — backfill o pago de cortesía desde el backoffice. Y el copy "Contáctanos" de Premium aún no tiene canal (correo/WhatsApp). — `topic_key: sellpoint/f7-doc` — cierra: F7-DOC-01
- **2026-08-28 (F7-E2E CERRADO — y un bug REAL que solo un e2e podía encontrar)** — Los 6 archivos (49 casos) que recorren la fase de punta a punta: ancla del 31 y precio por mercado (MX/US/CA), trial vencido con sus 10 ventas y su solo-lectura, gracia de 10 días y pago tardío, Basic vendiendo en cero, cupón de 12 períodos y aislamiento del backoffice. **El hallazgo:** F7-E2E-04 destapó que un conteo físico NO corregía un saldo negativo — teórico −3 contado en 12 dejaba **9**. La causa es un cruce de fases: `expandCount` emitía la "salida del teórico entero" solo `if (teorico > 0)`, lo cual era correcto mientras el CHECK `quantity >= 0` hacía imposible un teórico negativo… hasta que **F7-DB-07 quitó ese CHECK** para que Basic pudiera vender sin existencias. La rama nunca se escribió porque el caso no existía cuando se escribió el código. Arreglado: con teórico negativo el movimiento que lo pone en cero es una ENTRADA por su valor absoluto (el conteo es ABSOLUTO — lo contado es el saldo nuevo, jamás un delta), y el guardián quedó en `inventory-counts.e2e-spec.ts`, que es donde un cambio futuro lo buscaría. **Lección: quitar una restricción de la base no es una tarea de la base — abre ramas muertas en TODO el código que la daba por cierta.** Como los 6 specs pasaron casi todos a la primera, se hicieron **7 contrapruebas por mutación** (ancla recalculada, guard desactivado, off-by-one del límite diario, interruptor `sellWithoutStock` borrado, gracia de cero días, GUC del bypass apagado, cupón con un período de más): las siete cazadas. — `topic_key: sellpoint/f7-e2e` — cierra: F7-E2E-01 a F7-E2E-06
- **2026-08-21 (EL DEPLOY DE F4-QUOTE FALLÓ — `typecheck` no mira los tests, `typecheck:full` sí)** — Corrí las cuatro suites en verde y pusheé; CI reventó igual. **La causa:** verifiqué tipos con `pnpm exec tsc --noEmit -p tsconfig.app.json`, que compila SOLO la app y **excluye los archivos de test**. El pipeline corre `typecheck:full` (`tsc -b`, todos los proyectos referenciados) y ahí saltó un `error TS2551` en un test nuevo. Es la MISMA clase de error que el del 2026-08-20 con `pnpm test` sin e2e: usar un comando más angosto que el del pipeline y leer su verde como si fuera el del pipeline. **Regla: para tipos, `pnpm typecheck` desde el paquete — nunca un `tsc -p` a mano contra un tsconfig elegido por mí.** **Lo que destapó:** el mock inventaba `listScopedWarehouses`, una función que NO existe (el alcance se pide con `listWarehouses({ scoped: true })`). Estaba copiada en TRES archivos de test desde `pos-session.test.tsx` y nadie la notó porque **ningún test la usaba** — un mock de una función inexistente es una mentira que solo se descubre cuando alguien intenta apoyarse en ella, que fue exactamente lo que pasó. Limpiada en los tres. — `topic_key: sellpoint/typecheck-full-vs-typecheck`
- **2026-08-21 (DISCO DEL VPS AL 74% — la limpieza funcionaba; el problema era la ventana)** — Carlos vio 33 de 47 GB usados y preguntó si sobraban imágenes de Docker. **Sobraban 176, pero no por lo que parecía.** El `docker image prune -af --filter until=…` que se agregó tras el incidente del 2026-08-18 **corre y funciona**: ninguna imagen pasaba de 3 días y no había un solo contenedor detenido reteniendo nada. Lo que fallaba era el número: `IMAGE_RETENTION="168h"` —una semana— y en TRES días se acumularon 176 imágenes (59 api × 833 MB, 59 web, 58 migrate × 1.01 GB) = 24.94 GB, de los cuales `docker system df` daba **16.58 GB reclamables (66%)**. Al ritmo real de deploys, siete días no son un colchón: son un acumulador. **El argumento de fondo no es el disco:** aquella semana se eligió "para tener rollback disponible", y **a una imagen de hace una semana no se puede volver** — la base tiene siete días de migraciones aplicadas que ese código no conoce, y bajar la imagen no las deshace. La retención protegía un rollback que sería peligroso ejecutar. El rollback real es el de los primeros minutos, así que **24h** conserva todos los deploys del día, que son los únicos a los que volver es seguro. **Y el cambio destapó un defecto de siempre:** `docker image prune -af` borra CUALQUIER imagen sin contenedor vivo, así que se llevó `certbot/certbot` — un one-shot (`compose run --rm`) que por definición nunca tiene un contenedor corriendo. La semana de retención solo lo tapaba. No hubo caída (el `compose run` la vuelve a bajar sola, y el certificado vence el 5 de noviembre), pero quedaba algo que nadie eligió: **la renovación de los certificados pasando a depender de que Docker Hub responda a las 4:30 de la mañana**. Se cambió la limpieza para que toque SOLO los tres repositorios de `ghcr.io/carloshlm/` — comparando el nombre completo del registro y no un prefijo: `sellpoint-php-fpm:local` es un servicio del MISMO compose (lo afirmé como «de otro proyecto» sin verificarlo y era falso), pero se construye local y no lleva SHA — hay una sola copia, no se acumula, y borrarla obligaría a reconstruirla. Lo que se limpia es lo versionado por deploy, que es lo único que crece. Las dangling siguen barriéndose con `prune -f` SIN `-a`, que es lo que lo mantiene inofensivo. Probado en seco contra el servidor real antes de pushear. **Lección: la limpieza de un deploy no tiene por qué opinar sobre imágenes que el deploy no creó.** **Detalle que corrige una suposición:** el script NO tiene horario — no hay `schedule` ni cron, corre `on: push` a `main`, así que la limpieza vive DENTRO del deploy y el espacio se libera en el próximo push, no de un día para el otro. — `topic_key: sellpoint/retencion-imagenes-docker`

---

*Documento de implementación de SellPoint. Trabajamos punto por punto. Cuando termines una tarea, marca el checkbox y agrega una línea a la Bitácora si hubo algo digno de recordar. Al terminar la Fase 1, atomizamos la Fase 2.*
