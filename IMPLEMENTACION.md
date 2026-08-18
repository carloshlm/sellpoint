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
- **SDD LIGERO**: F0-DEPLOY, F0-I18N-02/03/04, F2-DB, F2-UOM, F2-SUBCAT, F2-WH, F2-ONBOARD, F3-DB, F3-GUARDS, F3-NAV, F5-EXPORT.
- **SDD COMPLETO**: F1-AUTH, F1-RBAC, F1-LOCALE, F1-TENANT, F1-SCOPE, F2-CAT, F2-SCHEMA, F2-PRESENT, F2-BOM, F2-PROD, F2-IMPORT, F2-SCOPE, F3-CORE, F3-ENTRY, F3-EXIT, F3-TRANSFER, F3-COUNT, F3-KARDEX, F3-LOTS, F3-DOC, F4-CART, F4-COMPOSITE, F4-CHECKOUT, F4-NUMPAD, F4-PRINT-BT, F4-PWA, F5-API, F6-*, F7-*, F9-*.

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
| **F3** | Movimientos de Inventario | 🔄 En curso | 5-6 semanas | ✅ Sí |
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

- [ ] **F1-LOCALE-07** — Selector de moneda en wizard de onboarding (Paso 1)
  - **Salida:** componente `<CurrencySelector>` en el paso 1 de `/onboarding`. Default MXN. Submit guarda `tenant.currency`. Mensaje de advertencia "no se puede cambiar después si registrás movimientos".
  - **Verificar:** tenant nuevo termina onboarding con su currency persistida.
  - **Depende de:** F1-WEB-ONBOARD-01, F1-LOCALE-01
  - **Estimación:** 1.5 h

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

**Frontend:** `routes/` + `components/inventory` + `lib/inventory` (la convención `features/` se abandonó en F2). Rutas nuevas: `/movements/entries/new`, `/movements/exits/new`, `/movements/entries`, `/movements/exits`, `/movements/counts` (los tres son **listados con buscador por folio, filtro de estatus y botón de crear**, tres montajes del mismo componente), `/movements/documents/$id` (captura del borrador y detalle del confirmado) y `/movements/transfers`; tabs **Kardex** y **Stock por almacén** dentro del detalle de producto (`/catalog/products`).

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

- [ ] **F3-DB-03** — Tabla `tenant_sequences` + `nextFolio()`
  - **Salida:** modelo `TenantSequence` → `tenant_sequences` (tenant_id, key VARCHAR(32), next_value BIGINT default 0; PK `(tenant_id, key)`); helper `nextFolio(tx, tenantId, key, prefix)` en `apps/api/src/modules/inventory/folio.ts` que ejecuta `INSERT … VALUES (tenant, key, 1) ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = tenant_sequences.next_value + 1 RETURNING next_value` y formatea `${prefix}-${n.padStart(6,'0')}` (crece más allá de 6 dígitos sin romper; huecos por rollback aceptados y documentados); las **3 series** vienen de `FOLIO_PREFIXES` en `packages/shared` (F3-DOC-03): `ENT`, `SAL`, `INV`, con `VTA` reservada para F4. **Docblock obligatorio con el gotcha del lock**: el `ON CONFLICT DO UPDATE` toma la fila `(tenant, key)` y no la suelta hasta el COMMIT — por eso `createDraft` lo llama en una **transacción corta propia** y NO dentro de la del ledger: así el lock dura milisegundos en vez de todo el posteo. El mismo patrón le sirve a F4 para tomar el folio al abrir el carrito
  - **Verificar:** integración: 20 llamadas concurrentes en transacciones separadas producen 20 folios distintos y consecutivos; dos tenants arrancan ambos en `ENT-000001`; series distintas del mismo tenant no se pisan (`ENT-000001` y `SAL-000001` conviven); una tx que hace rollback **no** deja hueco en la serie; el lock se libera antes de que arranque cualquier posteo
  - **Depende de:** —
  - **Estimación:** 1 h

- [ ] **F3-DB-04** — RLS + append-only en las 4 tablas nuevas
  - **Salida:** migración SQL: ENABLE + **FORCE** ROW LEVEL SECURITY + policy `tenant_isolation` (NULLIF) en `stock_movements`, `inventory_documents`, `inventory_document_lines`, `transfers`, `transfer_lines`, `tenant_sequences`, `product_lots`, `stock_lots`; `REVOKE UPDATE, DELETE ON stock_movements FROM sellpoint_app` — **solo sobre movimientos**: el documento y sus líneas se editan mientras son borrador, así que su inmutabilidad la sostiene el trigger de F3-DOC-02, no el privilegio (guardado con `IF EXISTS pg_roles`, patrón `units`; llega DESPUÉS del `ALTER DEFAULT PRIVILEGES` de F1, por eso hay que revocar explícito); `f3-rls.integration.spec.ts` con `RLS_TABLES = ['stock_movements','inventory_documents','inventory_document_lines','transfers','transfer_lines','tenant_sequences','product_lots','stock_lots']` y los 4 canarios por tabla (propio ve / ajeno 0 / sin `set_config` 0 / WITH CHECK rechaza) + guardián estructural de FORCE
  - **Verificar:** la suite de integración pasa; UPDATE y DELETE sobre `stock_movements` como `sellpoint_app` fallan con 42501; sobre un `inventory_documents` en `draft` funcionan y sobre uno `confirmed` fallan (trigger, F3-DOC-02); INSERT funciona; `tenant_sequences` sí admite UPDATE
  - **Depende de:** F3-DB-01, F3-DB-02, F3-DB-03, F3-DB-06, F3-DB-07, F3-DOC-02
  - **Estimación:** 2.5 h

- [ ] **F3-DB-05** — Migración data-only de permisos de F3
  - **Salida:** INSERT `ON CONFLICT DO NOTHING` de `inventory:read`, `inventory:movement`, `inventory:manage` (módulo `inventory`) + asignación a roles base existentes (SQL espejo de `resolveRolePermissionCodes`: TenantAdmin los 3, Manager read+movement, Viewer read, POS_Seller ninguno); `inventory:manage` entra a `MANAGER_EXCLUDED_CODES` en `role-catalog.ts` con su test; docblock con el gotcha perm-epoch
  - **Verificar:** `role-catalog.spec.ts` fija las 4 filas; e2e `permissions`: `GET /permissions` muestra los 3; Manager sin `inventory:manage`; Viewer con `inventory:read`
  - **Depende de:** —
  - **Estimación:** 1 h

- [ ] **F3-DB-06** — Lotes: `products.tracks_lots` + modelos `ProductLot` y `StockLot`
  - **Salida:** columna `products.tracks_lots BOOLEAN NOT NULL DEFAULT false` (opt-in por producto; **no** se puede apagar si el producto tiene filas en `stock_lots` con saldo > 0 — guarda en F3-LOTS-01); `ProductLot` → `product_lots`: id, tenant_id, product_id FK RESTRICT, lot_code VARCHAR(64), expires_at DATE NULL, created_at; `@@unique([productId, lotCode])`; índice `(tenant_id, product_id, expires_at)` (FEFO ordena por acá). `StockLot` → `stock_lots`: lot_id FK RESTRICT, warehouse_id FK RESTRICT, tenant_id, location VARCHAR(64) NOT NULL DEFAULT '' (`''` = sin ubicación; NOT NULL para que entre en la PK), quantity DECIMAL(14,4) default 0 CHECK >= 0, updated_at; `@@id([lotId, warehouseId, location])`; índices `(tenant_id)`, `(warehouse_id)`. Docblocks: caducidad es del LOTE (mismo lote en dos almacenes comparte fecha); ubicación PARTE el stock; `stock_by_warehouse` sigue siendo el total y `Σ stock_lots == stock_by_warehouse` es invariante del ledger, no de la DB
  - **Verificar:** integración: `lot_code` repetido en el mismo producto rechazado y permitido en otro producto; `(lot, warehouse, location)` duplicado rechazado; CHECK rechaza negativo; FK RESTRICT impide borrar un lote con saldo
  - **Depende de:** —
  - **Estimación:** 1.5 h

- [ ] **F3-DB-07** — `stock_movements` gana `lot_id` y `location`
  - **Salida:** columnas `lot_id UUID NULL FK product_lots RESTRICT` y `location VARCHAR(64) NULL` en `stock_movements` (qué lote y ubicación movió cada línea; NULL para productos sin lote); índice `(lot_id) WHERE lot_id IS NOT NULL`; CHECK `(lot_id IS NULL) OR (location IS NOT NULL)` (si hay lote, la ubicación viene siempre, aunque sea `''`); `transfer_lines` gana `lot_id UUID NULL FK` (un traspaso de producto con lote mueve un lote concreto) y su `@@unique` pasa a `[transferId, productId, lotId]`
  - **Verificar:** integración: movimiento con `lot_id` y `location NULL` rechazado; FK RESTRICT impide borrar un lote referenciado por un movimiento
  - **Depende de:** F3-DB-01, F3-DB-02, F3-DB-06
  - **Estimación:** 1 h

---

### Módulo F3-DOC — Documentos, Borradores, Folios y PDF

> **Todo movimiento es un documento con estado.** Nace en **borrador** con su folio al pulsar «Crear» desde el listado de su serie, se carga sola (a mano o por Excel), se puede retomar por folio después de que se cierre el sistema, y al **confirmar** escribe los movimientos y mueve el stock. Abandonarla la deja **anulada con su folio**: la serie nunca pierde un número. Tres series y nada más: `ENT`, `SAL`, `INV` — el traspaso es una `SAL` con motivo, su recepción una `ENT` con motivo.

- [x] **F3-DOC-01** — Tablas `inventory_documents` e `inventory_document_lines`
  - **Salida:** enums Prisma `InventoryDocumentType { entry, exit, physical_count }` y `DocumentStatus { draft, confirmed, canceled }`; `InventoryDocument` → `inventory_documents`: id, tenant_id, `folio VARCHAR(20)`, type, **status default `draft`**, warehouse_id FK **RESTRICT**, linked_warehouse_id UUID NULL FK RESTRICT, reason_code `MovementReason` NULL (se elige dentro del borrador), reference VARCHAR(120) NULL, reason_note TEXT NULL, authorized_by UUID NULL FK users RESTRICT, **transfer_id UUID NULL FK `transfers` RESTRICT** (el ÚNICO puntero entre documento y traspaso — ver nota de abajo), confirmed_at/confirmed_by NULL, canceled_at/canceled_by/cancel_reason NULL, created_by FK users RESTRICT, created_at, **`updated_at`** (un borrador cambia); `@@unique([tenantId, folio])`; CHECK `(status='confirmed') = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)`; CHECK `(status='canceled') = (canceled_at IS NOT NULL)`; CHECK `status <> 'confirmed' OR reason_code IS NOT NULL`; índices `(tenant_id, type, status, created_at DESC)`, `(tenant_id, folio)`, `(tenant_id, warehouse_id, created_at DESC)`, `(tenant_id, created_by, status)`, y **UNIQUE parcial `(transfer_id, type) WHERE transfer_id IS NOT NULL`** (un traspaso tiene a lo sumo un despacho y una recepción). `InventoryDocumentLine` → `inventory_document_lines`: id, tenant_id, document_id FK **CASCADE** (borrar un borrador se lleva sus líneas), line_no INT, product_id FK RESTRICT, presentation_id UUID NULL FK RESTRICT, quantity DECIMAL(14,4) NULL (un borrador admite una línea a medio llenar), unit_cost DECIMAL(14,2) NULL, lot_code VARCHAR(64) NULL, expires_at DATE NULL, location VARCHAR(64) NULL, counted/theoretical DECIMAL(14,4) NULL (solo `physical_count`), created_at, updated_at; `@@unique([documentId, lineNo])`; índice `(product_id)`. Migración: `stock_movements` **pierde `batch_id` Y `transfer_id`** (los dos son datos de cabecera: ya viven en el documento — misma regla que motivó toda la tabla) y **gana `document_id` UUID NOT NULL FK RESTRICT**; se cae el índice parcial de `transfer_id` y `(tenant_id, batch_id)` pasa a `(document_id)`. Limpia porque `stock_movements` está **vacía** en producción (verificar con `SELECT count(*)` antes de escribirla)
  - **Verificar:** `inventory-schema.integration.spec.ts` crece: folio repetido en el mismo tenant rechazado y permitido en otro; un documento `confirmed` sin `confirmed_by` rechazado; dos documentos de despacho para el mismo traspaso rechazados por el UNIQUE parcial; borrar un borrador borra sus líneas (CASCADE) y borrar un producto con líneas falla (RESTRICT); `stock_movements` ya no tiene `batch_id` ni `transfer_id` y no admite INSERT sin `document_id`; `prisma migrate diff` sin drift (ritual de F3-DB nacido en F3-DB-01)
  - **Depende de:** F3-DB-01, F3-DB-02
  - **Estimación:** 2.5 h
  - **Hecho** (2026-08-18, migración `20260818034546_f3_inventory_documents`, 16 tests nuevos → 61 en el archivo). La verificación de "tabla vacía" se hizo **probando que no existe un solo escritor** (`rg stockMovement.create` sobre `apps/api/src` sin `.spec.ts` → nada; el módulo `inventory` no existe), que es más fuerte que contar filas en un momento dado. El `ADD COLUMN document_id NOT NULL` **falla si hay filas** y eso queda documentado como deliberado: mejor que la migración se caiga a inventar un documento contenedor. Dos cosas que cazaron los tests: el `VARCHAR(20)` del folio rechazó unos fixtures de 25 caracteres (el formato real, `ENT-000042`, son 10), y **`otherTenantId` era una variable libre que ts-jest transpiló sin chistar** — el recordatorio de por qué existe `typecheck:full`

- [ ] **F3-DOC-02** — Inmutabilidad de lo confirmado: trigger + RLS
  - **Salida:** migración con el **primer trigger del proyecto**: función `inventory_document_is_immutable()` que hace `RAISE EXCEPTION` con `ERRCODE = '42501'` si `OLD.status <> 'draft'`, y trigger `BEFORE UPDATE OR DELETE ON inventory_documents FOR EACH ROW`; el gemelo sobre `inventory_document_lines` mira el `status` de su documento. Docblock que explica **por qué acá no alcanza el `REVOKE`** que usan `stock_movements`, `units` y `currencies`: un borrador se edita, así que el privilegio no puede ser la barrera y el estado tiene que serlo
  - **Verificar:** integración: UPDATE sobre un documento `draft` funciona; el mismo UPDATE sobre uno `confirmed` falla con 42501; DELETE de una línea de un confirmado falla; DELETE de una línea de un borrador funciona; pasar de `confirmed` a `draft` es imposible (lo bloquea el mismo trigger)
  - **Depende de:** F3-DOC-01
  - **Estimación:** 2 h

- [ ] **F3-DOC-03** — `FOLIO_PREFIXES` + ciclo de vida del documento
  - **Salida:** en `packages/shared` `FOLIO_PREFIXES: Record<InventoryDocumentType, string>` = `{ entry: 'ENT', exit: 'SAL', physical_count: 'INV' }` + `RESERVED_FOLIO_PREFIXES = ['VTA']` (F4), con **test de contrato** que falla si el enum gana un tipo sin prefijo o si dos comparten prefijo (patrón `UNITS` vs tabla `units`); `documents.service.ts`: `createDraft(user, { type, warehouseId })` → **transacción corta** que toma `nextFolio` y crea el documento vacío (el lock de la serie se suelta enseguida, no espera al posteo); `cancel(user, id, reason?)` (solo `draft`); `assertDraft(id)`. El `confirm` vive en cada módulo (F3-ENTRY-01, F3-EXIT-01, F3-COUNT-03) porque cada tipo valida distinto, pero todos usan `markConfirmed(tx, id)` que hace `UPDATE … WHERE id = ? AND status = 'draft'` y exige `rowCount = 1` (lock lógico; 409 `inventory.document_not_draft` si 0)
  - **Verificar:** unit del contrato de prefijos (3 tipos, sin repetidos, `VTA` sin asignar); integración: dos `createDraft` del mismo tipo dan folios consecutivos; tipos distintos avanzan series independientes; dos `markConfirmed` concurrentes sobre el mismo borrador → uno pasa y el otro da 409; cancelar un confirmado → 409
  - **Depende de:** F3-DOC-02, F3-DB-03
  - **Estimación:** 2.5 h

- [ ] **F3-DOC-04** — CRUD de líneas del borrador
  - **Salida:** `DocumentLinesController` (`inventory:movement`, scope del almacén del documento, **solo si `status='draft'`** → 409 si no): `POST /inventory/documents/:id/lines` (agrega, devuelve la línea con `lineNo`), `PATCH …/lines/:lineId`, `DELETE …/lines/:lineId`, `PUT …/lines` (reemplazo masivo, para el pegado desde la tabla). Un producto que ya está en el borrador **con la misma presentación y lote** suma en vez de duplicar. Guarda **sin validar de fondo**: un borrador admite una línea a medio llenar (cantidad nula, lote vacío) — la validación dura es del `confirm`, y las advertencias las muestra la previa
  - **Verificar:** `document-lines.e2e-spec.ts`: agregar 3 líneas y releer el borrador las devuelve en orden; agregar el mismo producto+presentación suma; sobre un documento `confirmed` → 409; fuera de scope → 403; cross-tenant 404; una línea sin cantidad se guarda (es un borrador) pero el `confirm` la rechaza
  - **Depende de:** F3-DOC-03
  - **Estimación:** 3 h

- [ ] **F3-DOC-05** — Importar líneas desde Excel/CSV al borrador
  - **Salida:** **muda `spreadsheet.ts`** de `modules/products/` a `common/spreadsheet/` (la usan conteo, entradas y salidas; deja de ser detalle de un módulo) y actualiza los imports de productos; `GET /inventory/documents/template?type=entry|exit|physical_count&format=xlsx|csv` — columnas por tipo (`entry`: `sku, presentacion, cantidad, costo_unitario, lote, caducidad, ubicacion` · `exit`: igual sin costo · `physical_count`: `sku, lote, caducidad, ubicacion, contado`) con una fila de ejemplo; `POST /inventory/documents/:id/lines/import` (`{ file, format, mode: 'replace' | 'append' }`): > 5 MB → 413, ilegible → 400; resuelve `sku` → `productId` y el nombre de presentación → `presentationId`; **las filas con error igual entran como líneas** con su problema anotado, para que el usuario las corrija en pantalla en vez de volver a subir el archivo entero
  - **Verificar:** `document-import.e2e-spec.ts`: subir el Excel del cliente carga N líneas al borrador; `mode: 'replace'` reemplaza y `append` suma; una fila con sku inexistente entra marcada y no aborta las demás; csv y xlsx dan el mismo resultado (round-trip por `parseSpreadsheet`); sobre un confirmado → 409
  - **Depende de:** F3-DOC-04, F3-COUNT-01
  - **Estimación:** 3 h

- [ ] **F3-DOC-06** — Listado y detalle: `GET /inventory/documents` y `GET /inventory/documents/:id`
  - **Salida:** `DocumentsController` (`inventory:read`, scope): listado con filtros `type` (obligatorio en las tres pantallas), **`status`** (default: `draft` + `confirmed`; los anulados entran con un chip), `warehouseId`, `from`, `to`, `createdBy` y **`folio`** (búsqueda parcial case-insensitive: se busca por el número que trae el papel en la mano); `page/pageSize`; orden `created_at DESC, folio DESC`; fila `{ id, folio, type, status, warehouse, reasonCode, reference, lineCount, createdAt, createdBy, confirmedAt }`. **El detalle ES la vista previa**: devuelve la cabecera + `rows: [{ lineNo, productId, sku, name, baseUnit, presentation, quantityInput, quantityBase, unitCost, lotCode, expiresAt, location, newLot, available, stockBefore, stockAfter, fefoPlan?, expand?, errors: [{ field, message, code }] }]` + `summary { lines, products, newLots, errors }`, resolviendo contra el saldo del momento **sin escribir nada**; si el documento está `confirmed`, las filas se leen de los `stock_movements` ya asentados (lo que realmente pasó) en vez de recalcularse
  - **Verificar:** `inventory-documents.e2e-spec.ts`: `folio=000019` encuentra el borrador; el default no trae anulados y con el chip sí; el detalle de un borrador de 3 cajas ×12 sobre saldo 10 devuelve `stockBefore: 10` y `stockAfter: 46` **y el saldo real sigue en 10**; una línea sin cantidad aparece con su error y `summary.errors = 1`; el detalle de un confirmado muestra los movimientos reales (incluida la partición FEFO en dos lotes); Manager con scope [A] no ve nada de B (404)
  - **Depende de:** F3-DOC-04, F3-CORE-03, F3-CORE-04, F3-CORE-08
  - **Estimación:** 3.5 h

- [ ] **F3-DOC-07** — Render PDF + `GET /inventory/documents/:id/pdf`
  - **Salida:** dependencia `pdfmake` (server-side; elegido sobre `pdfkit` porque **pagina la tabla solo y repite el encabezado**, y un conteo son 500 líneas); `document-pdf.renderer.ts` con encabezado y pie **comunes** y **cuerpo por tipo**: cabecera con `tenant.legalName ?? tenant.name` + `tenant.taxId`, el tipo en grande y el **folio**; **marca de agua «BORRADOR» o «ANULADO»** según estado (un papel sin marca es un papel que alguien va a firmar); bloque de datos (almacén — y destino si el motivo es traspaso —, fecha, quién registró, motivo, referencia, nota, autorizó); tabla `entry`/`exit`: `# · SKU · Producto · Presentación · Cantidad (con equivalencia en base_unit) · Lote/Caducidad/Ubicación si aplica · Costo unitario solo con `invoice``; tabla `physical_count`: `# · SKU · Producto · Teórico · Contado · Diferencia`; pie con **total de LÍNEAS** (nunca un total de unidades: sumar 36 unidades + 2.5 kg no significa nada) y tres líneas de firma **Entregó / Recibió / Autorizó**; labels por `nestjs-i18n` con el locale del usuario; endpoint (`inventory:read`, mismo scope que el detalle) → `application/pdf` + `Content-Disposition: attachment; filename="SAL-000019.pdf"`
  - **Verificar:** `documents-pdf.e2e-spec.ts`: 200 con `content-type: application/pdf`, el buffer arranca con `%PDF-` y el `filename` es el folio; el PDF de un borrador contiene la marca de agua y el de un confirmado no; un documento de 300 líneas produce **más de una página** (se cuenta `/Type /Page`); en `en` los labels salen en inglés; fuera de scope 404. Unit del renderer: el `docDefinition` de un `physical_count` trae teórico/contado/diferencia y el de una entrada no; **ningún tipo emite un total de unidades**
  - **Depende de:** F3-DOC-06
  - **Estimación:** 3.5 h

- [ ] **F3-DOC-08** — UI: listado por serie (montado 3 veces) + crear
  - **Salida:** `components/inventory/document-list.tsx` **reusable, parametrizado por `type`**, montado en `/movements/entries`, `/movements/exits` y `/movements/counts` con gate `inventory:read`: buscador por folio con debounce, chips de estatus (Borradores / Confirmados / Anulados), `WarehouseSelect` scoped, rango de fechas y usuario; tabla folio (mono, link), **badge de estatus**, almacén, motivo, fecha, líneas, quién; paginación server-side; estado vacío distinto para "todavía no hay" y "sin resultados"; botón **«Crear entrada / salida / conteo»** (gate `inventory:movement`) que llama a `createDraft` y **navega al borrador recién creado**; `lib/inventory/documents-api.ts` + hooks
  - **Verificar:** `routes/movements-documents.test.tsx` (routeTree real): las tres rutas montan el mismo componente con distinto `type` en el request; escribir en el buscador manda `folio`; el chip de anulados cambia el filtro `status`; el botón de crear postea y navega al id devuelto; sin `inventory:movement` el botón no existe pero el listado sí
  - **Depende de:** F3-DOC-06, F3-NAV-02
  - **Estimación:** 3.5 h

- [ ] **F3-DOC-09** — UI: pantalla del documento (captura del borrador y detalle del confirmado)
  - **Salida:** ruta `/movements/documents/$documentId`, **una sola pantalla que cambia de cara según el estado**. En `draft`: cabecera editable (motivo y campos contextuales según `REASON_RULES`, `WarehouseSelect`, autoriza, referencia, nota) + tabla de líneas contra el CRUD de F3-DOC-04 con **autoguardado** (debounce, indicador "guardado") + botón de importar Excel + **panel de previa en vivo** con `stockBefore → stockAfter`, lotes nuevos y errores por línea + **«Confirmar»** (deshabilitado con errores, con `ConfirmDialog`) + «Anular». En `confirmed`/`canceled`: solo lectura con lo que realmente pasó. Siempre: `components/inventory/download-document-button.tsx` reusable que pide el PDF con axios `responseType: 'blob'` y dispara la descarga (mismo helper que `downloadImportTemplate`: un `<a href>` iría sin el Bearer y daría 401)
  - **Verificar:** test web: editar una línea dispara el PATCH con debounce y muestra el indicador; el panel de previa refleja `stockAfter` tras cambiar la cantidad; con un error de línea el botón de confirmar está deshabilitado y el mensaje sale sobre la fila; un documento `confirmed` no renderiza inputs ni el botón de confirmar; el botón de PDF nombra el archivo con el folio
  - **Depende de:** F3-DOC-08, F3-DOC-05, F3-DOC-07
  - **Estimación:** 4 h

---

### Módulo F3-CORE — El Ledger: Servicio de Aplicación de Movimientos

> **El corazón de la fase.** Una sola transacción reusable — resolver líneas (presentación → base_unit, enteros, compuestos), bloquear en orden, validar, insertar movimientos, actualizar saldos, auditar — que consumen entradas, salidas, recepción, conteo y, en F4, la venta. Módulo `apps/api/src/modules/inventory/`. Es la primera concurrencia real y el primer `Prisma.Decimal` del proyecto: SDD COMPLETO, y F3-CORE-05 se prueba con transacciones concurrentes de verdad.

- [ ] **F3-CORE-01** — Catálogo compartido de motivos y reglas en `packages/shared`
  - **Salida:** `packages/shared/src/inventory.ts`: `MOVEMENT_DIRECTIONS`, `MOVEMENT_REASONS`, `REASONS_BY_DIRECTION` (la tabla de Convenciones), `SELECTABLE_ENTRY_REASONS` (`invoice|adjustment|customer_return`) y `SELECTABLE_EXIT_REASONS` (`adjustment|loss|consumption|expired|transfer`) para los formularios, `REASON_RULES[reason] = { requiresReference, requiresNote, requiresUnitCost, requiresLinkedWarehouse }`, `QUANTITY_DECIMALS = 4`, `hasValidQuantityScale()`, `TRANSFER_STALE_DAYS = 7`, `TRANSFER_STATUSES`; exportado desde `index.ts`
  - **Verificar:** `inventory.test.ts` en shared (reglas y escala, incluye `1.00005` y `1e-7`); test de contrato en el API: todo valor de `MovementReason`/`MovementDirection`/`TransferStatus` de Prisma existe en shared y viceversa, y el CHECK dirección×motivo de la migración coincide con `REASONS_BY_DIRECTION` (patrón F2-UOM-01)
  - **Depende de:** F3-DB-01, F3-DB-02
  - **Estimación:** 1.5 h

- [ ] **F3-CORE-02** — Módulo `inventory` + DTOs Zod + namespace i18n
  - **Salida:** `InventoryModule` registrado en `app.module.ts` (importa Prisma, Audit); `dto/movement-line.dto.ts` (`quantityAmount()`: positivo, ≤ `QUANTITY_DECIMALS`, ≤ 9 999 999 999.9999; `unitCost` con `moneyAmount()`; `productId`/`presentationId` uuid); `dto/create-entry.dto.ts` y `dto/create-exit.dto.ts` con `superRefine` que aplica `REASON_RULES` (errores por ruta: `reference`, `reasonNote`, `linkedWarehouseId`, `lines.N.unitCost`), `lines` no vacío (máx. 500); `apps/api/src/i18n/{es,en}/inventory.json` con TODAS las claves de la fase; controller vacío con `@ApiTags('inventory')`
  - **Verificar:** unit de los schemas: `invoice` sin `unitCost` en la línea 1 → error en `lines.1.unitCost`; `consumption` sin `reference` → error en `reference`; `message-keys.spec.ts` verde con el namespace nuevo
  - **Depende de:** F3-CORE-01, F3-DB-05
  - **Estimación:** 2 h

- [ ] **F3-CORE-03** — Alcance por almacén: helper único + `GET /warehouses?scoped=true`
  - **Salida:** `apps/api/src/modules/inventory/warehouse-scope.helpers.ts`: `assertWarehouseInScope(scope, warehouseId)` → 403 `inventory.warehouse_out_of_scope`; `warehouseScopeWhere(scope)` → `{}` con `"all"` o `{ id: { in } }`; `assertActiveWarehouse(tx, tenantId, id)` → 404 `warehouses.not_found` / 422 `inventory.warehouse_inactive`; `WarehousesController.list` acepta `?scoped=true` (activos ∩ `@CurrentUserScope()`) — **primer consumidor real del decorator**
  - **Verificar:** unit del helper (3 estados del scope); e2e `warehouse-scope-security`: Manager con scope [A] pide `?scoped=true` y recibe solo A; sin flag recibe todos (comportamiento F2 intacto)
  - **Depende de:** —
  - **Estimación:** 2 h

- [ ] **F3-CORE-04** — Resolución de líneas (`resolveLines`)
  - **Salida:** función `resolveLines(tx, tenantId, lines, { direction, reasonCode })` en `line-resolver.ts` — recibe las **líneas del borrador** (`inventory_document_lines`), y la MISMA función alimenta la previa del detalle (F3-DOC-06) y el confirm, que es lo que garantiza que lo previsualizado y lo asentado se validen igual: carga productos y presentaciones del tenant en 1 query cada uno; producto inexistente → 404 `inventory.product_not_found`; inactivo → 422 `inventory.product_inactive`; presentación ajena al producto o inactiva → 422 `inventory.presentation_invalid`; **`quantity × factor` → base_unit** (`Prisma.Decimal`, sin float); `allow_fractional_input=false` con decimales → 422 `inventory.integer_only_presentation` `{ presentationName, lineIndex }`; compuesto → 409 `inventory.composite_has_no_stock` salvo `direction='exit'` con `consumption|expired` (los devuelve marcados `expand: true` para F3-CORE-06); **lotes**: la línea acepta `lotCode?`, `expiresAt?`, `location?`, `lotId?`; si el producto tiene `tracks_lots` → en `entry` exige `lotCode` (422 `inventory.lot_required`) y crea/resuelve el `ProductLot` (si `expiresAt` viene y el lote ya existe con otra fecha → 409 `inventory.lot_expiry_mismatch`); en `exit` los datos de lote son opcionales (sin ellos, FEFO decide en F3-CORE-08); si el producto NO tiene `tracks_lots` y la línea trae lote → 422 `inventory.lot_not_tracked`; devuelve `ResolvedLine { productId, presentationId, quantityBase, quantityInput, unitCost, expand, lotId?, location? }`
  - **Verificar:** `line-resolver.spec.ts` (mock de tx): matriz presentación×decimal×dirección×motivo RED→GREEN; 2 líneas del mismo producto con presentaciones distintas convierten independientes; `0.1 + 0.2` en Decimal no produce `0.30000000000000004`
  - **Depende de:** F3-CORE-02, F3-DB-06
  - **Estimación:** 3.5 h

- [ ] **F3-CORE-05** — `StockLedgerService.apply()` — la transacción atómica
  - **Salida:** `stock-ledger.service.ts#apply(tx, { tenantId, userId, direction, reasonCode, warehouseId, lines: ResolvedLine[], header: { reasonNote, reference, authorizedBy, linkedWarehouseId, transferId, documentId } })`: (1) agrupa por `(productId, warehouseId)` sumando `quantityBase`; (2) `INSERT INTO stock_by_warehouse … ON CONFLICT DO NOTHING` para las filas faltantes (una sentencia con `unnest`); (3) `SELECT … FOR UPDATE` en UNA query `WHERE (product_id, warehouse_id) IN (…) ORDER BY product_id, warehouse_id` (`$queryRaw` tipado; NUMERIC llega como string → `new Prisma.Decimal`); (4) en `exit`, disponible ≥ solicitado agrupado → si no, 422 `inventory.insufficient_stock` `{ productId, sku, available, requested }` (la primera que falle, con `lineIndex`); (5) `createMany` de `stock_movements` con `document_id` común (uno por línea original, no por grupo); (6) `UPDATE stock_by_warehouse SET quantity = quantity ± Δ`; **(7) lotes**: para las líneas con `lotId` hace lo mismo sobre `stock_lots` (upsert de `(lot, warehouse, location)` + `FOR UPDATE` en el **mismo** orden determinista, después de las filas de `stock_by_warehouse`; en `exit` valida el saldo **del lote** además del total; los movimientos llevan `lot_id`/`location`) — así la invariante `Σ stock_lots == stock_by_warehouse` se sostiene por construcción en cada tx; devuelve `{ documentId, movements[], stock: [{ productId, warehouseId, quantity }], lots?: [{ lotId, warehouseId, location, quantity }] }`. `apply` **nunca abre transacción**: recibe la `tx` del llamador (mismo contrato que `AuditService.record`)
  - **Verificar:** `stock-ledger.integration.spec.ts` (Postgres real): dos salidas concurrentes de 60 sobre stock 100 → una 201 y otra 422, saldo 40; dos transacciones con órdenes cruzados (A,B) y (B,A) terminan sin deadlock; primer movimiento sobre producto sin fila crea la fila; entrada + salida en la misma tx dejan `stock_movements` = líneas y saldo correcto; **test de reconciliación**: tras N movimientos aleatorios (entradas, salidas, traspasos, con y sin lote) `stock_by_warehouse.quantity == Σentries − Σexits` por (product, warehouse) **y** `Σ stock_lots == stock_by_warehouse` para los productos con lote — es LA propiedad central de la fase
  - **Depende de:** F3-CORE-04, F3-DB-04, F3-DB-07
  - **Estimación:** 4 h

- [ ] **F3-CORE-06** — Expansión de compuestos para salida (`expandComposition`)
  - **Salida:** `composition-expander.ts#expand(tx, tenantId, lines)`: para cada línea `expand: true` carga el grafo de composición del tenant (reusa `composition-graph.ts`), recorre en recursión (anidados) y produce líneas de componente con `quantityBase = qty × cantidad_i × (1 + waste_i/100)`, agregadas por componente, cada una con `parentProductId` = compuesto raíz y `presentationId = null`; compuesto sin composición → 409 `inventory.composite_without_composition`
  - **Verificar:** `composition-expander.spec.ts`: compuesto anidado (A → B → C) descuenta C con el producto de cantidades y mermas; el resultado coincide con lo que `availability` habría permitido; ciclo residual en datos → corta sin colgar
  - **Depende de:** F3-CORE-04
  - **Estimación:** 2 h

- [ ] **F3-CORE-07** — Audit por lote de movimientos
  - **Salida:** `movement-audit.ts#recordMovementAudit(tx, auditService, { user, action, documentId, folio, warehouseId, reasonCode, lines: [{ productId, quantity, balanceAfter, parentProductId? }], extra? })` con `resourceType: 'inventory_document'`, `resourceId: documentId` y el **folio** en el payload (es lo que una persona busca cuando audita); acciones canónicas `inventory.entry`, `inventory.exit`, `inventory.transfer_dispatch` (una salida con motivo traspaso), `inventory.transfer_receive`, `inventory.transfer_cancel`, `inventory.physical_count_approve`
  - **Verificar:** unit: el `after` incluye saldo posterior por línea; se llama DENTRO de la tx (mock verifica el mismo `tx`)
  - **Depende de:** F3-CORE-05
  - **Estimación:** 45 min

- [ ] **F3-CORE-08** — FEFO: resolución de lote en salida (`resolveLotsFefo`)
  - **Salida:** `lot-fefo.ts#resolveLotsFefo(tx, tenantId, warehouseId, lines)` invocado por `apply` **antes** del lock, para cada línea `exit` de producto con `tracks_lots` que NO trae `lotId`: lee los `stock_lots` del producto en ese almacén con saldo > 0 ordenados por `expires_at ASC NULLS LAST, lot_code ASC, location ASC` y **reparte** la cantidad en orden (una línea de usuario → N sublíneas, una por `(lote, ubicación)`, hasta cubrirla); si el total no alcanza → el mismo 422 `inventory.insufficient_stock` de siempre; si el usuario **forzó** `lotId` (y opcionalmente `location`) → se respeta y se valida el saldo de ese lote (422 `inventory.insufficient_lot_stock` `{ lotCode, available, requested }`); el reparto se hace **dentro** de la tx y las filas elegidas entran al mismo `FOR UPDATE` que el resto (una carrera entre dos salidas FEFO del mismo producto la resuelve el lock, y la segunda relee). Documentado como el punto que F4 (POS) consume sin tocar
  - **Verificar:** `lot-fefo.spec.ts` + integración: el ejemplo de Carlos — lotes st30 (vence 01/10, 20), st10 (01/07, 10), st60 (01/12, 1); salida de 1 → baja st10 a 9; salida de 12 → st10 a 0 y st30 a 18 (dos movimientos, un `document_id`); lote sin `expires_at` va al final; forzar `lotId=st30` salta a st30; dos salidas FEFO concurrentes de 8 sobre st10=10 → una pasa, la otra relee y toma 2 de st10 + 6 de st30
  - **Depende de:** F3-CORE-05, F3-DB-07
  - **Estimación:** 3 h

---

### Módulo F3-ENTRY — Entradas

> La maquinaria (borrador, líneas, importación, previa, PDF) es de F3-DOC y la comparten los tres tipos. Acá vive **lo que hace distinta a una entrada**: sus motivos, el costo unitario y la validación dura del confirm.

- [ ] **F3-ENTRY-01** — `POST /inventory/documents/:id/confirm` para `type='entry'`
  - **Salida:** rama de entrada del `DocumentsConfirmController` (`inventory:movement`): el documento debe ser `draft`, de tipo `entry` y su almacén ∈ scope (403) y activo (422); motivos aceptados `SELECTABLE_ENTRY_REASONS` + `transfer` (solo con `transferId`, delega en F3-TRANSFER-03); `sale_return`/`physical_count` → 422 `inventory.reason_not_allowed`; `authorizedBy` debe ser usuario del tenant (422 `inventory.authorizer_invalid`); **acá es donde la validación se pone dura** sobre las líneas del borrador: sin líneas → 422 `inventory.document_empty`, línea sin cantidad → 400 en `lines.N.quantity`, `invoice` sin `unitCost` → 400 en `lines.N.unitCost`; en UNA tx: `resolveLines` (sobre `inventory_document_lines`) → `ledger.apply` → `markConfirmed` → `recordMovementAudit('inventory.entry')`; 201 `{ document: { id, folio, type, status }, movements, stock }`
  - **Verificar:** `inventory-entries.e2e-spec.ts`: borrador con presentación ×12 y 3 cajas → saldo 36, `unit_cost` guardado y documento `confirmed`; confirmar dos veces → la segunda 409 `inventory.document_not_draft` y el saldo NO se duplica; borrador vacío → 422 y sigue `draft`; presentación solo-enteros con `1.5` → 422 nombrando la presentación y el documento sigue editable; compuesto → 409; producto con `tracks_lots` sin `lotCode` → 422 `inventory.lot_required`; lote nuevo crea el `ProductLot` y la fila `(lot, warehouse, location)`; el folio es el que ya tenía el borrador (confirmar **no** pide uno nuevo); Manager fuera de scope → 403; Viewer → 403; cross-tenant 404
  - **Depende de:** F3-DOC-03, F3-DOC-06, F3-CORE-05, F3-CORE-07
  - **Estimación:** 3 h

- [ ] **F3-ENTRY-02** — Especialización de la UI para entrada
  - **Salida:** en la pantalla del documento (F3-DOC-09), la cara de `type='entry'`: selector de motivo desde `SELECTABLE_ENTRY_REASONS` con labels i18n neutros, campos que aparecen/desaparecen según `REASON_RULES` (referencia, nota, autoriza — select de usuarios vía `GET /users`), **columna Costo unitario visible solo con `invoice`** (`MONEY_STEP`, con total calculado) y la equivalencia por línea ("3 Caja = 36 unidad" con `unitName`); panel de éxito tras confirmar con el folio y `DownloadDocumentButton`; `lib/inventory/entry-schema.ts` (Zod compartido con las mismas reglas)
  - **Verificar:** `routes/movements-entries.test.tsx`: elegir `invoice` muestra Referencia y la columna de costo, y oculta Autoriza; elegir `adjustment` exige Nota y esconde el costo; cambiar la presentación recalcula la equivalencia; el 422 de solo-enteros se pinta sobre su fila
  - **Depende de:** F3-ENTRY-01, F3-DOC-09
  - **Estimación:** 3 h

---

### Módulo F3-EXIT — Salidas (incluye el despacho de traspaso)

> Misma maquinaria que la entrada. Lo propio de una salida: los motivos de salida, la validación de stock, la expansión de compuestos, FEFO y el **despacho de traspaso**, que es una salida con `reason_code='transfer'` — no un tipo de documento aparte.

- [ ] **F3-EXIT-01** — `confirm` para `type='exit'` (incluye despacho de traspaso)
  - **Salida:** rama de salida del confirm (`inventory:movement`): motivos `SELECTABLE_EXIT_REASONS`; `sale`/`physical_count` → 422 `inventory.reason_not_allowed`; scope + almacén activo; compuestos: `consumption|expired` → `expandComposition` y salidas de componentes en la misma tx, otros motivos → 409; **`transfer`**: `linkedWarehouseId` obligatorio, activo, del tenant, ≠ origen (422 `inventory.transfer_same_warehouse`), **sin exigir scope sobre el destino**; en la tx, y en este orden: crear el `Transfer { status: in_transit }` con sus `TransferLine` (agrupadas por producto en base_unit, `quantity_sent`) → `UPDATE inventory_documents SET transfer_id = …` (todavía es `draft`, así que el trigger lo permite; **por eso el traspaso se crea antes de marcar confirmado**) → `ledger.apply` → `markConfirmed`; audit `inventory.exit`, o `inventory.transfer_dispatch` si el motivo es traspaso; 201 `{ document: { id, folio, type, status }, movements, stock, transfer?: { id } }`
  - **Verificar:** `inventory-exits.e2e-spec.ts`: salida > stock → 422 `{ sku, available, requested }`, saldo intacto y documento sigue `draft`; salida de producto con lote sin `lotId` → FEFO (el ejemplo de Carlos: baja st10 a 9); con `lotId` forzado → ese lote; `transfer` de producto con lote → `transfer_lines` con `lot_id` y la recepción entra al **mismo lote** en el destino; `consumption` de compuesto descuenta componentes con `parent_product_id` y el compuesto no tiene saldo; `loss` de compuesto → 409; `transfer` crea el `Transfer` `in_transit`, el documento queda `SAL-000019` con `transfer_id` puesto, baja el origen y NO toca el destino; `transfer` a sí mismo → 422; Manager con scope [A] despacha de A hacia B (fuera de su scope) → 201
  - **Depende de:** F3-ENTRY-01, F3-CORE-06, F3-CORE-08, F3-DB-02
  - **Estimación:** 3.5 h

- [ ] **F3-EXIT-02** — Especialización de la UI para salida
  - **Salida:** la cara de `type='exit'` en la pantalla del documento: motivos de `SELECTABLE_EXIT_REASONS`; `transfer` muestra **Almacén destino** (`WarehouseSelect` de todos los activos menos el origen, no scoped) + leyenda "queda EN TRÁNSITO hasta que el destino confirme"; `consumption` muestra Área/Concepto (`reference`); `adjustment|loss|expired` muestran Autoriza + Nota; el panel de previa suma **Disponible** por línea (en base_unit y en la presentación elegida: "120 unidad = 10 Caja"), marca en rojo las líneas que exceden el disponible **sumando las líneas del mismo producto**, y en productos con lote muestra el **reparto FEFO** que se aplicaría ("saldrá 1 del lote st10, vence 01/07/2026") con un selector opcional de "forzar lote"; compuesto → leyenda "se descontarán sus componentes" con las unidades armables como techo
  - **Verificar:** `routes/movements-exits.test.tsx`: elegir `transfer` muestra el destino y excluye el origen; disponible 10 con cantidad 11 → error y confirmar deshabilitado; dos líneas del mismo producto 6 + 5 sobre 10 → error; el reparto FEFO aparece por línea; el éxito de un traspaso enlaza a `/movements/transfers`
  - **Depende de:** F3-EXIT-01, F3-ENTRY-02
  - **Estimación:** 3.5 h

---

### Módulo F3-TRANSFER — Ciclo de Vida del Traspaso

> El traspaso nace en F3-EXIT-01 (despacho), que es una **Salida con motivo traspaso** — no un tipo de documento propio (corrección de Carlos, 2026-08-18). Acá vive el resto: listar según scope, ver detalle, **confirmar recepción** (que es un borrador de **Entrada** con motivo traspaso, precargado), cancelar. El traspaso no tiene folio propio: el suyo es el de su documento de despacho. Recibido > enviado bloqueado; el cancelado no devuelve stock.

- [ ] **F3-TRANSFER-01** — `GET /transfers`
  - **Salida:** `TransfersController` (`inventory:read`) en el módulo inventory: filtros `status` (default `in_transit`), `direction=incoming|outgoing` (incoming = destino ∈ scope; outgoing = origen ∈ scope; sin filtro = cualquiera de los dos; con scope `"all"` ambos tabs ven todo), `originWarehouseId`, `destinationWarehouseId`, `from`, `to`, `olderThanDays`; `page/pageSize`; orden `created_at desc, id desc`; fila `{ id, folio (el de su documento de despacho, un `SAL-…`), status, origin: {id,name}, destination: {id,name}, createdAt, createdBy: {id,name}, lineCount, daysInTransit, isStale (> TRANSFER_STALE_DAYS) }`; `meta { incomingCount, outgoingCount }` para los contadores de las tabs
  - **Verificar:** `transfers.e2e-spec.ts`: Manager con scope [B] ve el traspaso A→B como incoming y no como outgoing; `olderThanDays=7` filtra; paginación estable con dos filas del mismo instante
  - **Depende de:** F3-EXIT-01, F3-CORE-03
  - **Estimación:** 2.5 h

- [ ] **F3-TRANSFER-02** — `GET /transfers/:id`
  - **Salida:** (`inventory:read`) cabecera completa (origen, destino, estado, created/received/canceled by+at con nombres, `cancelReason`, `discrepancyNote`) + `lines: [{ productId, sku, name, baseUnit, quantitySent, quantityReceived, difference }]` (difference derivada, null hasta confirmar); visible si origen **o** destino ∈ scope, si no 404
  - **Verificar:** e2e: usuario del destino lo ve; usuario con scope ajeno a ambos → 404; `difference` = sent − received tras confirmar
  - **Depende de:** F3-TRANSFER-01
  - **Estimación:** 1 h

- [ ] **F3-TRANSFER-03** — Recepción: `POST /inventory/entries` con `reasonCode='transfer'` + `transferId`
  - **Salida:** `POST /transfers/:id/receipt-draft` (`inventory:movement`) crea un **borrador de Entrada** (`ENT`) con motivo `transfer`, almacén = destino, `transferId` puesto y **las líneas precargadas con lo enviado** (el usuario solo corrige lo que llegó de menos) — así la recepción usa exactamente la misma pantalla que cualquier entrada. Al confirmarlo, la rama de `transfer` del confirm llama a `TransfersService.receive(tx, …)`: `transferId` obligatorio (sin él → 422 `inventory.transfer_entry_requires_transfer`); transfer del tenant y `in_transit` — se toma **primero** con `UPDATE … WHERE status='in_transit'` y `rowCount = 1` como lock lógico (409 `inventory.transfer_not_in_transit` si 0); `warehouseId` = destino (422 `inventory.transfer_wrong_destination`) y ∈ scope; `linkedWarehouseId` se completa server-side con el origen; líneas **sin presentación** (422), en base_unit, **todas** las del traspaso y ninguna ajena (identificadas por `productId` + `lotId` cuando la línea tiene lote: lo recibido entra al mismo lote y el usuario indica `location` en destino) (422 `inventory.transfer_lines_incomplete` / `inventory.transfer_line_unknown`); `0 ≤ received ≤ sent` (422 `inventory.received_exceeds_sent` `{ productId, sent, received }`); alguna < → `reasonNote` obligatoria (400 en `reasonNote`) → `discrepancy_note`; en la tx: `ledger.apply` solo con líneas > 0, `quantity_received` por línea, `status='completed'` y `received_by/at` (el vínculo con el documento de entrada lo lleva `inventory_documents.transfer_id`, no una columna en `transfers`); audit `inventory.transfer_receive` con `{ folio, lines: [{ productId, sent, received, difference }], discrepancyNote }`; 201 con `document: { id, folio, type, status }` (un `ENT-…`) y `transfer: { id, status, dispatchFolio }`. La diferencia sent−received simplemente **no entra** al destino (ya salió del origen): no se crea un `loss` automático
  - **Verificar:** e2e: pedir el borrador de recepción dos veces devuelve el MISMO (lo garantiza el UNIQUE parcial `(transfer_id, type)`); recepción exacta → destino sube, `completed`, y el documento de entrada `ENT-000043` queda ligado al mismo traspaso que el `SAL-000019` del despacho; con faltante y nota → `discrepancy_note` guardada, audit con la diferencia; faltante sin nota → 400; recibido > enviado → 422 y nada cambia; dos recepciones concurrentes → una 201 y otra 409; línea con presentación → 422
  - **Depende de:** F3-ENTRY-01, F3-EXIT-01, F3-DOC-04
  - **Estimación:** 3 h

- [ ] **F3-TRANSFER-04** — `POST /transfers/:id/cancel`
  - **Salida:** (`inventory:manage`) body `{ reason }` obligatoria (min 5); solo `in_transit` (409 `inventory.transfer_not_in_transit`); `status='canceled'`, `canceled_by/at`, `cancel_reason`; **el stock NO vuelve al origen** (docblock explica el porqué: la salida ya ocurrió y es historia; el reingreso es un `adjustment` explícito y auditado); audit `inventory.transfer_cancel`
  - **Verificar:** e2e: TenantAdmin cancela → `canceled` y saldo del origen intacto; Manager → 403; sin `reason` → 400; cancelar uno `completed` → 409
  - **Depende de:** F3-EXIT-01, F3-DB-05
  - **Estimación:** 1.5 h

- [ ] **F3-TRANSFER-05** — UI `/movements/transfers`: dos tabs + filtros
  - **Salida:** ruta con gate `inventory:read`; tabs "Pendientes de recibir (n)" / "Pendientes de enviar (n)" con contadores de `meta`; filtros origen/destino (`WarehouseSelect` no scoped), antigüedad (todos / > 7 días), rango de fechas; tabla folio (el del documento de despacho, link al documento), fecha, origen, destino, líneas, días con **badge** naranja `isStale`; paginación server-side; estado vacío por tab; `lib/inventory/transfers-api.ts` + hooks
  - **Verificar:** `routes/movements-transfers.test.tsx`: cambiar de tab cambia `direction` en el request; fila con `isStale` muestra el badge (por dato, no por copy); sin permiso → gate
  - **Depende de:** F3-TRANSFER-01, F3-NAV-02
  - **Estimación:** 3 h

- [ ] **F3-TRANSFER-06** — UI modal de recepción
  - **Salida:** click en fila incoming (`inventory:movement`) → modal con `GET /transfers/:id`: cabecera (origen → destino, enviado por, fecha), tabla enviado / **recibido** (input pre-cargado = enviado) / diferencia; recibido > enviado → error inline + leyenda "registralo como Entrada con motivo Ajuste" y confirmar deshabilitado; alguna diferencia → campo Nota obligatorio; «Confirmar recepción» → `POST /transfers/:id/receipt-draft` y **navega al borrador** (la recepción se completa en la pantalla del documento, la misma de cualquier entrada, con las líneas precargadas); 409 (ya cerrado por otro) → mensaje y refresco
  - **Verificar:** test web: el botón postea el borrador y navega a `/movements/documents/$id`; recibido 31 sobre 30 bloquea en la pantalla del documento; 29 exige nota
  - **Depende de:** F3-TRANSFER-02, F3-TRANSFER-03, F3-TRANSFER-05
  - **Estimación:** 3 h

- [ ] **F3-TRANSFER-07** — UI cancelar traspaso
  - **Salida:** acción "Cancelar traspaso" visible solo con `inventory:manage`, `ConfirmDialog` con textarea de justificación obligatoria y leyenda "el stock NO vuelve al origen; si reaparece, registralo como Entrada con motivo Ajuste"; → `POST /transfers/:id/cancel`; refresco de tabs
  - **Verificar:** test web: sin `inventory:manage` no hay acción; con justificación vacía el botón queda deshabilitado; el request lleva `reason`
  - **Depende de:** F3-TRANSFER-04, F3-TRANSFER-05
  - **Estimación:** 1.5 h

---

### Módulo F3-COUNT — Inventario Físico (plantilla, reconciliación, aprobación)

> **El conteo también es un documento con folio (`INV`) y borrador** (corrección del 2026-08-18): se crea desde el listado de Inventario, se baja la plantilla, se sube el contado a sus líneas, se revisa la reconciliación —que es la previa del borrador— y **solo `inventory:manage` confirma**. Se puede cerrar el sistema y retomarlo por folio, que en un conteo de 500 líneas es exactamente cuando más importa. **Una sola plantilla para todo**: los productos con `tracks_lots` ocupan una fila por (lote, ubicación) con `lot_code`/`expires_at`/`location`; los demás una fila con esas columnas vacías — es exactamente el Excel del cliente de Carlos.

- [ ] **F3-COUNT-01** — `GET /inventory/counts/template?warehouseId&format=xlsx|csv`
  - **Salida:** `GET /inventory/documents/template?type=physical_count&warehouseId=…` (`inventory:movement`) scope + almacén activo; filas = productos **activos y no compuestos** del tenant, columnas `sku, name, unit, lot_code, expires_at, location, theoretical, counted` (`counted` vacío); para productos **sin** `tracks_lots`: una fila, columnas de lote vacías, `theoretical` = `stock_by_warehouse` o 0; para productos **con** `tracks_lots`: una fila por `stock_lots (lot, warehouse, location)` con saldo > 0 (y una fila vacía de lote si no tiene ninguno, para poder cargar el primero); orden por sku, luego `expires_at`, `lot_code`, `location`; reusa `spreadsheet.ts` (`serializeSpreadsheet`), xlsx en base64 como F2-IMPORT-05; `count-template.service.ts`
  - **Verificar:** `inventory-counts.e2e-spec.ts`: la plantilla trae el SKU con su teórico real tras una entrada; un producto con 3 lotes en 3 ubicaciones sale en 3 filas (el Excel de Carlos); excluye compuestos; csv y xlsx round-trip por `parseSpreadsheet`
  - **Depende de:** F3-CORE-02, F3-CORE-03, F3-DB-06
  - **Estimación:** 2.5 h

- [ ] **F3-COUNT-02** — `POST /inventory/counts/reconcile` (dry-run puro)
  - **Salida:** la reconciliación **deja de ser un endpoint propio**: subir el archivo es `POST /inventory/documents/:id/lines/import` (F3-DOC-05) y el resultado reconciliado es el **detalle del borrador** (F3-DOC-06), que para `physical_count` agrega `theoretical` y `difference` por línea. Reglas por fila: `sku` existe, activo, no compuesto; `counted` numérico ≥ 0 con ≤ 4 decimales, **entero si la presentación base (factor 1) es solo-enteros**; **lotes**: si el producto tiene `tracks_lots`, `lot_code` es obligatorio (error de fila) y la clave de la fila es `(sku, lot_code, location)`; un `lot_code` que no existe se marca `newLot: true` (se creará al aprobar; `expires_at` obligatoria si el producto lo exige) y si existe con otra `expires_at` → error de fila; si el producto NO tiene `tracks_lots` y la fila trae lote → error de fila; duplicado de la clave en el archivo → error de fila; `counted` vacío → fila `skipped`; el teórico se lee **en el momento de mirar** y el `summary` suma `{ counted, matches, discrepancies, skipped, newLots }`; nada se escribe en stock hasta confirmar
  - **Verificar:** e2e: archivo mixto (2 iguales, 1 sobrante, 1 faltante, 1 vacío, 1 sku inexistente, 1 decimal en solo-enteros, 1 lote nuevo, 1 lote con caducidad distinta, 1 lote en producto sin `tracks_lots`) → summary y errores esperados; ningún `stock_movement` ni `product_lot` creado
  - **Depende de:** F3-COUNT-01, F3-CORE-04
  - **Estimación:** 3.5 h

- [ ] **F3-COUNT-03** — `POST /inventory/counts/approve` (transacción)
  - **Salida:** rama `physical_count` del confirm (**`inventory:manage`** — es el único tipo que no basta con `inventory:movement`); las líneas salen del borrador, no del body; scope; en UNA tx: crea los `ProductLot` nuevos, `FOR UPDATE` ordenado sobre `stock_by_warehouse` **y** `stock_lots`, relee el teórico **fresco** (por lote cuando aplica); por línea con `counted ≠ theoreticalNow`: **salida `physical_count` del teórico total** (si > 0) + **entrada `physical_count` del contado** (si > 0), mismo `document_id`, con `lot_id`/`location` cuando aplica (así la invariante lote/total se sostiene: el ledger las mueve juntas); iguales → sin movimiento (el CHECK `quantity > 0` lo exige); todo lo generado cuelga del documento `physical_count` (folio `INV`) que ya existía como borrador; audit `inventory.physical_count_approve` con `summary` y por línea `{ productId, theoreticalSeen, theoreticalAtApproval, counted, drifted: seen ≠ now }`; 201 `{ document: { id, folio, type, status }, applied, unchanged, drifted }`
  - **Verificar:** e2e: teórico 120 / contado 115 → dos movimientos (−120, +115), saldo 115; línea igual → 0 movimientos; producto con lotes st30/st10/st60 contado 20/9/1 → solo st10 genera movimientos y el total baja a 30; lote nuevo en la planilla → `ProductLot` creado y saldo cargado; entrada de +10 entre reconcile y approve → `drifted: true` en audit y saldo final = contado; Manager → 403
  - **Depende de:** F3-COUNT-02, F3-CORE-05, F3-CORE-07, F3-DB-07, F3-DOC-03
  - **Estimación:** 3.5 h

- [ ] **F3-COUNT-04** — UI `/movements/inventory-count` paso 1
  - **Salida:** la cara de `type='physical_count'` en la pantalla del documento (F3-DOC-09): `WarehouseSelect` scoped en la cabecera, botones "Descargar plantilla .xlsx / .csv" y control de archivo como botón (input `sr-only` + label, patrón F2-IMPORT-05) que sube al borrador; errores por fila en tabla con descarga csv; sin checkbox de bloqueo (decisión) y leyenda "el conteo se aplica sobre el saldo del momento de aprobar"; leyenda de la plantilla: "los productos con lote traen una fila por lote y ubicación; deja las columnas de lote vacías en los que no lo manejan"
  - **Verificar:** test web: la plantilla se pide con el `warehouseId` elegido; el archivo viaja en base64; errores de fila se listan por `row`
  - **Depende de:** F3-COUNT-02, F3-NAV-01, F3-NAV-02
  - **Estimación:** 2.5 h

- [ ] **F3-COUNT-05** — UI paso 2: reconciliación y aprobación
  - **Salida:** el panel de previa del borrador `INV`: resumen (contados / coincidencias / discrepancias / omitidos), tabla SKU / lote / caducidad / ubicación / teórico / contado / diferencia (las tres de lote solo si alguna fila las trae) con filtro "solo discrepancias" y badge "lote nuevo" en las filas `newLot`, descarga del reporte (csv client-side), leyenda de lo que se generará; botón **Confirmar** con gate `inventory:manage` (sin él: aviso "un TenantAdmin debe aprobar este conteo" — y el borrador queda guardado esperándolo, que es media razón por la que existe) → `ConfirmDialog` → confirm; resultado con `drifted` destacado; "Nuevo conteo"
  - **Verificar:** test web: sin `inventory:manage` el botón no existe y el aviso sí; el borrador sobrevive a recargar la página; resultado con `drifted > 0` muestra la advertencia
  - **Depende de:** F3-COUNT-03, F3-COUNT-04
  - **Estimación:** 3 h

---

### Módulo F3-KARDEX — Kardex y Consultas de Stock

- [ ] **F3-KARDEX-01** — `GET /products/:id/kardex`
  - **Salida:** `KardexController` (`inventory:read`, en el módulo inventory): filtros `warehouseId` (∈ scope, si no 403), `from`, `to`, `direction`, `reasonCode`; `page/pageSize`; orden `created_at desc, seq desc`; **`balanceAfter`** con window function `SUM(CASE direction WHEN 'entry' THEN quantity ELSE -quantity END) OVER (PARTITION BY warehouse_id ORDER BY created_at, seq)` calculada en una CTE sobre TODO el histórico del producto en los almacenes del scope, y recién después filtros + paginación (`$queryRaw` tipado); **`seq` es `BigInt` y `JSON.stringify` revienta con BigInt** — sirve para ORDENAR, no para exponerlo crudo en la respuesta; fila `{ id, document: { id, folio, type, status } (el folio es un link al documento), createdAt, direction, reasonCode, quantity, presentation: { id, name, factor, quantityInPresentation } | null, lot: { id, lotCode, expiresAt } | null, location, unitCost, warehouse: {id,name}, linkedWarehouse | null, transfer: { id, folio } | null, parentProduct: { id, sku, name } | null, reference, reasonNote, createdBy: {id,name}, balanceAfter }`; filtro opcional `lotId`
  - **Verificar:** `kardex.e2e-spec.ts`: secuencia +50, −10, +5 en A y +7 en B → `balanceAfter` 50/40/45 en A y 7 en B; **una entrada de 3 líneas en la misma tx muestra saldos intermedios correctos y en orden estable** (es lo que `seq` garantiza); filtrar `reasonCode` no altera los saldos; Manager con scope [A] no ve filas de B y `warehouseId=B` → 403
  - **Depende de:** F3-CORE-03, F3-CORE-05
  - **Estimación:** 3.5 h

- [ ] **F3-KARDEX-02** — UI tab Kardex en el detalle de producto
  - **Salida:** tab "Kardex" en `catalog.products.tsx` (visible con `inventory:read`) → `components/inventory/kardex-tab.tsx`: filtros (almacén scoped, fechas, dirección, motivo), tabla fecha / tipo (badge por dirección + motivo i18n) / cantidad con signo y presentación / lote · caducidad · ubicación (solo si el producto tiene `tracks_lots`) / almacén / referencia-folio (link a traspasos) / usuario / **saldo en almacén**; paginación server-side; compuestos muestran aviso "los compuestos no tienen kardex propio: mirá sus componentes"
  - **Verificar:** `routes/catalog-products.test.tsx` extendido: la tab existe con `inventory:read` y no sin él; cambiar filtro dispara request con `reasonCode`; el saldo se pinta desde `balanceAfter`
  - **Depende de:** F3-KARDEX-01, F3-NAV-02
  - **Estimación:** 3 h

- [ ] **F3-KARDEX-03** — `GET /products/:id/stock`
  - **Salida:** (`inventory:read`) filas por almacén **activo ∈ scope** `{ warehouseId, name, quantity, updatedAt }` (0 y `updatedAt: null` si no hay fila), `total`, `stockMin`, `belowMin`; `?warehouseId=` devuelve solo ese (lo usa la salida en vivo); producto con `tracks_lots` → cada fila de almacén trae `lots: [{ lotId, lotCode, expiresAt, location, quantity }]` ordenados FEFO (el primero es el que se descuenta primero) más `expiringSoon` (lotes con `expires_at` ≤ hoy + 30 días); compuesto → `{ isComposite: true, rows: [], availability: { units, limitingComponent } }` (reusa `availability`)
  - **Verificar:** e2e: tras entradas en A y B, Manager con scope [A] recibe solo A y `total` = A; producto sin filas → filas en 0; producto con lotes devuelve `lots` en orden FEFO y `Σ lots.quantity == quantity` de la fila; compuesto responde availability
  - **Depende de:** F3-CORE-03, F3-DB-02, F3-DB-06
  - **Estimación:** 2 h

- [ ] **F3-KARDEX-04** — `GET /inventory/in-transit`
  - **Salida:** (`inventory:read`) agregado por producto de `transfer_lines` de traspasos `in_transit` con **origen ∈ scope** (stock que salió y no fue confirmado): `{ productId, sku, name, baseUnit, quantity, transfers }`; filtros `productId`, `originWarehouseId`; paginado por sku; también expuesto como `inTransit` en la respuesta de F3-KARDEX-03 (por producto)
  - **Verificar:** e2e: traspaso de 10 → `quantity: 10`; tras confirmar 9 → desaparece del listado (no hay parciales); cancelado → desaparece
  - **Depende de:** F3-EXIT-01, F3-KARDEX-03
  - **Estimación:** 1.5 h

- [ ] **F3-KARDEX-05** — UI tab "Stock por almacén"
  - **Salida:** tab en el detalle de producto (`inventory:read`) → `components/inventory/stock-tab.tsx`: tabla almacén / cantidad (con `unitName`) / actualizado, fila **Total** con badge "bajo mínimo" si `belowMin`, fila **En tránsito** desde `inTransit`; producto con `tracks_lots` → cada almacén se expande en sus lotes (lote, caducidad, ubicación, cantidad) con badge "vence pronto" en `expiringSoon` y "se descuenta primero" en el primero FEFO; compuesto → panel de unidades armables + componente limitante (reusa el resumen de BOM); links "Registrar entrada / salida" hacia los forms con el producto preseleccionado (query param) si tiene `inventory:movement`
  - **Verificar:** test web: `belowMin: true` muestra el badge; compuesto renderiza availability y no la tabla; sin `inventory:movement` no hay links
  - **Depende de:** F3-KARDEX-03, F3-KARDEX-04, F3-NAV-02
  - **Estimación:** 2 h

---

### Módulo F3-LOTS — Lotes, Caducidad y Ubicación (opt-in por producto)

> Lo que no cabe en los otros módulos: el flag en el producto, el endpoint de lotes que consumen los formularios, la guarda para apagar el flag y las alertas de vencimiento. La lógica de STOCK por lote (FEFO, upsert, invariante) vive en F3-CORE; la captura vive en ENTRY/EXIT/COUNT. Decisión de Carlos (2026-08-17) sobre un Excel real de cliente — ver `topic_key: sellpoint/f3-lots-fefo`.

- [ ] **F3-LOTS-01** — `tracks_lots` en el producto (API + form) con guarda para apagarlo
  - **Salida:** `tracksLots` en `createProductSchema`/`updateProductSchema` (default `false`); `products.service.update` con `tracksLots: false` sobre un producto que tiene `stock_lots` con saldo > 0 → 409 `products.lots_in_stock` (con el total por lote en el payload) — apagarlo con saldo dejaría lotes huérfanos y rompería la invariante; encenderlo siempre se puede (los saldos previos quedan como "sin lote": el ledger, al primer movimiento de un producto recién marcado, exige lote solo para lo que ENTRA de ahí en más — el saldo previo se puede asignar a lotes vía inventario físico); checkbox "Este producto se controla por lote y caducidad" en `ProductForm` con `title` explicativo cuando está bloqueado; en la planilla de importación (F2-IMPORT) columna `controla_lotes` opcional; docblock con la regla
  - **Verificar:** e2e `products`: encender → 200; apagar con saldo en lote → 409; apagar sin saldo → 200; test web: el checkbox se deshabilita con `title` cuando el API lo bloquearía (el detalle trae `hasLotStock`)
  - **Depende de:** F3-DB-06
  - **Estimación:** 2 h

- [ ] **F3-LOTS-02** — `GET /products/:id/lots` + `GET /warehouses/:id/locations`
  - **Salida:** (`inventory:read`) lista de `product_lots` del producto `{ id, lotCode, expiresAt, totalQuantity, byWarehouse: [{ warehouseId, location, quantity }] }` ordenados FEFO, `?withStock=true` filtra saldo > 0, `?warehouseId=` acota; `GET /warehouses/:id/locations` devuelve las ubicaciones **distintas** ya usadas en `stock_lots` de ese almacén (para el autocompletado; texto libre, sin catálogo); ambos respetan scope
  - **Verificar:** e2e: tras entradas en dos lotes, el listado los trae en orden FEFO con `totalQuantity` correcto; ubicaciones distintas sin repetir; Manager fuera de scope → 403
  - **Depende de:** F3-DB-06, F3-CORE-03
  - **Estimación:** 1.5 h

- [ ] **F3-LOTS-03** — Alertas de vencimiento (chicas, sin jobs)
  - **Salida:** `GET /inventory/expiring?days=30&warehouseId?` (`inventory:read`): lotes con `expires_at ≤ hoy + days` y saldo > 0 en almacenes del scope, `{ productId, sku, name, lot: { lotCode, expiresAt }, warehouse, location, quantity, daysLeft }` ordenados por `expires_at`; incluye `expired: true` para los ya vencidos; **sin cron ni notificaciones** (F5/F6 deciden si hay mail); tarjeta "Próximos a vencer (n)" en el dashboard (solo si el tenant tiene algún producto con `tracks_lots`) con link a una vista `/movements/expiring` (tabla + filtro días 7/30/90 + botón "Dar salida por caducado" que abre la Salida con motivo `expired`, producto y lote preseleccionados)
  - **Verificar:** e2e: lote que vence en 10 días aparece con `days=30` y no con `days=7`; vencido ayer aparece con `expired: true`; sin `tracks_lots` en el tenant, la tarjeta no se renderiza (test web por datos)
  - **Depende de:** F3-LOTS-02, F3-EXIT-02, F3-NAV-02
  - **Estimación:** 3 h

- [ ] **F3-LOTS-04** — Editar un lote (caducidad y código) con auditoría
  - **Salida:** `PATCH /products/:id/lots/:lotId` (`inventory:movement`) para corregir `expiresAt` o `lotCode` (`lotCode` único por producto → 409 `inventory.lot_code_taken`); cambiar `expiresAt` **cambia el orden FEFO** de todo el stock de ese lote — se audita con before/after (`inventory.lot_update`); no se borra un lote (los movimientos lo referencian; sin saldo simplemente deja de aparecer con `withStock=true`); UI: en la tab Stock por almacén, acción "Editar lote" sobre la fila del lote con `ConfirmDialog` si cambia la caducidad ("esto cambia qué lote se vende primero")
  - **Verificar:** e2e: cambiar caducidad y una salida FEFO posterior toma el nuevo orden; código repetido → 409; audit registra before/after; test web: el diálogo aparece solo al cambiar la fecha
  - **Depende de:** F3-LOTS-02, F3-KARDEX-05
  - **Estimación:** 2 h

---

### Módulo F3-GUARDS — Puntos de Extensión Heredados de F2

> F2 dejó cinco lugares documentados "F3 lo completa". Se cierran acá, cada uno con su e2e, más una limpieza de vocabulario que exige la LEY. Criterio: **si el API tiene una guarda, la UI la muestra antes del clic** (disabled + title), no deja chocar con el 409.

- [ ] **F3-GUARDS-01** — `presentations.service#assertDeletable`: presentación en uso
  - **Salida:** el cuerpo vacío pasa a `tx.stockMovement.count({ where: { presentationId } }) > 0` → 409 `products.presentation_in_use` (claves i18n es/en); la UI de presentaciones (F2-PRESENT-04) mapea el 409 a "tiene movimientos: desactivala"; el FK RESTRICT de F3-DB-01 queda como red
  - **Verificar:** e2e `products`: entrada con la presentación → `DELETE` 409; desactivar sigue funcionando; sin movimientos borra
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h

- [ ] **F3-GUARDS-02** — `products.remove` y `assertBaseUnitChangeable` con movimientos
  - **Salida:** `remove` → 409 `products.has_movements` si existen `stock_movements` con `product_id` **o** `parent_product_id` = id, o `transfer_lines`, o `product_lots`; `assertBaseUnitChangeable` suma 409 `products.base_unit_locked_by_movements` (con historia, la unidad no cambia aunque el saldo sea 0); UI mapea ambos (base_unit deshabilitada con motivo; borrar ofrece desactivar); el comentario "su receta" de `products.service.ts:328` pasa a "su composición" (LEY)
  - **Verificar:** e2e: producto con una salida → `DELETE` 409 y `PATCH baseUnit` 409; `rg -n "receta" apps/api/src` sin resultados
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h

- [ ] **F3-GUARDS-03** — Almacén: no desactivar con stock ni traspasos abiertos (CU-ALM-02)
  - **Salida:** `warehouses.update` con `isActive: false` → 409 `warehouses.has_stock` si `Σ stock_by_warehouse.quantity > 0` en el almacén (con el total en el payload) o 409 `warehouses.has_transfers_in_transit` si es origen/destino de un `Transfer in_transit`; docblock de F2 actualizado; UI de almacenes mapea ambos y deshabilita el toggle con `title` cuando aplica
  - **Verificar:** e2e `warehouses`: con saldo → 409; tras salida a 0 → desactiva; con traspaso pendiente → 409
  - **Depende de:** F3-DB-02
  - **Estimación:** 1.5 h

- [ ] **F3-GUARDS-04** — `TenantTransactionsGate.hasTransactions()` real
  - **Salida:** `withTenantContext` → `stockMovement.count() > 0`; el `TODO(F3-F4)` pasa a `TODO(F4): sumar sales`; test unit del gate actualizado
  - **Verificar:** e2e `tenants-me`: tenant recién creado cambia currency; tras una entrada → 409 (guard existente)
  - **Depende de:** F3-DB-01
  - **Estimación:** 1 h

- [ ] **F3-GUARDS-05** — `availability` respeta el scope + nota de `costEstimate`
  - **Salida:** `CompositionService.availability(user, productId, scope)` suma stock solo de `warehouseScopeWhere(scope)`; el controller pasa `@CurrentUserScope()`; `costEstimate` mantiene `cost/factor` y su docblock dice "promedio ponderado → F5" (decisión Carlos 2026-08-17); tests de availability actualizados con stock sembrado en dos almacenes y scope parcial; F2-BOM-05 (columna unidades armables en la lista) hereda el scope sin cambios de UI
  - **Verificar:** unit: stock 10 en A y 10 en B, scope [A] → armables según A; e2e con Manager scoped
  - **Depende de:** F3-CORE-03
  - **Estimación:** 1.5 h

---

### Módulo F3-NAV — Navegación, Selector de Almacén y Alcance en UI

- [ ] **F3-NAV-01** — Componente `WarehouseSelect`
  - **Salida:** `components/inventory/warehouse-select.tsx`: props `scoped` (usa `GET /warehouses?scoped=true`) o todos los activos, `excludeIds`, `value/onChange`, auto-selección si hay uno solo, estado vacío con CTA a `/warehouses` (con `warehouses:manage`), integrado con react-hook-form; `lib/warehouses/hooks.ts` gana `useScopedWarehouses()`
  - **Verificar:** test del componente: con `scoped` pide `?scoped=true`; con un solo almacén lo selecciona; `excludeIds` lo quita de las opciones
  - **Depende de:** F3-CORE-03
  - **Estimación:** 1.5 h

- [ ] **F3-NAV-02** — Grupo nav "Movimientos" + rutas + namespace i18n web + cliente API
  - **Salida:** grupo "Movimientos" en `app-layout.tsx` (**Entradas**, **Salidas** e **Inventario** → `inventory:read` — los tres abren su listado con buscador por folio y botón de crear, que exige `inventory:movement`; Traspasos → `inventory:read`; Próximos a vencer → `inventory:read` **solo si el tenant tiene productos con `tracks_lots`**; el grupo aparece si alguno); rutas registradas con `PermissionGate` y placeholders hasta sus módulos; `apps/web/src/i18n/{es,en}/inventory.json` (motivos, direcciones, estados de traspaso, copy neutro) cableado en `i18n/index.ts`; `lib/inventory/api.ts` + `hooks.ts` + `types.ts` base (tipos de respuesta del API, `useCreateEntry/useCreateExit` con invalidación de `products`, `stock`, `transfers`)
  - **Verificar:** test por routeTree real: el Viewer ve los cinco listados pero sin botón de crear; el Manager los ve con el botón; sin ningún permiso el grupo no existe; guardián de voseo verde con el namespace nuevo
  - **Depende de:** F3-DB-05
  - **Estimación:** 2 h

- [ ] **F3-NAV-03** — UI de alcance por almacén en `UserForm` (deuda de F2-SCOPE-03)
  - **Salida:** sección "Alcance por almacén" en `components/system/user-form.tsx` (CU-SYS-04): checklist de almacenes vía `GET/PUT /users/:id/warehouse-scope`; **deshabilitada si el usuario tiene rol TenantAdmin** con leyenda de acceso total; vacío = todos (leyenda del default permisivo); `lib/rbac/api.ts` gana los dos calls
  - **Verificar:** `routes/system-users.test.tsx`: estados derivados de datos (rol, filas), no de copy; guardar manda el reemplazo completo de ids
  - **Depende de:** —
  - **Estimación:** 2 h

---

### ✅ Definición de "Fase 3 completa"

- [ ] Un Manager registra una **entrada** por factura con presentación (cajas → base_unit), costo unitario y referencia; el saldo del almacén sube y el movimiento aparece en el kardex con su presentación
- [ ] Una **salida** por más de lo disponible falla con `{ sku, available, requested }` y no toca el saldo; dos salidas concurrentes nunca dejan stock negativo (`stock-ledger.integration.spec.ts`)
- [ ] Salida por consumo de un **compuesto** descuenta sus componentes (anidados incluidos) y ningún compuesto tiene fila en `stock_by_warehouse`; entrada de compuesto → 409
- [ ] Un **traspaso** completo: despacho como Salida con motivo Traspaso (folio `SAL-000019`, origen baja, `in_transit`) → visible en "Pendientes de recibir" del destino y "Pendientes de enviar" del origen → «Confirmar recepción» abre un borrador de Entrada precargado (`ENT-000043`) → se corrige el faltante con su nota → `completed`, destino sube lo recibido, diferencia derivada y auditada; recibido > enviado bloqueado; cancelación solo TenantAdmin con justificación y **sin** devolver stock; badge > 7 días
- [ ] **Inventario físico**: plantilla SKU + teórico → planilla contada → reconciliación con resumen → aprobación (solo `inventory:manage`) genera salida del teórico + entrada del contado por línea con diferencia y audita el drift si algo se movió en el medio
- [ ] **Kardex** del producto con filtros y `balanceAfter` correcto por almacén **y en orden estable dentro de un mismo lote de movimientos** (`seq`), y tab **Stock por almacén** con total, bajo mínimo, en tránsito y desglose por lote — ambos respetando el scope del usuario (Manager con scope [A] no ve B)
- [ ] **Lotes opt-in y FEFO**: un producto con `tracks_lots` exige lote y caducidad al entrar y **sale primero el que vence antes** (el ejemplo de Carlos: st30/st10/st60 → una venta baja st10 a 9); un producto sin `tracks_lots` nunca ve un lote; `Σ stock_lots == stock_by_warehouse` tras N movimientos aleatorios (test de propiedad); el conteo por planilla trae **una fila por lote y ubicación** y crea lotes nuevos; apagar `tracks_lots` con saldo en lote → 409; la vista "Próximos a vencer" lista y permite dar salida por caducado
- [ ] **Todo movimiento es un documento con folio**, en **tres** series por tenant: una entrada da `ENT-000001`, una salida `SAL-000001` y un conteo `INV-000001`; un traspaso es una `SAL` con motivo Traspaso y su recepción una `ENT` con el mismo motivo (**no** hay serie propia para ellos); las tres avanzan independientes, dos tenants arrancan las suyas en 1
- [ ] **Un movimiento a medio cargar se retoma por su folio**: se cargan 40 productos, se cierra el navegador (o lo agarra otro usuario en otra máquina), se busca `SAL-000019` en el listado de Salidas y se sigue donde quedó; el stock **no se movió** en el medio; el borrador abandonado queda **anulado con su folio** y la serie no pierde números
- [ ] **Lo confirmado es intocable**: un UPDATE sobre un documento `confirmed` falla en la base (trigger), confirmar dos veces el mismo borrador da 409 y **no duplica el saldo**, y un confirmado nunca vuelve a borrador
- [ ] **El borrador es la vista previa**: su detalle muestra **stock actual → stock resultante** por línea, los lotes que se crearían, el disponible y **de qué lote saldría por FEFO**, con los errores sobre su fila — todo sin escribir nada
- [ ] **PDF firmable**: cualquier documento se baja en PDF con el negocio, el folio, sus líneas y las firmas Entregó / Recibió / Autorizó; el de un borrador sale marcado **BORRADOR**; uno de 300 líneas sale paginado con el encabezado repetido; se encuentra después por folio en el listado de su serie y se vuelve a bajar
- [ ] `stock_movements` es append-only por privilegios (UPDATE/DELETE como `sellpoint_app` fallan) y las 7 tablas nuevas pasan los 4 canarios RLS
- [ ] **Propiedad de reconciliación**: tras N movimientos aleatorios, `stock_by_warehouse.quantity == Σentradas − Σsalidas` por (producto, almacén) (test de integración)
- [ ] Las guardas heredadas cerradas: presentación con movimientos no se borra, producto con movimientos no se borra ni cambia base_unit, almacén con stock o traspaso abierto no se desactiva, tenant con movimientos no cambia currency, `availability` respeta scope
- [ ] El alcance por almacén se asigna desde el form de usuario y `GET /warehouses?scoped=true` lo refleja en todos los selectores
- [ ] **Genericidad verificable:** `rg -i "pharmacy|farmacia|cafeteria|hardware|grocery|receta|ingredient|porci[oó]n|production" apps/api/src apps/api/prisma/schema.prisma apps/web/src packages/shared/src` sin resultados de dominio (se toleran solo comentarios que citan la LEY para explicar qué NO existe). Lote, caducidad y ubicación **sí** existen y son genéricos — lo que la LEY prohíbe son campos de rubro, no dimensiones del stock; y son opt-in por producto
- [ ] `REASONS_BY_DIRECTION` de shared, el enum Prisma y el CHECK SQL coinciden (test de contrato verde)
- [ ] Suites verdes (api unit+integration+e2e, web, shared) + tsc (`typecheck:full`) + Biome + deploy verde
- [ ] Tag `v0.4.0-fase3` creado

**Estimación: 5-6 semanas** (~131 h en 57 tareas). El outline original decía 2-3 semanas y no contaba kardex con saldo, stock por almacén, el conteo completo ni las guardas heredadas; después entraron los **lotes con FEFO** (2026-08-17, sobre un Excel real de cliente) y los **documentos con folio, borrador retomable y PDF** (2026-08-18). El alcance creció las tres veces por evidencia concreta, no por especulación. Nótese que la **re-atomización con borradores dejó MENOS tareas que la versión anterior** (57 contra 62) y casi las mismas horas: al volver el traspaso a ser una salida con motivo y el borrador a ser la previa, desaparecieron cuatro tareas de previa stateless y las de UI se concentraron en una maquinaria compartida. Corregir el modelo salió más barato que parchearlo.

---

## Fase 4 — POS PWA (outline)

> **Hereda de F3 (atomización del 2026-08-17):** el enum `reason_code` ya trae `sale` y `sale_return` reservados; la venta **NO escribe `stock_movements` propios** — llama a `StockLedgerService.apply(tx, …)` con `reason='sale'` (y `sale_return` para la anulación), que es quien bloquea, valida y proyecta a `stock_by_warehouse`. La anulación de un compuesto vendido revierte por `sale_return` (no `customer_return`, que queda para la devolución manual sin venta). El folio de venta sale de `nextFolio(tx, tenantId, 'sale', 'VTA')` sobre `tenant_sequences`. **FEFO viene gratis**: al vender un producto con `tracks_lots`, `apply` elige el lote que vence antes (F3-CORE-08) — el POS no diseña nada de lotes; solo muestra el lote descontado en el ticket si quiere. **`Idempotency-Key`** en el checkout es deuda anotada en F3 para acá (doble tap). Alcance por almacén: `assertWarehouseInScope` + `warehouseScopeWhere` de F3-CORE-03. `TenantTransactionsGate.hasTransactions()` debe sumar `sales` (`TODO(F4)` dejado en F3-GUARDS-04).

- **F4-DB** — Modelos `Sale`, `SaleItem` (con `product_id`, `presentation_id`, `quantity` DECIMAL, `unit_price`, `discount`), `CashboxSession`. **Reservar columnas nullable `Sale.clinical_document_id` y `Sale.quote_id`** para vincular ventas a documentos clínicos o cotizaciones cuando llegue Fase 9 (NO crear las tablas ahora, solo las FK nullable).
- **F4-API** — Endpoints venta, anulación, cierre. La anulación de una venta de producto compuesto **revierte el descuento de componentes** (entradas de reverso con `reason_code='sale_return'` vía el ledger de F3).
- **F4-UI** — Pantalla principal de venta optimizada para tablet.
- **F4-SCAN** — Integración escáner cámara (@zxing/browser). El barcode escaneado busca primero en `product_presentations.barcode` (si matchea, agrega esa presentación) y solo si no, en `products.barcode` (legacy).
- **F4-CART** — Carrito con búsqueda predictiva. **Diseñar el "input principal" del POS como extensible** con strategy pattern: `SkuLookup`, `BarcodeLookup`, `TextSearchLookup` — para que agregar `PrescriptionLookup` y `QuoteLookup` en Fase 9 sea trivial. **Selector de presentación al agregar producto:** si tiene N presentaciones vendibles, mostrar selector inline; la marcada `is_default_sale` viene pre-seleccionada.
- **F4-NUMPAD** — Numpad inteligente: oculta el botón `.` cuando la presentación elegida tiene `allow_fractional_input = false`. Maneja paste/keyboard: si recibe input con punto en presentación entera, trunca y muestra hint inline ("Solo enteros"). El backend revalida igualmente (defense in depth).
- **F4-COMPOSITE** — Lógica de venta de productos compuestos:
  - El compuesto se ve y suma al carrito como cualquier producto. Su stock visible es el calculado en vivo: `min(stock_componente_i / qty_i)`.
  - Al COBRAR, el sistema expande la composición de cada línea compuesta y genera N `stock_movements` de salida por componente en **transacción atómica**.
  - Si CUALQUIER componente no tiene stock suficiente → falla la venta entera con mensaje claro (qué componente falta, cuántas unidades son posibles).
  - El recibo muestra el producto compuesto, no sus componentes (el cliente compra el producto armado, no su despiece).
- **F4-CHECKOUT** — Modal de cobro (efectivo, tarjeta, transferencia).
- **F4-PRINT-DESKTOP** — Impresión via `window.print` + CSS @page.
- **F4-PRINT-BT** — Impresión Web Bluetooth (ESC/POS).
- **F4-CASHBOX** — Cierre de caja.
- **F4-PWA** — Service worker, offline básico, manifest completo.

**Estimación:** 3 semanas.

---

## Fase 5 — Reportes (outline)

> **Hereda de F3 (2026-08-17):** el **costo promedio ponderado** se difirió a esta fase (decisión de Carlos): F3 registra `unit_cost` en cada entrada `invoice` (costo por unidad de la presentación capturada); F5 lo lleva a base_unit con el `factor` de la presentación referenciada, calcula el promedio ponderado por producto (decidir si global o por almacén) y lo expone en el reporte de valorización y en `cost-estimate` de BOM (hoy `cost/factor`). También heredan de F3 el **reporte de stock en tránsito** completo con export (F3 dejó el endpoint chico `GET /inventory/in-transit`) y el **kardex detallado exportable** (F3 dejó `GET /products/:id/kardex` con `balanceAfter`). Si algún caso pide **backdating** de movimientos, se evalúa acá con `effective_at` separado de `created_at`.

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
- [x] **F6-TYPECHECK-TESTS** *(cerrada el 2026-08-17: 0 errores + `typecheck:full` en el job `checks`)* — Cerrar el hueco de tipos de los TESTS del API y engancharlo a CI. Hoy los `.spec.ts` no los verifica NADIE: `tsconfig.build.json` los excluye y `ts-jest` transpila sin chequear por `isolatedModules` en `tsconfig.base.json`. Se descubrió el 2026-08-16 con dos deploys en rojo seguidos (F2-CAT y el cierre de F2). Ya existe `pnpm typecheck:full` (`apps/api/tsconfig.typecheck.json`) que los incluye; **reporta 26 errores preexistentes en 9 archivos**, todos de Fase 1 y concentrados en autenticación (`auth.controller.spec` 8, `token.service.spec` 4, `auth-resolve-tenant-by-email` 4). Cuatro familias: 7 × `Object is possibly undefined` (accesos tipo `rows[0].campo` sin `?.`), 6 × `ConfigService` genérico sin parametrizar, 4 × mock de `Response` inferido como `never`, y **9 de mocks DESACTUALIZADOS** (`Expected 5 arguments, but got 4`) — este último grupo es el que importa: son tests que llaman a una firma que ya cambió, así que pasan en verde probando una forma que no existe. **Criterio de hecho: llegar a cero Y sumar `typecheck:full` al job `checks`** — sin lo segundo, arreglarlos hoy no impide que mañana entren otros. `apps/web` ya quedó cubierto (`pnpm typecheck` = `tsc -b`, el mismo gate que `pnpm build`).
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

> **Nota:** la cafetería (cliente **comprometido**) NO está en Fase 9 — productos compuestos + composición/BOM + stock decimal son **parte del core desde Fase 2** (ver [ARQUITECTURA.md § 3.5](ARQUITECTURA.md#35-modelo-de-productos-unidades-presentaciones-y-composición-bom)). El add-on F9-GASTRO-PRO de abajo es **gastronomía avanzada** (KDS, modificadores, control por turno) — NO el core.

### 9.0 Layouts por rubro (plantillas de campos sugeridas)

> **Diferido desde F2 por la LEY de genericidad (Carlos, 2026-08-16):** el motor de catálogos es agnóstico del rubro y **nada de negocio específico vive en la base de datos**. Los Layouts son azúcar sintáctica sobre ese motor: un catálogo de **sugerencias** que, si el tenant las acepta, se convierten en `catalog_fields` normales — indistinguibles de los que él hubiera creado a mano. Se construyen al final, cuando haya suficientes clientes reales para saber qué campos usa cada rubro de verdad en vez de inventarlos.

- **F9-LAYOUT-DEF** — Catálogo de layouts como **datos**, no como código de negocio: cada layout es una lista de campos sugeridos (etiqueta, tipo, requerido) versionada fuera del schema del producto. Ningún nombre de rubro entra en migraciones ni en constantes del API.
- **F9-LAYOUT-APPLY** — Endpoint que aplica un layout creando `catalog_fields` en el catálogo elegido, idempotente y sin pisar campos existentes. Aplicar es opcional y reversible (los campos se archivan como cualquier otro).
- **F9-LAYOUT-UI** — Galería de layouts con preview de los campos que agregaría, disponible desde el editor de campos y desde el wizard. `Tenant.templateChoice` (registrado desde F1) preselecciona la sugerencia.

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

---

*Documento de implementación de SellPoint. Trabajamos punto por punto. Cuando termines una tarea, marca el checkbox y agregá una línea a la Bitácora si hubo algo digno de recordar. Al terminar la Fase 1, atomizamos la Fase 2.*
