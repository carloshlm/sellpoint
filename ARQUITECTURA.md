# SellPoint — Arquitectura y Plan Maestro

> Sistema web multi-tenant de **Control de Inventario + Punto de Venta (POS)**, diseñado API-first y vertical-agnóstico (cada cliente define su propia estructura de catálogo).

---

## Tabla de Contenidos

1. [Visión del Producto](#1-visión-del-producto)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Modelo Multi-Tenant](#3-modelo-multi-tenant) — incluye scoping por almacén
4. [Estructura del Monorepo](#4-estructura-del-monorepo)
5. [Seguridad](#5-seguridad)
6. [Roadmap por Fases](#6-roadmap-por-fases)
7. [Internacionalización + Multi-Currency](#7-internacionalización--multi-currency)
8. [Variables de Entorno](#8-variables-de-entorno)
9. [Comandos de Inicio Rápido](#9-comandos-de-inicio-rápido)
10. [Glosario del Dominio](#10-glosario-del-dominio)

---

## 1. Visión del Producto

**SellPoint** es una plataforma SaaS **vertical-agnóstica** para **cualquier negocio que combine inventario en almacenes + venta de productos**. Ofrece a múltiples clientes (tenants) un sistema unificado para:

- Administrar catálogos de productos **con estructura definida por cada cliente** (farmacias, ferreterías, abarrotes, ópticas, papelerías, ferreterías, dietéticas, distribuidoras, etc.)
- Gestionar almacenes, movimientos de inventario y trazabilidad completa (kardex)
- Operar un punto de venta (POS) PWA con escaneo de códigos de barras e impresión térmica
- Generar reportes operativos y exportarlos a Excel
- Administrar usuarios, roles y permisos granulares

> **Diseño orientado a extensibilidad vertical:** el modelo base cubre el 80% de cualquier negocio (catálogo + almacén + movimientos + POS). Verticales especializados (consultorio médico, dental, óptica, taller mecánico, etc.) se agregan como **módulos sobre el core** — generan documentos propios (recetas, órdenes de servicio, hojas clínicas) cuyo **folio se referencia en el POS** para pre-cargar las líneas de la venta. Ver Fase 9 del roadmap.

### Principios de diseño

| Principio | Qué significa en la práctica |
|---|---|
| **API-first** | El backend expone una API REST documentada con OpenAPI. Web, mobile y posibles integraciones consumen la misma API. |
| **Multi-tenant by design** | Aislamiento de datos garantizado a nivel base de datos vía Row-Level Security (RLS). Imposible filtrar datos entre tenants. |
| **Vertical-agnóstico** | El catálogo de productos tiene campos fijos + atributos dinámicos por tenant. Nuevo vertical = nueva definición de schema, **sin tocar código**. |
| **Mobile-ready** | Monorepo con paquetes compartidos. Agregar `apps/mobile` no requiere refactor del backend ni duplicación de tipos. |
| **Seguridad por defecto** | OWASP Top 10 mitigado en cada capa. HTTPS obligatorio, secretos fuera del repo, audit log de movimientos críticos. |

### Funcionalidades base (extraídas de los requerimientos originales)

Tomadas de [ControlDeInventario.md](ControlDeInventario.md) y [PuntoDeVenta.md](PuntoDeVenta.md):

- **Catálogos:** Productos (con schema dinámico), Almacenes
- **Movimientos:** Entrada, Salida (ambas con motivo: factura, ajuste, traspaso, devolución, merma, etc.), Inventario físico. Los traspasos son un **proceso de 2 pasos con confirmación**: la salida deja stock "en tránsito" hasta que el almacén destino confirma la entrada. **Toda operación es un documento con folio y estado**: nace en **borrador** (`ENT`, `SAL`, `INV` — el traspaso es una salida con motivo, no una serie propia), se carga a mano o por Excel guardándose sola, **se retoma por su folio** si se cierra el sistema, muestra el stock resultante antes de confirmar, y al confirmarse se baja en PDF firmable.
- **POS:** Venta rápida, búsqueda predictiva, escaneo de cámara, impresión ESC/POS
- **Reportes:** Stock por almacén (valorizado, con detalle por lote y ubicación), Ventas por período, Kardex, Catálogo, Usuarios, Almacenes, Vencimientos y Stock en tránsito
- **Sistema:** Usuarios, Roles, Permisos granulares por módulo

---

## 2. Stack Tecnológico

> **Revisado contra el código el 2026-09-26.** Las versiones son las mayores de cada `package.json` y la infraestructura es la que corre en Vultr. El diseño original suponía AWS (EC2, S3 con KMS, SES, CloudWatch, Parameter Store); se descartó antes de tener clientes y la EC2 previa se dio de baja al elegir Vultr (2026-08-04). Donde este documento y el código difieran, manda el código; las medidas de seguridad, con su fuente, están en [`SEGURIDAD.md`](./SEGURIDAD.md).

### 2.1 Backend (`apps/api`)

| Decisión | Elección | Justificación |
|---|---|---|
| Framework | **NestJS 11** | Modular, DI nativa, decoradores, guards/interceptors. Estándar de la industria para APIs Node.js de tamaño medio/grande. |
| Lenguaje | **TypeScript** | Type safety en todo el stack. Tipos y reglas compartidos con el web y el sitio vía `packages/shared`. |
| ORM | **Prisma 7** | Type-safe, soporte de JSONB en Postgres y migraciones versionadas. Lo que Prisma no modela —RLS, triggers, funciones como `purge_tenant`— va en SQL dentro de las mismas migraciones. |
| Base de datos | **PostgreSQL 16** | JSONB + GIN indexes para atributos dinámicos. Row-Level Security nativo. Soporte transaccional ACID. |
| Validación | **Zod 4** (`ZodValidationPipe`) + **validador derivado** | Zod para DTOs estáticos. Los atributos dinámicos se validan con la función pura derivada de `catalog_fields` — sin Ajv (ver § 3.3, 2026-08-16). |
| Auth | **JWT (access) + Refresh rotativo** | Access en memoria, refresh en cookie `httpOnly + Secure + SameSite=Strict`. RS256 (par de claves). Diseño en § 5.2. |
| Hash | **Argon2id** | Más resistente que bcrypt a ataques GPU/ASIC. Los parámetros están en SEGURIDAD §2.2. |
| Rate limit | **@nestjs/throttler + Redis** | Por IP en toda la API y en las rutas de acceso, y por correo al entrar y al recuperar la contraseña. Los valores, en SEGURIDAD §2.2. |
| Cache / Cola | **Redis 7** (ioredis) | Hoy: límites de intentos, épocas de revocación de sesiones y cachés (entitlements del plan). La cola de jobs (importación, reportes pesados) quedó **diferida** al construir F5: la importación es síncrona fila-por-fila y la exportación es síncrona con tope — sin un caso real que la exija, montar workers sería código de fe (mismo criterio que F4-PRINT-BT). |
| Correo | **Resend** detrás de `MailerPort` | `MAIL_DRIVER=resend` en producción (la API no arranca con otro); `console` en desarrollo. Sale de `sellpointy.com` con SPF y DKIM. |
| Docs | **Swagger (OpenAPI)** | Auto-generada desde decoradores, solo en desarrollo y pruebas: en producción no se monta (F10-SEC-02). `packages/api-client` iba a generarse desde aquí y sigue siendo un placeholder. |
| Logs | **Pino** (`nestjs-pino`) | JSON estructurado a stdout, con redacción de cabeceras de autorización, cookies y contraseñas. |
| Errores | **Sentry** (`@sentry/node`) | Solo errores: los 5xx de la API (`AllExceptionsFilter`). |

### 2.2 Frontend Web (`apps/web`)

| Decisión | Elección | Justificación |
|---|---|---|
| Build | **Vite 8** | HMR instantáneo, build optimizado con Rollup. |
| UI | **React 19 + TypeScript** | Concurrent features (transitions, Suspense), ecosistema robusto. |
| Routing | **TanStack Router** | Type-safe routing, code-splitting nativo, loaders integrados con TanStack Query. |
| Server state | **TanStack Query v5** | Cache automático, retries, optimistic updates, invalidation. Indispensable para POS en tiempo real. |
| Client state | **Zustand** | ~1kb, sin boilerplate. Hoy guarda la sesión (el access token, solo en memoria), el carrito del POS, el modal de planes y el borrador de la carga rápida de catálogo, el único que persiste en `localStorage` para no perder lo escaneado. |
| Forms | **React Hook Form + Zod** | Performance, validación compartida con backend (mismo Zod schema en `packages/shared`). |
| UI Kit | **Tailwind CSS 4 + shadcn/ui** | Componentes copiados al proyecto (no dep npm), accesibles (Radix UI), customizables. |
| Tablas | **TanStack Table v9** | Headless, paginación server-side, filtros, ordenamiento. |
| PWA | **service worker a mano** (`public/sw.js`) | Manifest + cascarón cacheado. Se descartó `vite-plugin-pwa` al construir (F4-PWA-01): precachear la lista del build hace falta para servir TODO offline, y acá solo hace falta que la app ABRA — a cambio, el worker se lee entero en dos minutos y no hay que mantenerlo al día con el bundler. |
| Escáner | **@zxing/browser** | Códigos de barras vía cámara. Compatible con la mayoría de formatos (EAN, UPC, Code128). |
| Impresión | **pdfmake 0.2.x** → `window.open(blob)` | El ticket es un PDF que arma el SERVIDOR con su tamaño de papel (58/80 mm) y el navegador abre para imprimir. Se descartó el CSS `@page` al construir (F4-TICKET-02): obligaba a mantener dos plantillas del mismo ticket. `escpos-buffer` + Web Bluetooth siguen sin usarse — F4-PRINT-BT diferida. |
| HTTP | **Axios** + interceptors | Refresh token automático con single-flight (§ 5.7), manejo de errores centralizado. |
| Errores | **Sentry** (`@sentry/react`) | Solo errores, y solo desde `app.sellpointy.com`. |

### 2.3 Tooling

| Herramienta | Para qué |
|---|---|
| **Turborepo** | Cache de builds/tests, ejecución paralela, grafo de dependencias. |
| **pnpm workspaces** | Manejo eficiente de dependencias, dedupe automático. |
| **Biome** | Lint + format de todo el repo con un solo binario (`pnpm lint` = `biome check .`). |
| **Husky + lint-staged + commitlint** | Pre-commit: `biome check` sobre lo que se va a commitear. Commit-msg: commitlint (Conventional Commits; asunto de 100 caracteres como máximo y en minúscula). Los tipos y las pruebas corren en el CI, no en el commit. |
| **Vitest** | Pruebas de `web`, `packages/shared`, `site` y `manual`. |
| **Jest + Supertest** | Pruebas del API: unitarias, de integración contra el RLS real conectadas como `sellpoint_app`, y e2e (`pnpm --filter api test:e2e`). |
| **Playwright** | No hay E2E de navegador en el CI: lo usa `apps/manual` para levantar un SellPointy aparte y tomar las capturas del manual de usuario. |
| **commit-and-tag-version** | Versión y `CHANGELOG.md` (`pnpm release`, F6-RELEASE). |

### 2.4 Infraestructura

| Componente | Stack |
|---|---|
| Servidor | **VPS Vultr High Frequency 2GB, Ciudad de México** (Ubuntu LTS; decidido 2026-08-04 tras descartar Hetzner post-suba de precios; la EC2 del diseño original se dio de baja). En el mismo servidor corren producción (`app.sellpointy.com`), el sandbox (`sandbox.sellpointy.com`), el sitio público y sitios informativos de otros dominios (PHP-FPM). |
| Orquestación | **Docker Compose**. Producción (`docker-compose.prod.yml`): `nginx-edge`, `web`, `api`, `postgres`, `redis`, `migrate` (corre las migraciones y termina), `certbot` y `php-fpm`; el sandbox tiene su propio compose. En local, `docker-compose.dev.yml` levanta solo Postgres y Redis. |
| Proxy reverso | **nginx** (`nginx-edge`), el único servicio con puertos publicados (80/443), con **Let's Encrypt** (certbot; renovación por cron y aviso por correo antes de que venza un certificado). HTTPS es obligatorio también para la cámara del escáner. |
| DNS | **Cloudflare**, en gris: sin proxy ni WAF (pospuesto hasta tener más clientes). |
| Imágenes | **GHCR** (privado, gratis con el repo): `sellpoint-api`, `sellpoint-web` y `sellpoint-migrate`, con retención automática (`ghcr-retention.yml`). |
| CI/CD | **GitHub Actions**, un solo pipeline (`deploy.yml`) en cada push a `main`: pruebas (`checks.yml`: lint, tipos, unitarias, integración contra RLS real, e2e y build) → imágenes a GHCR → sandbox (migración y prueba de humo) → producción (prueba de humo, y se revierte sola si falla). Los PR corren `ci.yml`; el sitio, su propio `site.yml` (§ 2.5). Trivy revisa la imagen del API en modo informativo. |
| Respaldos | `backup-postgres.sh` por cron cada noche: `pg_dump` y los `.env`, cifrados con **age** antes de salir del servidor, a **Cloudflare R2**, con 14 días de historia. Restauración ensayada (F6-DRILL-01). Detalle en SEGURIDAD §3. |
| Logs | **Pino** a stdout; Docker los rota (10 MB × 3 por servicio) y se leen por SSH. Centralizarlos quedó pospuesto por tamaño (Fase 6). |
| Errores | **Sentry**, solo errores, en el API y en el navegador (F6-WATCH-02). |
| Disponibilidad | **UptimeRobot**: dos monitores HTTP a `/api/health` de producción y del sandbox, cada 5 min, con aviso por correo (F6-WATCH-01). |
| Secretos | `/opt/sellpoint/.env` en el servidor (permisos 600, dueño `deploy`), generado ahí y nunca en git; las llaves del JWT se generan en el servidor y entran como `*_BASE64`. Su copia viaja cifrada en el respaldo nocturno. Un gestor de secretos quedó pospuesto por tamaño (F6-SECRETS-01, versión ligera). |

### 2.5 El sitio público (`apps/site`) — el tercer despliegue

> F11-SITE (2026-09-19). La guía de trabajo está en [`SITIO-WEB.md`](SITIO-WEB.md); la del servidor, en [`infrastructure/nginx/SITIO-PUBLICO.md`](infrastructure/nginx/SITIO-PUBLICO.md).

La aplicación es una SPA detrás de un login: Google la ve vacía y carga 1 MB de JavaScript antes de pintar. Una página de producto vive de que la encuentren y de abrir en un segundo en un celular con mala señal. Por eso el sitio es **otra cosa, desplegada aparte**:

| | API | Web | **Sitio** |
|---|---|---|---|
| Qué es | NestJS | SPA de React | **HTML estático (Astro), ~6 KB de JS** |
| Cómo corre | Contenedor | Contenedor (nginx) | **Archivos en `/opt/sites/<dominio>/`**, servidos por el `nginx-edge` que ya existe — sin contenedor nuevo |
| Pipeline | `deploy.yml` (~18 min, sandbox → producción) | el mismo | **`site.yml`** (minutos; ensayo → producción). Un cambio solo del sitio NO dispara el de la aplicación |
| Volver atrás | Reescribir `IMAGE_TAG` | el mismo | Mover un enlace (`site-deploy-remote.sh --rollback`) |

Decisiones que lo sostienen:

- **Una URL por mercado e idioma** (`/es-mx/`, `/en-us/`, `/es-us/`, `/en-ca/`, `/fr-ca/`), generadas desde una matriz tipada. La raíz sirve la versión de México. El país se SUGIERE (zona horaria e idioma del navegador, sin IP) y nunca se impone.
- **Sin terceros y sin cookies.** Fuentes propias; el formulario de interés y la medición son endpoints del API (`/public/leads`, `/public/site-events`), sin IP ni identificador de visitante — por eso no hay aviso de consentimiento.
- **Mismo origen, a propósito.** El sitio llama a `/api/public/…` en SU dominio y su vhost reenvía SOLO ese prefijo al API; cualquier otro `/api/*` da 404. El apex NO está en `CORS_ORIGINS`: apex y `app.` son el mismo «site» para el navegador, y listarlo le daría al sitio de marketing permiso de hablarle a `/auth/*` con cookies.
- **Las tablas del sitio no llevan `tenant_id`** (`site_leads`, `site_events`): un prospecto todavía no es un negocio, y `purge_tenant` borra de toda tabla que tenga esa columna.
- **Qué incluye cada plan vive en `packages/shared`** (`plan-showcase.ts`): lo leen la vitrina de la aplicación y el sitio, y una prueba de integración del API lo amarra a la tabla `plans`.
- **Lo que publica tiene interruptor.** Producción sirve la página «en construcción» hasta que `SITE_PUBLISH_FULL` esté prendida Y los textos legales no tengan huecos; los precios van apagados por mercado (`showPrices`) y apagados no viajan en el HTML; la aceptación de términos en la aplicación duerme tras `CURRENT_TERMS_VERSION = null`.

---

## 3. Modelo Multi-Tenant

### 3.1 Estrategia: tenant_id + Row-Level Security (RLS)

Decisión: **schema único compartido con columna `tenant_id` en cada tabla** + **RLS de PostgreSQL** activado.

**Por qué no schema-per-tenant o database-per-tenant:**
- Schema-per-tenant: migraciones se vuelven pesadillas a partir de ~50 tenants.
- DB-per-tenant: máximo aislamiento pero costo operativo prohibitivo en early-stage.
- **tenant_id + RLS** = mejor balance entre aislamiento, costo y simplicidad operacional.

### 3.2 Cómo funciona el aislamiento

```sql
-- Cada tabla con datos por tenant
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sku TEXT NOT NULL,
  -- ... más campos
);

-- Activar RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Política: solo se ve lo del tenant actual
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**En NestJS:** un middleware lee el `tenant_id` del JWT y setea la variable de sesión Postgres en cada request:

```typescript
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = req.user?.tenantId;
    if (tenantId) {
      await this.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    }
    next();
  }
}
```

**Resultado:** aunque un developer escriba `SELECT * FROM products` sin filtro, Postgres devuelve solo los del tenant del request. **Imposible filtrar datos.**

### 3.3 Motor de catálogos dinámicos

> **Evolución del diseño (2026-08-16, atomización de F2, pedido de Carlos):** el diseño
> original de esta sección era "UN schema de productos por tenant, expresado como JSON
> Schema draft-07 y validado con Ajv". Se generalizó a un **motor de catálogos**: el
> tenant define N catálogos (el de Productos es el principal, obligatorio y del sistema)
> con campos personalizados tipados, incluido el tipo **lookup** entre catálogos — que el
> JSON Schema no podía expresar. El JSONB se queda como *storage* de los valores; el JSON
> Schema como *contrato* muere (los campos como filas son la fuente de verdad) y **Ajv ya
> no se usa**. Historial completo en engram: `topic_key: sellpoint/f2-atomizacion`.

Cada tenant define **qué campos tiene su Catálogo de Productos** y puede crear
**subcatálogos** propios (ej. "Unidad de Medida": código `kg` → "kilogramos") ligados por
campos lookup.

> **LEY DE GENERICIDAD (Carlos, 2026-08-16).** El motor es **agnóstico del rubro**. Ni el
> schema, ni las migraciones, ni el código del API nombran un giro de negocio. Que un
> tenant llame a un campo "Sustancia Activa" o "Tipo de Tueste" es **dato que él carga**,
> nunca algo que SellPoint traiga definido — esos nombres son filas de `catalog_fields`,
> indistinguibles entre sí para el sistema. Las plantillas de campos por rubro (Layouts)
> son una funcionalidad **posterior y opcional** que se limita a *sugerir* campos que el
> tenant acepta o no (Fase 9.0); no existen en el core.

#### Tablas del motor

```
catalogs           id, tenant_id, name, system_key NULL, is_system, is_active, timestamps
                   UNIQUE(tenant_id, name)
                   El Catálogo de Productos: system_key='products', is_system=true —
                   se crea en TenantsService.provision(), no se borra ni renombra.
                   Desde el 2026-08-26 nacen también 'warehouses' y 'services', y desde
                   el 2026-09-12 (F9-SUPPCAT) 'suppliers': CUATRO catálogos de sistema,
                   uno por tabla de primera clase con JSONB propio
                   (SYSTEM_ATTRIBUTE_TABLES en catalogs/system-catalogs.ts, lista
                   cerrada porque se interpola en SQL crudo). Los tenants viejos los
                   reciben por migración de backfill (WHERE NOT EXISTS).

catalog_fields     id, tenant_id, catalog_id, key, label,
                   field_type ENUM('text','number','lookup'), lookup_catalog_id NULL,
                   required, position, is_archived, timestamps
                   UNIQUE(catalog_id, key)
                   CHECK: field_type='lookup' ⇔ lookup_catalog_id IS NOT NULL

catalog_records    id, tenant_id, catalog_id, code, attributes JSONB, is_active, timestamps
                   UNIQUE(catalog_id, code) · GIN(attributes)
                   ← SOLO filas de subcatálogos. Los productos NO viven acá.
```

**LEY del código (F9-SUPPCAT, 2026-09-12):** todo código que escribe una persona
(`products.sku`, `services.code`, `warehouses.code`, `suppliers.code`,
`catalog_records.code`, el de los estudios) se guarda en **MAYÚSCULAS**. Sus índices
únicos distinguen mayúsculas, así que `abc` y `ABC` serían dos registros y una
planilla con `abc` duplicaría a `ABC`. La regla vive en `shared/code.ts#normalizeCode`
(recorta, colapsa espacios y sube; NO translitera ni filtra —a diferencia del lote—
porque el negocio elige su vocabulario), entra por el borde del API (`.transform`
en cada DTO, barrera `catalogs/code-contract.spec.ts`) y se repite en cada input
del web (barrera `components/form/code-input.test.tsx`). Los datos que existían
subieron una vez por migración (`20260923100000_f9_suppcat_codes_uppercase`):
una colisión deja el sufijo `-2` en la fila más nueva y un renglón en `audit_logs`.
`expense_categories.code` queda fuera: es snake_case interno y ya no se muestra.

#### Productos: tabla de primera clase que USA el motor

`products` sigue siendo una tabla propia (sku, name, base_unit, is_composite, stock_min,
`attributes JSONB + GIN`, `UNIQUE(tenant_id, sku)`) porque F3/F4/F5 le cuelgan FKs duras
(presentaciones, composición, stock, ventas) y columnas tipadas consultables. Lo que comparte
con los subcatálogos es el **motor**: sus campos personalizados son `catalog_fields` del
catálogo `products`, sus valores van al mismo `attributes JSONB`, y los valida el mismo
validador. El precio y el costo NO son columnas de `products`: viven en
`product_presentations` (ver § 3.5) — el form de producto los captura y crea la
presentación base «Unidad ×1».

#### Campos estándar y campo Código

Todo catálogo tiene campos estándar **no eliminables** que la UI muestra fijos: **Código
(Nombre Corto)** — único dentro del catálogo, definido por el cliente (`kg`, `PAR-500`) —
y los del dominio (en productos: nombre, precio, costo, unidad base, stock mínimo). En
`products` el Código es la columna `sku`; en subcatálogos, la columna `code`.

#### Lookup: integridad a nivel servicio

Un campo lookup guarda en `attributes` el **id** del registro destino (estable ante
renombres de código) y se muestra por código + display. Reglas:

- Al escribir: el registro destino debe existir, estar activo y pertenecer al catálogo
  declarado en `lookup_catalog_id`.
- Al archivar un registro referenciado por lookups de otros registros o productos → 409
  con la referencia (query GIN inversa: `attributes @> {"<key>": "<id>"}`).

#### Edición de campos: simple con guardas (sin versionado)

Decisión de Carlos (2026-08-16): en lugar del versionado v1/v2 con flujos de migración,
el editor es directo con tres guardas:

1. **Archivar un campo con datos** exige confirmación explícita; los valores **no se
   borran** (`is_archived` — el campo desaparece de forms y tablas, restaurable).
2. **Cambiar el tipo de un campo con datos** se bloquea (409).
3. Los campos estándar no se tocan.

#### Validación en runtime: derivada de los campos, sin Ajv

```typescript
// Función PURA — testeable sin DB. Los campos son la fuente de verdad;
// no hay JSON Schema intermedio que compilar.
validateRecordAttributes(fields: CatalogField[], attributes: unknown): FieldError[]
// reglas: required · text=string · number=finito · lookup=uuid existente
// campos archivados se ignoran · claves desconocidas se rechazan
// errores por campo con claves i18n (el backend traduce por Accept-Language)
```

#### Frontend dinámico

`<DynamicForm fields={fields} />` renderiza los campos del catálogo (TextField, campo
numérico, picker de lookup alimentado por `GET /catalogs/:id/records?query=`). El mismo
componente sirve al form de productos, al alta de registros de subcatálogos y al preview
del editor de schema.

### 3.4 Alcance de usuarios por almacén (multi-sucursal)

> **Vocabulario — «almacén» en el código, «sucursal» en pantalla (2026-09-19).** Carlos habló con clientes de México y Canadá y «Almacén / Warehouse» les sonaba a la bodega de atrás, no al lugar donde venden. Desde ese día lo que LEE una persona dice **Sucursal / Store / Succursale**; lo que lee una máquina NO cambió: la tabla `warehouses`, `warehouse_id`, las rutas `/warehouses`, el permiso `warehouses:manage`, las claves de i18n y la serie de códigos `ALM-001` siguen igual. En este documento, en `CASOS_DE_USO.md`, `FLUJOS.md` y `VISTAS.md`, **«almacén» es el nombre del MODELO**: léelo como «sucursal» cuando hable de una pantalla. Se descartaron «Branch» (suena a banco) y «Location» (choca con «Ubicación», que ya es el lugar DENTRO de la sucursal). Los encabezados de las plantillas de Excel cambiaron también, y **las plantillas viejas dejaron de aceptarse** (decisión de Carlos: sin alias). Los datos ya capturados —un «Almacén Central»— no se tocaron; los negocios nuevos nacen con «Sucursal Principal».

> **Asignación vs. alcance (F3-HOME, 2026-08-19).** Son dos cosas distintas y conviene no confundirlas:
>
> | | Qué responde | Forma | Dónde vive |
> |---|---|---|---|
> | **Alcance** | ¿Dónde **puede** operar? | Una lista (vacía = todos) | `user_warehouse_scopes` |
> | **Asignación** | ¿Desde dónde opera **por defecto**? | Uno solo (nullable) | `users.default_warehouse_id` |
>
> La asignación nació porque el POS de F4 **no puede vender desde una lista**: necesita un almacén concreto para descontar stock. La cadena queda `usuario.asignado → turno de caja → venta → ledger`. Reglas: el asignado tiene que estar **dentro** del alcance cuando el alcance no está vacío (409 si no), y encoger el alcance por debajo del asignado da 409 **explícito** en vez de limpiarlo solo — en F4 el turno depende de él y limpiarlo en silencio dejaría a un vendedor varado a mitad de turno.
>
> **No se creó una entidad «Sucursal»**: el modelo sigue plano `tenant → almacén`. Una Branch no habría respondido la pregunta del POS, la habría delegado (necesitaría su propio almacén por defecto), y el nombre lo pone cada negocio en cada almacén — «Sucursal Centro», «Bodega», «CEDIS».


Para soportar **cadenas con múltiples sucursales** sin sacrificar la simplicidad del caso single-store, el sistema agrega una capa de **scoping** sobre el RBAC. Esto separa dos preguntas:

- **Roles + permisos** → ¿QUÉ puede hacer el usuario?
- **Alcance por almacén** → ¿DÓNDE puede hacerlo?

#### Tabla `user_warehouse_scopes`

```sql
CREATE TABLE user_warehouse_scopes (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  PRIMARY KEY (user_id, warehouse_id)
);

ALTER TABLE user_warehouse_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_warehouse_scopes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

#### Reglas de comportamiento

| Caso | Comportamiento |
|---|---|
| `TenantAdmin` (cualquier configuración) | **Bypasea el scoping siempre.** Ve y opera todos los almacenes del tenant. |
| Otro rol **sin filas** en `user_warehouse_scopes` | Ve todos los almacenes (default permisivo — sirve para tenants chicos). |
| Otro rol **con filas** en `user_warehouse_scopes` | Ve **solo** los almacenes asignados. El resto es invisible. |

#### Implementación

- Middleware Nest carga los `warehouse_ids` accesibles en el contexto del request.
- Decorator `@CurrentUserScope()` los expone al controller/service.
- Repositorios de productos (stock), inventario, POS y reportes aplican el filtro automáticamente.
- TenantAdmin tiene un short-circuit en el guard que omite el filtro.

#### Configuraciones típicas

| Tipo de negocio | Setup de usuarios | Resultado |
|---|---|---|
| Farmacia única, 1 dueño | 1 TenantAdmin, sin scope | Ve y opera todo. Cero fricción. |
| Farmacia única, 1 dueño + 2 empleados | 1 TenantAdmin + 2 POS_Seller (sin scope) | Todos operan el único almacén. |
| Cadena, 5 sucursales | 1 TenantAdmin (sin scope) + 5 Manager (1 almacén cada uno) + N POS_Seller por sucursal | CEO ve toda la cadena; cada gerente solo su sucursal. |
| Gerente regional | 1 Manager con scope `[Centro, Sur, Coyoacán]` | Opera 3 almacenes. |
| Auditor externo | 1 Viewer sin scope | Lee toda la cadena (read-only). |

**Por qué funciona desde el día uno:** para un tenant pequeño la tabla queda vacía, así que **no hay impacto operativo ni cognitivo**. Cuando el negocio crece a multi-sucursal, asignar scopes desde Sistema → Usuarios es suficiente: **no requiere refactor del código**.

### 3.5 Modelo de Productos: Unidades, Presentaciones y Composición (BOM)

> Este modelo es **parte del core** desde Fase 2. Cubre desde productos simples (caja de pastillas vendida entera) hasta productos a granel (café molido por gramo) y productos compuestos (un lente armado = armazón + cristales; un kit de herramientas; un café = café + leche + azúcar).
>
> **Confirmado en la atomización de F2 (Carlos, 2026-08-16): precio y costo viven ÚNICAMENTE acá**, en `product_presentations` — nunca como columnas de `products` (el `price` que § 3.3 tenía a nivel producto en el diseño original murió con la generalización). Para que se llenen desde la misma interfaz del catálogo, el form de producto captura precio/costo y crea automáticamente la presentación base **«Unidad ×1»** (factor 1, venta por defecto); editarlos después edita esa presentación. La lista de productos muestra el precio de la presentación default. Una sola fuente de verdad: el POS de F4 lee de acá.

#### Concepto clave

Cada producto tiene **una unidad base** en la que se mide internamente su stock. La unidad base es invariable: el stock SIEMPRE se guarda en esa unidad, sin importar cómo se compra o vende.

- "Leche Lala" → `base_unit = 'ml'` → stock interno en mililitros (decimal)
- "Pastilla Paracetamol" → `base_unit = 'unit'` → stock interno en unidades enteras
- "Café molido premium" → `base_unit = 'gr'` → stock interno en gramos
- "Cable eléctrico 12 AWG" → `base_unit = 'm'` → stock interno en metros

Sobre esa unidad base, el producto tiene **N presentaciones** que definen cómo se compra (al proveedor) y cómo se vende (al cliente). Cada presentación tiene un **factor de conversión** a la unidad base.

#### Modelo de datos

```sql
-- Catálogo de unidades de medida (global, no por tenant)
CREATE TABLE units (
  code        VARCHAR(8) PRIMARY KEY,    -- 'unit', 'ml', 'l', 'gr', 'kg', 'm', 'cm', 'oz', 'lb'
  name_es     VARCHAR(32) NOT NULL,
  name_en     VARCHAR(32) NOT NULL,
  category    VARCHAR(16) NOT NULL,      -- 'count' | 'volume' | 'weight' | 'length'
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Producto base
ALTER TABLE products
  ADD COLUMN base_unit    VARCHAR(8)  NOT NULL DEFAULT 'unit' REFERENCES units(code),
  ADD COLUMN is_composite BOOLEAN     NOT NULL DEFAULT FALSE;  -- flag denormalizado para queries rápidas

-- Presentaciones: cómo se compra/vende cada producto
CREATE TABLE product_presentations (
  id                     UUID PRIMARY KEY,
  tenant_id              UUID NOT NULL,
  product_id             UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                   VARCHAR(64) NOT NULL,           -- "Caja 1L", "Vaso 200ml", "Granel"
  factor                 DECIMAL(14,4) NOT NULL,         -- equivalente en base_unit
  is_purchasable         BOOLEAN NOT NULL DEFAULT TRUE,  -- aparece en Entrada (compras)
  is_sellable            BOOLEAN NOT NULL DEFAULT TRUE,  -- aparece en POS
  is_default_sale        BOOLEAN NOT NULL DEFAULT FALSE, -- presentación pre-seleccionada al vender
  allow_fractional_input BOOLEAN NOT NULL,               -- ¿permite cantidades decimales en compra/venta?
                                                         -- Default automático según units.category:
                                                         --   count → false (pastillas, cajas, blisters)
                                                         --   volume/weight/length → true (líquidos, granel, telas)
                                                         -- TenantAdmin puede override
  barcode                VARCHAR(64) NULL,               -- código de barras de esta presentación
  price                  DECIMAL(14,2) NULL,             -- precio de venta
  cost                   DECIMAL(14,2) NULL,             -- costo (último o promedio)
  UNIQUE (product_id, name),
  UNIQUE (barcode) WHERE barcode IS NOT NULL
);

-- Composición (BOM) — vocabulario NEUTRO: "componente", nunca "ingrediente"
-- (LEY de genericidad, 2026-08-16: el motor sirve a una óptica que arma un
-- lente, a una ferretería que arma un kit y a una cafetería que prepara un café)
CREATE TABLE product_compositions (
  id                   UUID PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  parent_product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES products(id),
  quantity             DECIMAL(14,4) NOT NULL,    -- en base_unit del componente
  waste_percentage     DECIMAL(5,2) NOT NULL DEFAULT 0,  -- merma de armado (0-100)
  notes                TEXT NULL,
  UNIQUE (parent_product_id, component_product_id),
  CHECK (parent_product_id != component_product_id)
);

-- Stock: DECIMAL en lugar de INTEGER para soportar fracciones
ALTER TABLE stock_movements   ALTER COLUMN quantity TYPE DECIMAL(14,4);
ALTER TABLE stock_by_warehouse ALTER COLUMN quantity TYPE DECIMAL(14,4);
```

#### Reglas operativas

| Tipo de producto | Stock | Reposición | Venta |
|---|---|---|---|
| **Simple no-compuesto** (`is_composite=false`) | Persistido en `stock_by_warehouse` en `base_unit` | Entrada con presentación de compra (sistema convierte a base_unit) | POS con presentación de venta (sistema convierte) |
| **Compuesto** (`is_composite=true`) | **NO se persiste.** Se **calcula** en vivo: `min(stock_componente_i / qty_requerida_i)` para cada componente | NO se "compra" — se arma automáticamente al venderse | POS expande la composición y descuenta los componentes en transacción atómica |

#### Conversiones entre unidades

- **Dentro de la misma categoría** (ej: `l → ml`, `kg → gr`): conversión automática. El sistema sabe que `1 l = 1000 ml`.
- **Entre categorías** (ej: `ml → gr` para café): **NO se hace.** Depende de la densidad y eso es responsabilidad del usuario al definir presentaciones.

> Si un negocio compra café molido en bolsa de 250 gr y arma productos que usan 18 gr cada uno, ambos están en `gr` → cero conversión necesaria. Simple.

#### Validaciones críticas

1. **Recursión en BOM**: un compuesto no puede ser componente de sí mismo (directo o indirecto vía grafo). Se valida con DFS al guardar.
2. **Cambio de `base_unit`**: bloqueado si el producto tiene stock > 0 o es componente de otro producto. Sería ambiguo cambiarla.
3. **Borrado de producto**: bloqueado si es componente de otro (FK + mensaje claro).
4. **Stock negativo**: bloqueado en cualquier movimiento que lo cause. En productos compuestos, falla la venta si CUALQUIER componente no tiene stock suficiente.
5. **Fracciones según presentación**: si `presentation.allow_fractional_input = false`, el backend rechaza cualquier `quantity` con parte decimal (`quantity % 1 !== 0`). El frontend (POS y movimientos) **oculta el botón `.` del numpad** para esa presentación → cero posibilidad de error de captura. Aplica a:
   - Productos con `base_unit` de categoría `count` (pastillas, cajas, blisters) → siempre solo enteros.
   - Productos con `base_unit` continua pero presentación cerrada (ej: "Botella 500ml" o "Paquete cerrado 250gr" donde solo se vende íntegra) → TenantAdmin marca `allow_fractional_input = false` al definir la presentación.
6. **Decimales en stock interno**: independiente de la validación de input, el stock en base_unit se persiste con `DECIMAL(14,4)` siempre (precisión acumulada). Solo se valida fracción en la **cantidad ingresada** por el usuario en función de la presentación elegida.
7. **Decimales en recibo / POS**: redondeo bancario al formatear el recibo con `Intl.NumberFormat` y la `currency` del tenant.

#### Resumen de la regla "decimales sí / decimales no"

| Producto | Presentación elegida | ¿Permite decimal en input? |
|---|---|---|
| Paracetamol (`base_unit=unit`) | "Caja 30 tab" | ❌ NO (categoría count) |
| Paracetamol (`base_unit=unit`) | "Tableta" | ❌ NO (categoría count) |
| Jarabe ibuprofeno (`base_unit=ml`) | "Frasco 120ml" | ❌ NO (override manual: solo frascos enteros) |
| Jarabe ibuprofeno (`base_unit=ml`) | "Por ml (preparación)" | ✅ SÍ (volume + sin override) |
| Café molido (`base_unit=gr`) | "Granel por gr" | ✅ SÍ (weight) |
| Café molido (`base_unit=gr`) | "Paquete cerrado 250gr" | ❌ NO (override manual) |
| Cable eléctrico (`base_unit=m`) | "Metro" | ✅ SÍ (length — vendés 2.5 m) |
| Cable eléctrico (`base_unit=m`) | "Rollo 100m" | ❌ NO (override manual: rollo entero) |

#### UX: filosofía de la UI

El TenantAdmin gestiona presentaciones y composición con la **mínima fricción posible**:
- **Presentaciones**: tabla inline en el form de Producto. Una fila por presentación. Botón "+ Agregar presentación".
- **Composición**: tab "Composición" visible solo si `is_composite=true`. Tabla con `Componente | Cantidad | Unidad | ✕`. Picker de productos con autocompletado. Costo y unidades armables estimados en vivo.
- **No hay wizards, ni pasos múltiples, ni drag-and-drop.** Solo tablas editables inline.

---

## 4. Estructura del Monorepo

> Revisada el 2026-09-26. Muestra las carpetas que explican la arquitectura, no cada archivo.

```
sellpoint/
├── apps/
│   ├── api/                          # NestJS — API REST
│   │   ├── src/
│   │   │   ├── modules/              # un módulo por dominio:
│   │   │   │                         #   auth, tenants, users, roles, permissions
│   │   │   │                         #   catalogs, products, services, warehouses, suppliers
│   │   │   │                         #   inventory, cost, pos, purchases, purchase-orders, expenses
│   │   │   │                         #   reports, audit, billing, admin (backoffice), legal, mail, site
│   │   │   │                         #   reception y medical-clinic (módulos verticales)
│   │   │   ├── common/               # pipes (zod), filters, http (CORS, límites, UUID, docs)
│   │   │   ├── infrastructure/       # prisma (withTenantContext), redis, crypto (argon2),
│   │   │   │                         #   throttle, warehouse-scope, tenant-context, clock
│   │   │   ├── config/               # env.schema.ts: variables validadas con zod al arrancar
│   │   │   ├── i18n/                 # mensajes del API en es/en (nestjs-i18n)
│   │   │   ├── health/               # /api/health: lo miran UptimeRobot y la prueba de humo
│   │   │   └── main.ts
│   │   ├── prisma/                   # schema.prisma, migrations/ (con el SQL de RLS), seed.ts
│   │   ├── scripts/                  # generate-keys.sh (llaves de dev), ensure-test-db.mjs
│   │   └── test/                     # e2e (Jest + Supertest)
│   │
│   ├── web/                          # React + Vite — PWA
│   │   └── src/
│   │       ├── routes/               # TanStack Router, una ruta por archivo
│   │       ├── components/           # por dominio (pos, inventory, system…) + ui/ (shadcn)
│   │       ├── lib/                  # clientes del API por dominio, auth, theme, pwa, sentry
│   │       ├── stores/               # Zustand: sesión, carrito, carga rápida, modal de planes
│   │       ├── i18n/                 # textos de la UI en es/en
│   │       └── main.tsx
│   │
│   ├── site/                         # Astro — sellpointy.com (§ 2.5)
│   └── manual/                       # generador del manual de usuario (Playwright + PDF)
│
├── packages/
│   ├── shared/                       # reglas y tipos que comparten API, web y sitio
│   │                                 #   (dinero, impuestos, códigos, mercados, planes…)
│   └── api-client/                   # placeholder: iba a generarse desde OpenAPI
│
├── infrastructure/
│   ├── docker/                       # api.Dockerfile, web.Dockerfile, php-fpm.Dockerfile
│   ├── docker-compose.dev.yml        # Postgres + Redis locales
│   ├── docker-compose.prod.yml       # producción en el VPS
│   ├── docker-compose.sandbox.yml    # el sandbox, en el mismo VPS
│   ├── env.prod.example              # qué variables lleva /opt/sellpoint/.env (sin valores)
│   ├── nginx/                        # nginx-edge: vhosts, cabeceras, límites, TLS
│   └── scripts/                      # bootstrap, deploy-remote, backup-postgres,
│                                     #   renew-certs, ghcr-retention, site-deploy-remote…
│
├── .github/workflows/                # deploy.yml, checks.yml, ci.yml, site.yml, ghcr-retention.yml
├── docs/manual/                      # el manual de usuario, un Markdown por capítulo
├── ARQUITECTURA.md, IMPLEMENTACION.md, SEGURIDAD.md, …
├── turbo.json, pnpm-workspace.yaml, biome.json, commitlint.config.js
└── package.json
```

---

## 5. Seguridad

> **Esta sección explica el DISEÑO: qué capas hay y por qué están donde están.** Las medidas concretas —parámetros de argon2, vidas de los tokens, límites de intentos, horarios y retención de los respaldos— y la fuente de cada una viven en [`SEGURIDAD.md`](./SEGURIDAD.md), y **donde difieran, manda ese documento**. Aquí no se copian números que se afinan: duplicados, se desincronizan. Así pasó con esta sección, que hasta el 2026-09-26 describía el diseño original (respaldos en S3 con KMS, argon2 en 65536/3/4, CloudWatch, MFA) y no lo que corre (F10-SEC-03).

### 5.1 Principio: la última barrera es la base

La aplicación puede tener errores; la base no debe dejar que se conviertan en fugas. Por eso las protecciones que importan están en Postgres y no solo en el código de Nest:

- **Aislamiento entre negocios con RLS `FORCE`** (§3.1–3.2). La API se conecta con `sellpoint_app`, que no es superusuario ni tiene `BYPASSRLS`, y se niega a arrancar si alguien configura un rol que lo tenga. `withTenantContext` es la única puerta para abrir un negocio, y solo dura la transacción. Las excepciones están acotadas y tienen nombre: la función de login que ve dos columnas, el `billing_admin_bypass` del cobro y del backoffice, y los catálogos globales sin dueño (SEGURIDAD §2.1).
- **Lo que no se debe reescribir, la base lo prohíbe.** Los movimientos de inventario y la bitácora de auditoría son de solo escritura para la app (`REVOKE UPDATE, DELETE`), y un documento confirmado se corrige con otro movimiento, no editándolo (trigger de inmutabilidad).
- **Borrar un negocio tiene una sola puerta**, `purge_tenant()`, con el candado de retención legal dentro de la función: ni un guion se lo salta (SEGURIDAD §2.9).

### 5.2 Autenticación

- **Contraseñas con argon2id**, largo mínimo y sin reglas de composición (criterio NIST). El PIN del punto de venta, igual.
- **Dos tokens con papeles distintos.** El de acceso es un JWT RS256 de vida corta, con el algoritmo fijo, y viaja en la cabecera `Authorization`. El de sesión (refresh) es un valor aleatorio del que la base guarda solo la huella; vive en una cookie `httpOnly` + `Secure` + `SameSite=Strict` limitada a `/api/auth`, **rota en cada uso** y, si alguien reusa uno ya rotado, se revoca la familia entera y se audita como posible robo.
- **Revocación inmediata sin perder un JWT sin estado:** una época por usuario y por negocio en Redis. El guard la compara en cada petición, así que suspender a alguien, cambiarle el rol o cambiar la contraseña corta los tokens vivos en el acto.
- **Tokens de un solo uso** (verificar el correo, restablecer la contraseña): aleatorios, y de ellos solo se guarda la huella SHA-256.
- **Sin enumerar cuentas:** entrar, recuperar la contraseña y reenviar la verificación responden igual exista o no la cuenta, y al entrar se tarda lo mismo en ambos casos. La excepción es deliberada: el registro avisa si el correo ya tiene cuenta (F10-MANFIX-11).
- **Límites de intentos en dos capas:** la app, por IP y por correo, con el contador en Redis; y nginx, delante de `/api/auth/`.
- **No hay segundo factor** (SEGURIDAD §5).

### 5.3 Autorización

- **Cerrado por omisión.** Los guards globales (`APP_GUARD`) corren en orden fijo: límite, identidad, permisos y plan. Una ruta sin token existe solo si se marca `@Public()`.
- **RBAC con scoping de dos capas**: roles + permisos definen QUÉ; `user_warehouse_scopes` define DÓNDE (ver § 3.4).
- Roles por tenant: cuatro **de fábrica** que nacen con el negocio, más los personalizados que el negocio arme. **Convención (F10-MANFIX-22, Carlos, 2026-09-24): clave fija + nombre en el idioma del negocio.** Cada rol de fábrica lleva una clave inmutable en `roles.system_key` —`admin`, `manager`, `seller`, `viewer`— y un nombre en el idioma del dueño que el negocio puede cambiar: Administrador · Encargado · Cajero · Consulta, en inglés Admin · Manager · Cashier · Viewer. Un rol personalizado tiene la clave en `NULL`. La base la cuida con un CHECK de las cuatro claves y un índice único parcial `(tenant_id, system_key)`; la fuente es `TENANT_ROLES` en `modules/tenants/role-catalog.ts`. **La clave es lo único por lo que el código, las pruebas y las migraciones reconocen un rol de fábrica:** una migración de permisos futura busca `WHERE r.system_key = 'viewer'`, **nunca** `r.name` (el nombre cambia con el idioma y con el negocio, y un rol renombrado se quedaría sin los permisos siguientes). Las 11 migraciones de permisos anteriores buscan por nombre y no se tocan: ya corrieron, y en una base nueva no insertan nada. `GET /roles` y los roles de cada usuario devuelven `systemKey`.
- Permisos granulares (formato `recurso:accion`): `catalogs:read/write/manage`, `products:read/manage`, `warehouses:read/manage`, `inventory:read/movement/manage` (F3: `manage` = cancelar traspaso y aprobar conteo, solo el Administrador), `pos:sell`, `pos:quote` y `pos:view` (F4), `reports:read` (F5 — **no existe `reports:export`**: exportar es leer, mismo criterio que «reimprimir es leer» de F4), `users:manage`, etc. Un endpoint los declara con `@RequirePermissions('inventory:movement')` y exige todos los que pide.
- **«El administrador ve todas las sucursales» se decide por permisos, no por nombre:** quien tiene a la vez `roles:manage` y `users:manage` (`TENANT_ADMIN_PERMISSION_CODES`) se salta el alcance. El resto, si tiene sucursales asignadas, queda filtrado a ellas en los repositorios, y sin ninguna asignada ve todas (§3.4; `infrastructure/warehouse-scope/`).
- **Sin escalada de privilegios:** nadie da un permiso que no tiene ni asigna un rol con permisos que no tiene, y el último administrador activo no se puede quitar.
- **El plan también es una barrera:** `@RequiresFeature` (402 si el plan no lo incluye) y `@RequiresModule` (un módulo apagado no responde ni para leer).
- **El backoffice del operador** pide cuatro llaves a la vez, y la marca de administrador de plataforma no viaja en el token, así que revocarla es inmediato (SEGURIDAD §2.3).

### 5.4 El borde y la API

- **nginx es la única capa delante:** TLS, redirección a HTTPS, HSTS, CSP (propio origen y el envío de errores a Sentry) y el resto de cabeceras; la API suma Helmet. No hay proxy de Cloudflare ni WAF: está pospuesto (SEGURIDAD §5).
- **CSRF: la defensa es de diseño, no un token.** El token de acceso viaja en `Authorization`, que un formulario de otro sitio no puede poner; la única cookie es la de sesión, `SameSite=Strict` y limitada a `/api/auth`; y CORS solo acepta credenciales de los orígenes de la app. Por eso no hay token double-submit.
- **Toda entrada se valida antes de llegar al servicio:** zod en cada cuerpo y consulta (`ZodValidationPipe`), el validador derivado de `catalog_fields` para los atributos dinámicos, y `@UuidParam("id")` en los ids de ruta, con una prueba (`route-ids.e2e-spec.ts`) que recorre el router y falla si una ruta nueva lo olvida.
- **SQL siempre parametrizado:** Prisma, y `$queryRaw` con plantilla. `queryRawUnsafe` y `executeRawUnsafe` no se usan.
- **Un cobro no se duplica:** el punto de venta manda un `Idempotency-Key`.
- **Sin SSRF por construcción:** el API no pide URLs que controle el usuario; su única salida HTTP propia va a una dirección fija (Resend).
- **Los logs no guardan secretos:** Pino censura cabeceras de autorización, cookies y contraseñas, y nginx no registra la parte de la URL después de `?`.
- **La documentación interactiva (`/api/docs`) no se monta en producción** (F10-SEC-02).

### 5.5 Datos y respaldos

- **Dónde:** Postgres en un VPS de Vultr en la Ciudad de México, escuchando solo en `127.0.0.1`; nginx es lo único que publica puertos. Redis guarda solo datos de control (límites, épocas, cachés), nada del negocio.
- **Lo que se guarda como huella:** contraseñas y PIN con argon2; tokens de sesión y enlaces con SHA-256.
- **En reposo no hay cifrado propio:** ni por campo, y el cifrado del disco del VPS **no está verificado** (pospuesto por Carlos el 2026-09-25). Quien accede a la base lee los datos en claro, y hoy ese acceso lo tiene solo Carlos (SEGURIDAD §2.6 y §5).
- **Respaldos:** `pg_dump` nocturno, cifrado con `age` **antes de salir del servidor** (la llave pública vive ahí; la privada la guarda Carlos fuera) y subido a Cloudflare R2 con un token limitado a su bucket. Los `.env` viajan en el mismo respaldo, también cifrados. La restauración se ensayó (F6-DRILL-01). Frecuencia, retención y tiempos medidos: SEGURIDAD §3.
- **Secretos:** los `.env` viven solo en el servidor, fuera de git; las llaves del JWT entran por variable de entorno.

### 5.6 Auditoría y monitoreo

- **`audit_logs`** guarda quién, qué acción, sobre qué, cuándo, el antes y el después, la IP y el navegador. Tiene RLS y es de solo escritura para la app (F10-SEC-01). **Las lecturas no se registran**: nadie anota quién abrió un expediente o una pantalla del backoffice (SEGURIDAD §2.4 y §5).
- **Monitoreo:** Sentry recibe solo errores (5xx de la API y errores del navegador), y dos monitores externos revisan la app y el sandbox. Los logs rotan en cada contenedor y se leen por SSH: no hay logs centralizados.

### 5.7 Frontend

- **El token de acceso vive en memoria** (store de Zustand), nunca en `localStorage` ni en una cookie legible.
- **Refresh automático con single-flight** (`lib/auth/refresh-interceptor.ts`): ante un 401, UNA sola llamada a `/auth/refresh` y las demás peticiones esperan. No es optimización: como el backend trata un refresh ya rotado como robo, tres refresh en paralelo cerrarían la sesión.
- **Cerrar o recargar la pestaña no cierra la sesión:** el access se pierde con la página y `useSessionBootstrap` la recupera con la cookie. Lo que la cierra es «Cerrar sesión», que revoca el refresh en el servidor.
- **HTML de usuario, nunca:** React escapa por omisión y la regla `noDangerouslySetInnerHtml` de Biome frena cualquier excepción en el lint. La única que hay pinta un SVG propio de `packages/shared` (`ticket-settings.tsx`), con su `biome-ignore` justificado. Por eso no hace falta DOMPurify.
- **La CSP la pone nginx** y solo permite el propio origen (más el envío de errores a Sentry): el web no carga scripts de terceros.

### 5.8 OWASP Top 10 (2021): dónde se cubre cada punto

| Categoría | Qué lo cubre en este diseño | Lo que falta |
|---|---|---|
| A01 Broken Access Control | Cerrado por omisión, permisos, alcance por sucursal y RLS como segunda barrera | — |
| A02 Cryptographic Failures | HTTPS obligatorio, argon2id, JWT RS256 con algoritmo fijo, respaldos cifrados con `age` | Disco sin verificar; sin cifrado por campo |
| A03 Injection | SQL parametrizado, zod, validador derivado de `catalog_fields`, React sin HTML crudo | — |
| A04 Insecure Design | Candados en la base (RLS, solo escritura, `purge_tenant`), cerrado por omisión, idempotencia del cobro | Nadie ajeno al proyecto lo ha revisado |
| A05 Security Misconfiguration | Cabeceras en nginx y Helmet, Postgres solo en `127.0.0.1`, contenedores sin `root`, candado del rol al arrancar, `/api/docs` cerrado en producción | — |
| A06 Vulnerable Components | Dependabot semanal y Trivy en cada despliegue | Trivy solo informa; no hay `pnpm audit` que frene el despliegue |
| A07 Identification/Auth Failures | Límites en dos capas, refresh rotativo con detección de reuso, revocación por época, sin enumeración | Sin segundo factor |
| A08 Data Integrity Failures | JWT firmado, transacciones atómicas, `Idempotency-Key`, pipeline único que prueba antes de desplegar | Imágenes sin firmar (cosign pospuesto) |
| A09 Security Logging Failures | `audit_logs` inalterable, Sentry y monitores externos | No se registran las lecturas; sin logs centralizados |
| A10 SSRF | El API no pide URLs que controle el usuario | — |

El estado de cada pendiente, con su tarea o su decisión, está en SEGURIDAD §5.

---

## 6. Roadmap por Fases

> Las estimaciones son orientativas para un desarrollador full-stack experimentado trabajando full-time.

### Fase 0 — Setup del Monorepo (1-2 semanas)

1. `pnpm init` + configuración de Turborepo y `pnpm-workspace.yaml`
2. Bootstrap `apps/api`: NestJS CLI + Prisma + Postgres en Docker
3. Bootstrap `apps/web`: Vite + React + TS + Tailwind + shadcn
4. Bootstrap `packages/shared` con Zod base
5. Configuración Biome (o ESLint + Prettier) + Husky + lint-staged
6. CI básico en GitHub Actions (lint, type-check, test)
7. `docker-compose.dev.yml` con api + web + postgres + redis

**Entregable:** monorepo levantable con `pnpm dev`.

### Fase 1 — Core Multi-Tenant + Auth (2-3 semanas)

1. Modelos Prisma: `tenants`, `users`, `roles`, `permissions`, `refresh_tokens`, `audit_log`
2. Activar RLS en todas las tablas con `tenant_id`
3. `TenantContextMiddleware` en Nest
4. Módulo `auth`: register-tenant, login, refresh, logout, forgot-password, reset-password
5. RBAC: guards + decorator `@RequirePermissions`
6. Módulo `users`: CRUD con asignación de roles
7. Frontend: pantallas de login, register, forgot/reset, layout autenticado, refresh automático
8. Setup Swagger + generación de `packages/api-client`

**Entregable:** dos tenants pueden coexistir, sus usuarios no se ven entre sí, login funciona end-to-end.

### Fase 2 — Catálogos Dinámicos + UOM + BOM (4-5 semanas)

> Atomizada el 2026-08-16 en IMPLEMENTACION.md (12 módulos, 55 tareas) — esta lista es el resumen.

1. Módulo `catalogs` (motor): CRUD de catálogos, campos (Texto/Numérico/Lookup) con guardas y registros de subcatálogos con Código único — sin versionado (diferido, decisión de Carlos)
2. Módulo `units`: catálogo global de unidades (`ml`, `l`, `gr`, `kg`, `unit`, `m`, `cm`, etc.) + seed inicial + `convertUnits()` en shared
3. Módulo `products`: CRUD con validador derivado de campos + columnas `base_unit` y `is_composite`; precio/costo crean la presentación base «Unidad ×1»
4. Presentaciones por producto (caja, vaso, granel, con factor a `base_unit`, flags purchasable/sellable, barcode, precio, costo)
5. Composición/BOM: componentes con validación anti-recursión (DFS), unidades armables y componente limitante calculados en vivo
6. Módulo `warehouses`: CRUD + FK de `user_warehouse_scopes` + interceptor de scope al default permisivo
7. Frontend: editor de campos de cualquier catálogo + `DynamicForm` compartido + UI de registros de subcatálogos
8. Frontend: formularios dinámicos para productos con tabs **Información**, **Presentaciones**, **Composición** (solo si `is_composite`)
9. Importación masiva desde Excel con validación fila por fila + reporte de errores (incluye presentaciones; límite 5 MB síncrono)
10. Búsqueda en productos con `pg_trgm` — por nombre, SKU y barcodes de cualquier presentación, paginada server-side
11. Onboarding: pasos 2 (template siembra campos) y 3 (primer almacén) reales

**Entregable:** un admin de **cualquier rubro** define los campos de su catálogo, crea subcatálogos y los liga por lookup, crea productos simples, a granel (stock decimal) y compuestos (con composición), con todas sus presentaciones de compra/venta.

### Fase 3 — Movimientos de Inventario (5-6 semanas)

> **Evolución (atomización, 2026-08-17 — detalle en IMPLEMENTACION.md § Fase 3 y `topic_key: sellpoint/f3-atomizacion`).** El diseño se mantiene; se fijan las decisiones que el outline dejaba abiertas y se sube la estimación (kardex con saldo, stock por almacén, conteo completo y guardas heredadas de F2 no estaban contadas).

1. Módulo `inventory` con **2 tipos de movimiento** (Entradas y Salidas) + procesos especiales, todos escribiendo por **un único servicio** (`StockLedgerService.apply`): agrupa líneas, bloquea `stock_by_warehouse` con `SELECT … FOR UPDATE` **ordenado por (product_id, warehouse_id)** (anti-deadlock), valida, inserta en `stock_movements` y actualiza saldos en la misma transacción. Entradas, salidas, recepción de traspaso, conteo y (F4) la venta son **llamadores**, nunca escritores propios.
   - **Entrada** con `reason_code` ∈ {`invoice`, `adjustment`, `customer_return`} + `reason_note`; `invoice` exige `reference` (nº de documento) y `unit_cost` por línea. La entrada `transfer` solo existe como **recepción** de un traspaso (con `transfer_id`) desde la vista de tránsito.
   - **Salida** con `reason_code` ∈ {`adjustment`, `transfer`, `loss`, `consumption`, `expired`}; `transfer` pide **almacén destino** (no exige scope del emisor sobre el destino) y crea el `Transfer`.
   - **Inventario físico** (una sola plantilla: `sku` + lote/caducidad/ubicación cuando el producto los controla + teórico + contado, reconciliación en seco, aprobación transaccional) — caso especial separado; **sin bloqueo del almacén**: la aprobación relee el teórico con `FOR UPDATE` y audita el drift.
   - **Lotes, caducidad y ubicación (F3-LOTS, opt-in por producto con `products.tracks_lots`)**: modelo de **dos niveles** — `stock_by_warehouse` sigue siendo el total; `product_lots (product_id, lot_code, expires_at)` porque la caducidad es del lote; `stock_lots (lot_id, warehouse_id, location) → quantity` porque la ubicación parte el stock (texto libre, sin catálogo de racks). Invariante del ledger: `Σ stock_lots == stock_by_warehouse`. En salida sin lote explícito, `apply` reparte **FEFO** (`expires_at ASC NULLS LAST`) en la misma tx y el mismo `FOR UPDATE`; el POS de F4 lo hereda. Quien no activa el flag no ve un lote jamás.
   - **Documentos con estado (F3-DOC, decisiones de Carlos 2026-08-18)**: `inventory_documents` es el **encabezado** de toda operación que toca stock (folio, tipo, **estado**, almacén, motivo, referencia, autorizador, quién y cuándo); `inventory_document_lines` guarda **lo que el usuario capturó** y `stock_movements.document_id` **lo que el ledger hizo** — no es duplicación: FEFO parte una línea en N movimientos y un compuesto la expande en componentes. Ciclo `draft → confirmed` (escribe movimientos y mueve stock) o `draft → canceled` (queda el folio, sin stock). **CINCO series por tenant**: `ENT`, `SAL`, `INV` (F3) + `VTA` (venta) y `COT` (cotización), que entran en F4. Un traspaso es una `SAL` con `reason_code='transfer'` y su recepción una `ENT` con el mismo motivo: el motivo viaja dentro del documento, **nunca en el folio**.
   - **Inmutabilidad de lo confirmado**: el documento **no puede blindarse con `REVOKE UPDATE, DELETE`** como `stock_movements`, `units` o `currencies`, porque un borrador se edita. La garantía la da un **trigger `BEFORE UPDATE OR DELETE` que revienta si `OLD.status <> 'draft'`** — el primer trigger del proyecto. `stock_movements` conserva su REVOKE: nace al confirmar y no se toca nunca más.
   - **Folio y borrador**: el folio se toma **al crear el borrador**, en una transacción corta propia (`tenant_sequences` con `INSERT … ON CONFLICT DO UPDATE … RETURNING`), no dentro de la del ledger — el lock de la serie dura milisegundos en vez de todo el posteo, y el mismo patrón le sirve a F4 — con un matiz: la venta toma su folio `VTA` **dentro de la transacción del cobro** (el carrito vive en el cliente, no hay borrador de venta que retomar y un carrito abandonado no debe gastar folios); la cotización sí lo toma al crearse, porque el documento nace ahí. La serie **no pierde números**: un borrador abandonado queda `canceled` con su folio. Es lo que permite **retomar un movimiento a medio cargar buscándolo por su folio**, incluso desde otra máquina u otro usuario — la razón de que el borrador viva en el servidor y no en el navegador.
   - **El borrador ES la vista previa**: no hay endpoint de previa aparte. `GET /inventory/documents/:id` devuelve las filas resueltas con **`stockBefore`/`stockAfter`**, los lotes nuevos, la expansión de compuestos, el reparto FEFO que se aplicaría y los errores por línea, sin escribir nada. El Excel entra por `POST /inventory/documents/:id/lines/import`, que agrega líneas al borrador.
   - **PDF**: renderizado en el **servidor** con `pdfmake` (pagina la tabla solo y repite el encabezado; un conteo son 500 líneas) y entregado como binario `application/pdf` — no base64 en JSON — porque el front lo baja con axios `responseType: 'blob'`: un `<a href>` plano iría sin el Bearer y daría 401. Encabezado y pie comunes (negocio, folio, tipo, firmas Entregó / Recibió / Autorizó), **cuerpo por tipo**. **Sin total de unidades**: sumar 36 unidades + 2.5 kg no significa nada; el pie cuenta LÍNEAS.
   - El enum `reason_code` nace **completo**: `invoice | adjustment | transfer | customer_return | sale | sale_return | loss | consumption | expired | physical_count` — `sale`/`sale_return` **los emite solo el POS (F4)** — los endpoints directos los rechazan; **no hay `production`** (los compuestos nunca tienen stock persistido: salida `consumption`/`expired` expande componentes con la misma fórmula que `availability`; cualquier otro movimiento sobre un compuesto → 409).
2. **Traspaso = proceso de 2 pasos**: Salida con motivo `transfer` → `Transfer` `in_transit` (su folio es el de esa salida, un `SAL-…`; el traspaso no tiene serie propia) → el destino lo ve "pendiente de recibir" → recepción (todas las líneas, en base_unit, `0 ≤ recibido ≤ enviado`, nota obligatoria si hay faltante) → `completed`. La discrepancia se **deriva** de `transfer_lines` (`quantity_sent − quantity_received`), no se guarda como JSONB. **Cancelar** (solo `inventory:manage`) **no devuelve stock** al origen: la salida ya es historia; el reingreso es un `adjustment` explícito.
3. Concurrencia real: transacciones interactivas (`withTenantContext`, READ COMMITTED) + `FOR UPDATE` ordenado + upsert de la fila de stock antes del lock; `Prisma.Decimal` en toda aritmética (nunca `Number()`). Es la **primera** vez del proyecto en ambas cosas: se prueba con transacciones concurrentes contra Postgres real y con un test de propiedad (`stock_by_warehouse == Σentradas − Σsalidas`).
4. Tabla `stock_movements` (kardex) — **append-only por privilegios** (`REVOKE UPDATE, DELETE` a `sellpoint_app`), con `seq BIGINT IDENTITY` como desempate cronológico (`now()` es del inicio de la tx; UUID v4 no ordena), `batch_id` por operación, `parent_product_id` en salidas expandidas, `reference` + `authorized_by` como campos contextuales genéricos, y CHECKs de coherencia (dirección × motivo, `transfer ⇔ linked_warehouse_id`). FKs `RESTRICT` desde movimientos hacia productos, presentaciones y almacenes: el histórico no se borra. Tablas `transfers` + `transfer_lines` para el ciclo de vida. `tenant_sequences` para folios por tenant (reusable por F4).
5. Validaciones: stock no negativo (CHECK como red, el guard es el service), cantidades > 0 con hasta 4 decimales, enteros si la presentación es solo-enteros, traspaso entre almacenes del mismo tenant y distintos, almacén activo, alcance por almacén (`@CurrentUserScope()` — primer consumidor real), stock en tránsito visible.
6. Frontend: 2 pantallas de movimientos (cabecera reactiva por motivo, selector de presentación por línea, disponible en vivo en salida, UX teclado) + vista "Traspasos en tránsito" (dos tabs por scope, badge > 7 días, y un diálogo que crea el borrador de Entrada y navega a él — el traspaso no tiene pantalla de captura propia: se despacha desde Salidas y se recibe desde Entradas) + inventario físico en 2 pasos + tabs **Kardex** (con `balanceAfter` server-side) y **Stock por almacén** en el detalle de producto + selector de almacén reusable + UI de alcance por almacén en usuarios (deuda F2-SCOPE-03) + **tres listados por serie** (Entradas, Salidas, Inventario — el mismo componente montado tres veces, con buscador por folio, filtro de estatus y botón de crear) y **una pantalla de documento** que en `draft` es captura con autoguardado y panel de previa, y en `confirmed` es solo lectura con descarga del PDF.
7. Audit log de cada lote de movimientos (usuario, momento, motivo, saldo posterior por línea) y entradas detalladas para discrepancias y drift.
8. **Se cierran los puntos de extensión que F2 dejó para F3**: `assertDeletable` (presentación con movimientos → 409), `products.remove`/`assertBaseUnitChangeable` con movimientos, almacén no desactivable con stock o traspaso abierto (CU-ALM-02), `TenantTransactionsGate.hasTransactions()`, `availability` con scope. Diferidos con nombre: **costo promedio ponderado → F5**, **idempotencia → F4**, **backdating → F5 si se pide**. (Lote/caducidad/ubicación se habían diferido a Fase 9 y **entraron a F3 el mismo día** sobre un Excel real de cliente — ver F3-LOTS.)

**Permisos:** `inventory:read` (kardex, stock, tránsito — Viewer automático), `inventory:movement` (entradas, salidas, recepción, conteo — Manager), `inventory:manage` (cancelar traspaso, aprobar conteo — solo TenantAdmin).

**Entregable:** se puede mover stock entre almacenes con trazabilidad total, sin oversell bajo concurrencia, con stock en tránsito visible y kardex con saldo por almacén.

### Fase 4 — POS PWA + Cotización (3.5 semanas — atomizada 2026-08-20, IMPLEMENTACION.md)

1. **Modelo de datos** (las 5 tablas nuevas nacen con RLS): `cashbox_sessions` (turno por usuario, `warehouse_id` NOT NULL — la cadena es `usuario.asignado → turno → venta → ledger`), `sales` + `sale_items` (CHECK «producto XOR servicio» por línea; `quote_id` nullable FK activa; `clinical_document_id` reservada F9 sin tabla), `quotes` + `quote_lines` (folio `COT`, estados `open | loaded | canceled`, precios de **referencia** — sin vigencia, sin FK al ledger).
2. **La venta es LLAMADORA del ledger, nunca escritora**: `POST /pos/sales` en una transacción toma el folio `VTA`, crea `sale` + `sale_items` y descuenta vía `StockLedgerService.apply(reason='sale')` — FEFO, compuestos expandidos y bloqueo de lotes vencidos heredados de F3 sin una línea nueva. Las líneas de servicio no tocan el ledger. **Los precios los pone el servidor** desde el catálogo. `Idempotency-Key` en el checkout: el doble tap devuelve la misma venta. Anulación vía `apply(reason='sale_return')`, solo TenantAdmin/Manager con justificación.
3. **Cotización (adelantada de F9, decisiones de Carlos 2026-08-20)**: permiso propio `pos:quote` (la recepción cotiza sin poder cobrar; el médico de F9 lo hereda), **sin turno de caja** (no toca stock ni dinero — ni un `stock_movement`), **sin precios congelados ni vigencia** (al cargarla en el POS se recalculan del catálogo vigente y los faltantes se marcan contra el almacén del turno). Al cobrar: `Sale.quote_id` + estado `loaded`; una `loaded`/`canceled` no se recarga (409).
4. **Carrito** (Zustand, cliente): input principal **extensible** por strategy — `SkuLookup`, `BarcodeLookup`, `TextSearchLookup`, `ServiceLookup` (solo servicios ofrecidos en el almacén del turno), `QuoteLookup` (folio `COT-…`); `PrescriptionLookup` queda para F9 sin refactor. Búsqueda predictiva + escáner cámara (@zxing/browser). Numpad que oculta el `.` en presentaciones solo-enteros. **Un solo endpoint** `GET /pos/lookup?q=` resuelve las cinco: las exactas (código, SKU, folio) CORTAN la cadena y vienen marcadas `exact` para ir derecho al carrito; las difusas corren juntas y se suman. Lo que se ofrece sale de `sellableStock`, que descuenta los lotes vencidos y deduce lo armable de un compuesto desde sus componentes — filtrar por `stock_by_warehouse > 0` habría escondido todos los combos. **`warehouseId` explícito** para cotizar, que no tiene turno del cual heredar el almacén; con turno, el turno gana.
5. **Permisos**: `pos:sell` + los nuevos `pos:quote` y `pos:view` (historial) — `pos:view` era un permiso fantasma de VISTAS §9.3 que se resuelve acá, no se hereda.
6. **Ticket 58/80 mm**: plantilla NUEVA con el mismo `pdfmake` **0.2.x** (0.3 rompe — bitácora 2026-08-19; el renderer de documentos de F3 no se reusa: es carta, con firmas y sin precios). Impresión desktop abriendo el **PDF del servidor** (`GET /pos/{sales,quotes}/:id/ticket?width=`), no la pantalla con CSS `@page`: dos plantillas del mismo papel un día dirían cosas distintas. La cotización sale marcada **COTIZACIÓN** con la leyenda de que el precio final se calcula en caja — sin ella, el cliente vuelve en un mes reclamando un número que el sistema ya no reconoce. **Web Bluetooth (ESC/POS) DIFERIDA — F4-PRINT-BT**: sin impresora térmica real contra la que probar sería código de fe.
7. **PWA**: manifest instalable (`standalone`, icono `maskable` con zona segura) + service worker propio con el cascarón cacheado. **El API NUNCA se cachea** — servir un `/pos/lookup` guardado mostraría el stock de hace una hora y el cajero vendería lo que ya no está. **La venta NO funciona offline**: vender sin validar stock es regalar inventario, y sin red el aviso dice qué NO se puede hacer, no solo que no hay conexión.
8. Cierre de caja con totales por método (declarado, calculado y diferencia — se registra, no se bloquea).

**Entregable:** vendedor opera el POS desde tablet con escáner e impresión por navegador; recepción genera cotizaciones `COT-…` que la caja carga sin recapturar.

> **Impuestos de venta por país (F4-TAX, 2026-09-06).** Dos preguntas gobiernan todo: `tenants.tax_mode` (`included` | `excluded`: ¿el precio de catálogo ya trae el impuesto?) y `tax_group_id` (nullable) en cada artículo con precio (`products`, `services`, `medical_clinic_lab_studies`, `medical_clinic_diagnostic_studies`; NULL = el grupo predeterminado del negocio). El catálogo fiscal es por negocio y con RLS + FORCE: `tax_groups` (código estable en inglés, nombre en el vocabulario fiscal del país, un solo default activo por índice parcial `tax_groups_one_default`) y `tax_rates` (hasta 4 componentes por grupo, `rate DECIMAL(7,4)` 0..100; sin impuestos compuestos: ningún mercado objetivo los usa). Cada documento lleva su **snapshot**: `sales.tax_mode`/`tax_total`, `sale_items.tax_amount`/`tax_group_code` y `sale_taxes` (una fila por componente: `code, name, rate, base, amount`), con espejo exacto en `quotes`/`quote_lines` (+ `tax_rates` JSONB, para que el concepto cobre CONGELADO lo que cotizó) y `quote_taxes`. **Invariante universal:** `sales.total = Σ line_total = neto + tax_total` en los dos modos — en `included` el dinero no cambia, solo aparece el desglose; `sales.subtotal` sigue siendo Σ precio de catálogo; no hay `net_amount` (derivable). La aritmética vive UNA vez en `packages/shared/src/tax.ts` (`splitLineTax`, `bigint`, half-up por línea, el último componente absorbe el residuo) y la usan el motor único `pos/totals.ts#armarTotales` (ventas, cotizaciones y órdenes médicas) y el carrito del web: paridad al centavo. Siembra por país y región (`tax-defaults.ts#resolveTaxDefaults`) al terminar el onboarding y backfill de los existentes generado desde shared. KPIs, meta y caja en BRUTO; utilidad, tops y `GET /reports/taxes` sobre la base. Detalle en IMPLEMENTACION.md, módulo F4-TAX.
>
> **La marca de impuesto por línea y la etiqueta del registro fiscal (F4-TAXMARK, 2026-09-10).** Cuando un ticket mezcla dos o más grupos de impuesto entre sus líneas —Canadá con GST 5% y HST 13%, o una farmacia mexicana con IVA 16% y exento— cada línea lleva una letra tras el importe y el pie una leyenda («A = HST 13%», «B = GST 5%»), que es lo que el *Input Tax Credit Information (GST/HST) Regulations* de la CRA exige (indicar el estatus fiscal de cada línea) y lo que hace todo ticket canadiense. La letra es de **aparición** (A, B, C) y no de las iniciales del componente, porque en México los grupos de fábrica comparten el componente `VAT`; la leyenda dice el nombre del grupo, en el vocabulario fiscal del negocio. Con un solo grupo, o sin impuestos, el papel sale byte a byte como siempre: la columna de la letra no existe, no es una columna vacía. El dato ya era snapshot por línea (`sale_items.tax_group_code`, `quote_lines.tax_group_code`); el nombre se lee del catálogo vigente, como el nombre del producto en la fila. Y el registro fiscal se imprime con su nombre según `tenants.country` («RFC: …», «GST/HST No.: 123456789 RT0001», «CUIT: …») desde UNA tabla en shared (`tax-defaults.ts#TAX_ID_LABELS`, los 26 países curados; nació en el web como «decisión 6» y se mudó porque el ticket también la necesita) que usan el wizard, Mi perfil y el ticket. Detalle en IMPLEMENTACION.md, módulo F4-TAXMARK.

> **El nombre de una persona (F1-NAME, 2026-09-06).** `users` y `customers` —las dos únicas tablas de personas— guardan `first_name`, `last_name` y `second_last_name` (nullable). Los nombres son UNIVERSALES a propósito: `last_name_paternal`/`last_name_maternal` era el modelo mexicano aplicado a los 26 países, y para un negocio de Toronto «apellido paterno» es simplemente «el apellido» (renombradas en `20260911100000_f1_name_universal_surnames`, cuatro `RENAME COLUMN` escritas a mano — Prisma habría emitido `DROP` + `ADD` y borrado los datos). Cuántas casillas pide un formulario sale de `tenants.country` vía `packages/shared/src/names.ts#resolveNameFormat`: `single` un campo, `double` dos, `compound` un campo en plural (Portugal y Brasil). **El formato decide qué se PIDE, no qué se ACEPTA**: el país es del NEGOCIO, no de la persona —una clínica canadiense atiende pacientes mexicanas—, es mutable y nullable, así que el servidor nunca rechaza un segundo apellido por el país. Y el DATO decide qué se MUESTRA: un segundo apellido ya guardado se ve y se edita aunque el país sea de uno solo, y esconder el campo jamás lo borra. La concatenación vive UNA vez (`fullName` y `shortName` en shared, que reemplazaron 25 reimplementaciones); `fullName` nunca trunca — el `.slice(0, 200)` de los snapshots (`reception_turns.customer_name`, `medical_clinic_records.patient_name`) vive en quien guarda. Detalle en IMPLEMENTACION.md, módulo F1-NAME.

> **La historia clínica del consultorio (F9-CLINIC-HC, 2026-09-09).** El expediente es UN registro por visita (`medical_clinic_records`, folio `HCL-`) y sus secciones viven en UNA tabla (`medical_clinic_record_sections`, una fila por clave con `data` JSONB; existe fila ⇔ Completado). Lo que fija la forma de cada JSON no es la base: es el catálogo en código (`packages/shared/src/medical-clinic.ts`: 22 claves en cuatro grupos, TODAS funcionales desde F9-CLINIC-DOC (2026-09-09), cada una con su schema zod `.strict()` que el API usa al escribir y el web al pintar; `section_key` no tiene CHECK a propósito, así que reestructurar el catálogo es cero DDL). Una entrada del mapa puede ser un schema o una FÁBRICA que lo arma con el expediente (`resolveSectionSchema(key, {consultationDate})`: la próxima cita no es anterior a la consulta). **Lo negado se guarda explícito** (`{negated: true}`) y **lo derivado no se guarda** (IMC, categoría OMS, índice tabáquico, FPP y semáforo salen de `medical-measures.ts` al pintar). **Los antecedentes son del paciente**: al abrir un expediente se copian del anterior las siete secciones marcadas `carriedForward` con `source_record_id` apuntando a la consulta donde el médico las capturó de verdad, y el primer Guardar lo deja en NULL; signos, exploración y diagnósticos son del día y no se heredan. **El catálogo CIE-10 es global** (`medical_clinic_icd10_codes`, sin tenant ni RLS como `permissions`): 14 485 códigos del catálogo maestro de la DGIS (versión 2024-04-16, datos abiertos) cargados por la migración que genera `prisma/seed/icd10/build-migration.py`; `code` con punto (el de la OMS), `dgis_key` compacta, `search` sin acentos, `is_valid` = vigente para codificar; `GET /medical-clinic/icd10?q=` busca por prefijo de código o por texto ordenado por relevancia. **Documentos y seguimiento** (F9-CLINIC-DOC): Notas Médicas, Referencias e Interconsultas son secciones JSON como las demás (Recetas, Estudios y Citas de Seguimiento se retiraron por duplicar las Órdenes médicas y `follow_up`; Archivos Adjuntos se pospuso); las dos cartas se imprimen por índice (`GET /medical-clinic/records/:id/sections/:key/items/:index/document`, bloques comunes con la orden en `medical-pdf-blocks.ts`, sin serie de folio y SIN candado: se leen aunque la consulta venció); nada de Documentos se hereda (la respuesta del especialista es una nota del día que llega); la próxima cita del resumen del paciente se DERIVA de `follow_up` y «no vino» de que no hubo consulta después; la bitácora de cada sección guarda `before`/`after` con los datos (trazabilidad NOM-004 5.x). Detalle en IMPLEMENTACION.md, módulos F9-CLINIC-HC y F9-CLINIC-DOC; pantallas en VISTAS.md §12.

> **La dirección de un negocio (F1-ADDR, 2026-09-08).** `tenants` y `warehouses` guardan la dirección en campos UNIVERSALES: `address` (calle y número, la única que existía), `address_line2`, `city`, `region` (ISO 3166-2 sin país, `VARCHAR(8)`, la misma columna fiscal de F4-TAX en `tenants`) y `postal_code` — migración ADITIVA `20260912100000_f1_addr_structured_address`, siete `ADD COLUMN` nullable y cero renombres, así que se desplegó sin ventana. Qué campos se PIDEN, en qué orden, con qué etiqueta y con qué regla de código postal lo decide `tenants.country` vía `packages/shared/src/address.ts#resolveAddressFormat`, un catálogo copiado del de Google (libaddressinput) para los 26 países curados; un almacén hereda el país del negocio. **Aquí SÍ se valida por país** —a diferencia del nombre de persona—, porque la dirección y el país son del negocio: el servidor normaliza el CP (`normalizePostalCode`: Canadá a mayúsculas y con espacio) y rechaza con 422 el que no cumple la regla o la región que no es del país (`isPostalCode`, `isAddressRegionCode`). **La región tiene un solo dueño**: fiscal en Canadá y Estados Unidos (se edita en Impuestos, resiembra tasas; `needsRegion`), postal en México (se edita en la dirección; `addressAsksRegion`), y no se pide en los otros 23 países porque la columna admite códigos, no nombres. **Lo ya escrito no se pierde ni se exige**: el texto libre anterior vive en la línea 1 y solo el wizard de un negocio nuevo obliga lo que su país marca. **`formatAddress` vive UNA vez** y con solo la línea 1 devuelve la línea 1 tal cual (el ticket de un negocio que no completó nada imprime lo mismo que ayer); el ticket y el PDF de orden médica eligen el BLOQUE entero del almacén si tiene calle, o el del negocio, nunca la calle de uno con la ciudad del otro (`pos/ticket-header.ts`). Un solo componente en el web (`components/form/address-fields.tsx`) sirve al wizard, a Mi perfil y a los almacenes. Detalle en IMPLEMENTACION.md, módulo F1-ADDR.
>
> **El registro fiscal del negocio, por país (F1-TAXID, 2026-09-10).** `tenants.tax_id` sigue siendo texto libre en la base (criterio country: sin CHECK SQL), pero desde el wizard y Datos del negocio se valida el FORMATO del país curado con el mismo molde que el código postal: `packages/shared/src/tax-id.ts` guarda patrón, ejemplo y fuente oficial para 23 países (RFC del SAT, BN + `RT0001` de la CRA, EIN, NIF, CUIT, CNPJ, RUT…) y deja sin patrón a Nicaragua, Panamá y Belice hasta tener la fuente; se **normaliza antes de validar** (`123456789rt0001` → `123456789 RT0001`) para que la regla nunca rechace a un negocio real por una minúscula o un guion; el servidor (`tenant-profile.service#conRegistroFiscalValidado`) rechaza con 422 `tenants.invalid_tax_id` SOLO el registro que viene en el PATCH —contra el país que viene o el guardado— y lo guarda normalizado, así que **lo ya guardado no se exige hasta que se toque**; el web usa la MISMA función (`isTaxId`) con hint y error que enseñan el ejemplo. Donde el país define un dígito verificador con algoritmo público —CUIT, RUT, CNPJ— también se verifica; el RFC no (la homoclave no es verificable sin el algoritmo del SAT sobre el nombre). Esto revierte la «opción C» que MERCADOS.md §2 dejó fuera de alcance en 2026-08-16: el cliente real llegó con un ticket con «RFC: CINCO8507223N4» en la mano. Detalle en IMPLEMENTACION.md, módulo F1-TAXID.

>
> **El catálogo global de códigos de barras se empieza a usar (F10-QUICKCAT, 2026-09-16).** `global_barcode_catalog` estaba cargado desde el 2026-09-15 con 953,969 productos en local, sandbox y producción, y ningún código de la aplicación lo consultaba. Ahora lo consume la pantalla de **Carga rápida** (`/catalog/products/quick`): se escanea, el sistema pone el nombre y la persona solo pone el precio. **La aritmética del GTIN vive en `packages/shared/src/gtin.ts`**, portada de `prisma/seed/barcode-catalog/gtin.py` — las dos implementaciones TIENEN que decidir lo mismo, o el sembrador guarda bajo una clave y el API busca bajo otra. `GET /products/barcode-lookup?code=` es una cascada de dos pasos: el catálogo del negocio con RLS buscando **todas las escrituras del GTIN** (los productos guardan el código tal como se escaneó) y, solo si no acierta, la tabla global con `PrismaService` directo, sin `withTenantContext`, como el catálogo CIE-10. `POST /products/quick` da de alta hasta 100 líneas **todo o nada**, con los errores previsibles juntados antes de escribir y reportados por línea Y por código de barras; de un producto que ya existe se actualiza **solo el precio**. Lo que el catálogo global no conocía **se aporta**: INSERT ... SELECT con `ON CONFLICT (gtin14) DO NOTHING` —solo se inserta, un registro existente no se edita jamás— y con el filtro de lo no importable **como JOIN contra `gs1_prefix_ranges`, no como un `if`**, así ningún llamador futuro puede saltárselo. El aporte corre en **su propia transacción, después del COMMIT** del alta, y no lanza nunca: si falla, el negocio se queda con sus productos. ⚠️ La columna del sello se llama `contributed_by_tenant_id` y **no puede llamarse `tenant_id`**: `purge_tenant` recorre `information_schema` y borra de toda tabla base con una columna así, o sea que eliminar un negocio se llevaría filas del catálogo que usan todos los demás. Detalle en IMPLEMENTACION.md, módulo F10-QUICKCAT, y en CATALOGO-CODIGOS-DE-BARRAS.md §7.

>
> **El catálogo global habla el idioma del negocio (F10-LANG, 2026-09-16).** Carlos escaneó un aceite de oliva en Canadá y la Carga rápida le sugirió «Huile d'olive vierge extra»; la etiqueta decía «Extra Virgin Olive Oil». **La causa estaba en el volcado, no en el código**: el CSV de Open Food Facts tiene un solo campo de nombre, en el idioma de quien cargó el producto, y no publica los nombres por idioma. El volcado **JSONL** sí (`lang`, `product_name_en`, `product_name_fr`, `product_name_es`), y el sembrador pasó a leerlo — 12.9 GB contra 1.2 GB, **transmitidos y nunca guardados** porque `gzip.open` sobre la respuesta descomprime al vuelo. `global_barcode_catalog` gana `name_es`, `name_en` y `name_lang`: **solo dos columnas de idioma a propósito**, que son los dos que habla SellPointy y por lo tanto los dos únicos en los que una sugerencia puede llegarle al usuario *en su idioma*; el francés y los demás viajan en `product_name` con su `name_lang`, que es lo que la pantalla necesita para marcarlos («Nombre en francés» en vez de «Nombre sugerido»). `GET /products/barcode-lookup` elige por `user.locale` y **devuelve siempre el idioma de lo que devolvió**, para que la pantalla no disimule. La recarga pasó de `ON CONFLICT DO NOTHING` a `DO UPDATE ... WHERE source = 'open_food_facts'` —con DO NOTHING no habría corregido una sola de las 953,969 filas existentes— y los nombres por idioma van con `COALESCE(actual, nuevo)`: se llena la casilla vacía, nunca se pisa la escrita. **Lo que más vale del módulo es el aporte**: medido sobre el volcado real, de los productos canadienses en francés solo un tercio tiene inglés en Open Food Facts, así que los otros dos tercios los teclea el negocio que los vende — y desde ahora ese tecleo llena la casilla vacía de su idioma y se queda para el siguiente negocio. La LEY de «solo se inserta» no cambió: se mudó de la FILA a la CASILLA. Detalle en CATALOGO-CODIGOS-DE-BARRAS.md §6.5 y §7, e IMPLEMENTACION.md módulo F10-LANG.

### Fase 5 — Reportes ✅ CERRADA (2026-08-25)

> Sincronía FINAL (F5-DOCS-01): esta sección cuenta lo que se CONSTRUYÓ, no lo que se
> planeó. Las divergencias con el plan original están marcadas y explicadas.

1. **Permiso `reports:read`** — vivía en producción desde la migración `20260821180000`
   (TenantAdmin/Manager/Viewer; POS_Seller no) sin que ningún endpoint lo exigiera: lo
   había delatado la barrera `permissions-catalog.spec.ts` buscando permisos huérfanos.
   F5 lo estrenó con `GET /reports`. **No existe `reports:export`**: exportar es leer.
2. **Hub `/reports` con 8 tarjetas** (VISTAS §10): stock por almacén (valorizado),
   ventas por período, kardex por producto, catálogo, almacenes, usuarios, **vencimientos**
   y **stock en tránsito** (las dos últimas, herencias de F3). Catálogo/usuarios/almacenes
   son **export directo** sin pantalla propia — una tabla duplicaría los listados que ya
   existen en Catálogo y Sistema. El catálogo del hub viaja como DATO (`GET /reports`
   devuelve cada tarjeta con el permiso que exige) porque ese permiso **no es uniforme**:
   ver el punto 6.
3. **Costo promedio ponderado GLOBAL por producto** (decisión de Carlos, 2026-08-21 —
   la Bitácora de F3 lo dejaba «a decidir»): las entradas `invoice` guardan `unit_cost` a
   nivel presentación; F5 lo lleva a `base_unit` con `presentation.factor` y pondera por
   cantidad. Alimenta la **valorización** del reporte de stock y el `cost-estimate` de BOM
   (con fallback a `cost/factor` cuando no hay historial). Un traspaso no cambia lo que
   costó la mercancía; si un día cada sucursal compra a precios muy distintos, se migra a
   por-almacén.
4. Frontend: un componente común de reporte con `@tanstack/react-table` montado con
   **solo `coreFeatures`** — más estricto que el «modo manual» que planeaba el diseño
   original: activar `rowSortingFeature` o `rowPaginationFeature` ordenaría la PÁGINA
   recibida y la presentaría como el todo, así que quien pide «los diez con más stock»
   recibiría los diez mayores de veinte filas sin forma de notarlo. Molde de gates y
   listados heredado del POS.
5. **Exportación a Excel SÍNCRONA con tope de filas** (`exceljs` vía el
   `serializeSpreadsheet` de F2, parametrizado): superar el tope devuelve 400 con mensaje
   que pide acotar filtros — nunca un truncado silencioso. La generación asíncrona
   (cola Redis + worker) quedó **DIFERIDA**: sin un caso real que la exija sería código
   de fe (mismo criterio que F4-PRINT-BT). El kardex exportable REUSA
   `kardex.service.list` — no hay segunda implementación del saldo acumulado.

6. **Vencimientos y tránsito se exportan con `inventory:read`, no con `reports:read`**, y
   sus endpoints viven en el módulo de INVENTARIO (`GET /inventory/expiring/export` y
   `GET /inventory/in-transit/export`): son la misma lectura de su pantalla en otro
   formato, y exigir un permiso nuevo para bajar lo que ya se está viendo sería una puerta
   sobre una puerta abierta. Colgarlos del módulo de reportes con el permiso del
   inventario habría sido una rareza que el próximo lector tendría que descifrar.
7. **Lo que reveló construirla** (divergencias con el plan del 2026-08-21):
   - El **detalle por lote y ubicación** del reporte de stock (`?detail=lots`) nació de una
     directiva de Carlos a mitad de fase: el almacenaje contempla la ubicación además del
     lote y la caducidad. La ubicación PARTE el stock —es parte de la clave de
     `stock_lots`—, así que «12 en A-1 y 8 en B-2» son dos filas.
   - El export de tránsito **no pudo reusar `inTransit()`**: ese agrupa por producto
     —correcto para el tablero— y pierde folio, origen y destino, que es lo que necesita
     quien rastrea. Se agregó `inTransitDetail`: misma tabla, otro nivel de agregación.
   - `belowMin` compara contra el TOTAL del producto y no contra el saldo de cada fila:
     `stock_min` es un umbral global, y por fila marcaría en rojo tres bodegas con 40 cada
     una contra un mínimo de 100 habiendo 120.
   - El **filtro del `where` de ventas se extrajo a un builder compartido** con el POS
     (`pos/sales-where.ts`), arrastrando sus dos semánticas caras: rango en días del
     calendario del negocio y folio que también busca por código de barras.

**Entregable:** todos los reportes solicitados en los requerimientos originales, visibles en sistema y descargables — más las herencias de F3: valorización con promedio ponderado, vencimientos y tránsito exportables.

### Fase 6 — Hardening de Producción ✅ (queda F6-DR-01)

> Se hizo con la LEY de la fase (Carlos, 2026-08-27): el proyecto es chico, así que nada que corra permanente en el servidor entra sin pagar su renta en RAM. El detalle, en `IMPLEMENTACION.md` (Fase 6).

1. Dockerfiles productivos: multi-stage, sin `root`, memoria limitada ✅
2. `docker-compose.prod.yml` con `nginx-edge`, certbot y healthchecks ✅
3. CI/CD: un solo pipeline de GitHub Actions → GHCR → sandbox → producción en el VPS de Vultr, con reversión automática ✅
4. Respaldos nocturnos cifrados con `age` a Cloudflare R2, y restauración ensayada (F6-BACKUPS, F6-DRILL) ✅
5. Monitoreo: Sentry solo errores y UptimeRobot (F6-WATCH) ✅
6. Pruebas de humo después de cada despliegue ✅
7. Cabeceras y límites en nginx, Dependabot y Trivy, versiones con tag y retención en GHCR (F6-EDGE, F6-SUPPLY, F6-RELEASE) ✅
8. [`RUNBOOK.md`](RUNBOOK.md), el manual de operaciones (F6-DR-02, 2026-09-26) ✅; los respaldos automáticos del VPS (F6-DR-01): pospuestos por Carlos

**Entregable:** sistema corriendo en el VPS de Vultr con HTTPS, respaldos y monitoreo. **Pospuesto con razón escrita:** logs centralizados, gestor de secretos, proxy de Cloudflare y firma de imágenes (SEGURIDAD §5).

### Fase 7 — Planes + Billing + Suscripciones ✅ CERRADA (cobro manual)

> El diseño original de esta fase (planes Chica/Mediana/Empresa, Stripe primero, webhooks con BullMQ, gracia de 7 días) se reemplazó el 2026-08-27, antes de construirla. Lo que corre está en [`apps/api/src/modules/billing/README.md`](apps/api/src/modules/billing/README.md) y en `IMPLEMENTACION.md` (Fase 7).

1. Planes Free, Basic, Pro, Plus y Premium (este, pactado por cliente), con límites de usuarios y almacenes y funciones por plan; precios por mercado (México, Estados Unidos, Canadá) en `plan_prices`, y anual = mensual × 10
2. Una suscripción por negocio, nacida en la misma transacción que el negocio, con trial de 14 días a nivel Plus y sin tarjeta
3. **Cobro manual:** el cliente transfiere y Carlos registra el pago en el backoffice; el sistema calcula el cargo, avanza el período, avisa antes de cada corte y degrada solo al que no paga. Solo un pago registrado promueve
4. Guards de plan (`subscription.guard.ts`): funciones con `@RequiresFeature` (402), módulos con `@RequiresModule`, y los límites de usuarios y almacenes
5. Backoffice del operador y «Mi plan» del negocio
6. Stripe **pospuesto**: el modelo ya tiene sus columnas (`gateway`, `gateway_customer_id`, los price IDs en `plan_prices`) y el adapter entra sin migración cuando el volumen lo pida
7. Facturación fiscal (CFDI/SAT) sigue fuera de alcance — integración futura con un PAC cuando lo pida el primer cliente

**Entregable:** monetización activa con cobro manual.

### Fase 8 — Mobile (futuro)

- **Expo + React Native** consumiendo la misma API
- Reutiliza `packages/shared` y `packages/api-client`
- Considerar **Tamagui** o solución similar para `packages/ui` compartido
- Fuera del MVP

### Fase 9+ — Extensiones Verticales y Módulos Avanzados (futuro, fuera de MVP)

> Módulos opcionales activables por tenant (add-ons sobre el plan base). Se construyen **sobre el core** sin modificarlo. Cómo se activan hoy (F9-PLANMOD; ver «9.5 Modelo de pricing de los add-ons», más abajo): un módulo **pactado** (`reception`, `medical_clinic`) lo enciende el operador desde el backoffice en `tenant_modules`, y un módulo **de plan** (`expenses`, `purchases`) viene con el plan contratado según `MODULE_MIN_PLAN`. **No se elige en el onboarding.**

**Clientes reales que motivan estos módulos** (registrar en Bitácora cuando se atomice):
- 1 prospecto — **consultorio médico** → motiva F9-VERT-MEDICAL (receta médica)

> **Nota:** la cafetería (cliente comprometido) **NO está en Fase 9** — los productos compuestos / BOM + stock decimal son **parte del core** desde Fase 2 (ver sección 3.5). Las cafeterías y restaurantes operan con el core. Lo que SÍ podría ser add-on futuro es gastronomía **avanzada** (KDS para cocina, modificadores de plato, control de porciones por turno, etc.).

#### 9.1 Módulo genérico de Cotización / Pedido

Aplica a **cualquier vertical** (B2B, B2C consultivo). El TenantAdmin lo activa si su negocio cotiza antes de vender.

- Documento `quote` con folio, cliente (opcional, puede ser walk-in), líneas con productos del catálogo, descuentos, validez (días), estado (`draft | sent | approved | rejected | expired | converted`).
- En POS: input opcional **"Folio de cotización"** → carga las líneas al carrito. Al cobrar, la cotización pasa a `converted` y se vincula a la venta.
- Útil para: ferretería con clientes constructoras, óptica con cliente que compara precios, distribuidora, mayorista, B2B en general.

#### 9.2 Verticales con documento clínico/profesional

**Patrón común:** cada vertical genera un **documento profesional** con folio que en el POS pre-carga las líneas del carrito.

| Vertical | Documento generado | Datos clave |
|---|---|---|
| **Consultorio médico** | Receta médica | Paciente, médico (cédula profesional), diagnóstico (CIE-10), medicamentos sugeridos del catálogo del tenant, dosis, indicaciones |
| **Consultorio dental** | Plan de tratamiento | Paciente, odontólogo, odontograma, materiales del catálogo del tenant, sesiones |
| **Óptica** | Receta oftalmológica | Paciente, oftalmólogo, graduación (esfera/cilindro/eje/adición), armazón + cristales del catálogo del tenant |
| **Taller mecánico** | Orden de servicio | Vehículo, diagnóstico, refacciones del catálogo del tenant, mano de obra |

#### 9.3 Add-on — Gastronomía Avanzada (KDS, modificadores, control por turno)

> **Productos compuestos básicos + BOM YA ESTÁN EN EL CORE (Fase 2).** Las cafeterías y restaurantes operan con eso. Este add-on agrega funcionalidades **avanzadas** específicas del rubro gastronómico.

- **KDS (Kitchen Display System)**: pantalla en cocina con tickets entrantes ordenados por tiempo de preparación, estados (recibido → preparando → listo → entregado).
- **Modificadores de plato**: "Con leche descremada", "Sin azúcar", "Extra shot de café" — sustituciones o adiciones en línea de venta sin crear producto nuevo.
- **Control de porciones por turno**: límite de porciones diarias por producto (ej: solo 50 hamburguesas por turno).
- **Combos / Menús del día**: producto compuesto especial con precio fijo distinto al costeo de ingredientes.
- **Reportes de cocina**: tiempo promedio de preparación, productos más demorados, mermas por turno.

#### 9.4 Modelo de datos común y arquitectura

- Tabla `clinical_documents` (o similar): `id`, `tenant_id`, `vertical_code`, `folio`, `patient_id`, `professional_id`, `data` JSONB, `lines[]`
- Tabla `quotes`: análoga pero sin paciente/profesional
- En POS: input principal **extensible** (acepta SKU, barcode, búsqueda de texto, folio de cotización, folio de documento clínico)
- `sales.clinical_document_id` y `sales.quote_id` (ambos NULL salvo cuando aplica) → trazabilidad

**Crítico:** este diseño NO requiere cambios en el core actual. Los módulos se agregan como activables independientes que **referencian** el catálogo, el POS y las ventas existentes. El POS de Fase 4 debe diseñarse con **input principal extensible** (strategy pattern: `SkuLookup`, `BarcodeLookup`, `TextSearchLookup`, `ServiceLookup` y `QuoteLookup` — construidos en F4; futuro `PrescriptionLookup`) para no requerir refactor cuando llegue Fase 9. La previsión ya se cobró una vez: la cotización se adelantó a F4 y entró por esta puerta sin tocar el core.

#### 9.5 Modelo de pricing de los add-ons

> **Superado el 2026-09-10 (F9-PLANMOD).** El pricing real no pasa por Stripe ni por `subscription_items`: un módulo pactado (`reception`, `medical_clinic`) se activa desde el backoffice en `tenant_modules` y lleva al negocio a Premium con precio pactado; un módulo **de plan** (`expenses` desde Basic, `purchases` desde Pro) se incluye solo con el plan contratado según `MODULE_MIN_PLAN` (`packages/shared/src/plan-modules.ts`) y puede pactarse como add-on a un plan menor sin cambiar el plan. La tabla de abajo queda como registro histórico del diseño original.

Cada módulo activable es un **add-on con precio mensual/anual independiente** del plan base:

| Plan base | Incluye |
|---|---|
| Chica / Mediana / Empresa | Catálogo, almacenes, movimientos, POS, reportes — **todo el core** |

| Add-on | Precio orientativo |
|---|---|
| Vista pública de cotización (`F9-QUOTE-SHARE`; el cotizador es core desde F4) | +$X/mes |
| Gastronomía Avanzada (KDS, modificadores) | +$Y/mes |
| Vertical Consultorio Médico | +$Z/mes |
| Vertical Consultorio Dental | +$Z/mes |
| Vertical Óptica | +$Z/mes |
| Vertical Taller Mecánico | +$Z/mes |

En Stripe se modelan como `subscription_items` adicionales — agregar/quitar un add-on proratea automáticamente.

#### 9.6 Proveedores: el catálogo core que los módulos comparten (F9-SUPPL, 2026-09-10)

Proveedores **no es de ningún módulo**: lo usan Compras (F9-PURCH) y Gastos (F9-EXP), y mañana lo querrá la entrada de inventario, cuyo `stock_movements.reference` sigue siendo texto libre. Por eso la tabla `suppliers` (molde `customers`, cambiando persona por empresa) vive en el core con permisos propios (`suppliers:read|manage`) y su controller **no lleva `@RequiresModule`**: un negocio sin ninguno de los dos módulos simplemente no ve el enlace del menú, pero el API responde igual. El enlace «Proveedores» va en los grupos Compras y Gastos con la misma clave i18n y `useModuleNav` lo deduplica por ruta. El registro fiscal se normaliza y valida con el país del negocio (`normalizeTaxId`/`isTaxId`), sin UNIQUE: un repetido avisa en el formulario, no bloquea. Borrar un proveedor referenciado rebota por la FK (`RESTRICT`, jamás `SET NULL`) y se traduce a 409 `suppliers.in_use`: la salida es desactivarlo (`is_active`), y el listado lo ofrece ahí mismo. **Pospuesto con nombre:** `stock_movements.supplier_id` en lugar del `reference` libre; `tax_id` UNIQUE por tenant; saldo por proveedor.

#### 9.7 Gastos: una línea, dos hechos y la caja (F9-EXP, 2026-09-10)

Un gasto es **UNA línea** del mismo sumador que la venta (`armarTotales`, `quantity: 1`) con el modo fiscal del negocio, y guarda el snapshot de sus componentes con la **forma exacta de `sale_taxes`** en `expenses.tax_rates`: el IVA acreditable de mañana es un `jsonb_to_recordset`, no un recálculo. Dos hechos ortogonales, cada uno con su CHECK de coherencia: `status` (activo o anulado) y `payment_status` (pendiente o pagado). `warehouse_id NOT NULL`: el gasto es de UNA sucursal, para que la utilidad neta acotada por alcance reste solo lo que se mira. `expense_date` es DATE y se compara con DATE (`localCalendarDate`), nunca con un instante UTC. Las categorías son tabla propia (Basic no trae el motor F2-CAT), sembradas en `provision()` y por backfill con el idioma del primer usuario del negocio.

**La caja.** Un gasto en efectivo puede salir del cajón de un turno **elegible** (abierto, del mismo almacén, en alcance), tomado con `FOR UPDATE`. El cierre resta esos gastos del efectivo esperado (`expectedCash = ventas cash − gastos cash`) y lo calcula **dentro de la transacción, después del lock** —lo que arregló una carrera preexistente entre la lectura y el `updateMany`—. La resta vive en `pos/cashbox-expenses.ts` (el POS lee la tabla con un `Pick<TransactionClient, "expense">`, sin importar `ExpensesModule`: cero ciclo) y **fuera** de `totalesPorSesion`: la columna «Efectivo» del cierre, del reporte y del XLSX sigue siendo ventas. Pagado ⇒ los campos de dinero son inmutables (corregir = anular y recargar); un gasto de un turno **cerrado** no se anula (libro cerrado: la corrección es un gasto de ajuste). **Pospuestos con nombre:** cuentas por pagar con pagos parciales, catálogo de cuentas financieras (hoy `account_ref` libre con `<datalist>`), IVA acreditable, gastos recurrentes, adjuntos, fondo de caja.

#### 9.8 Compras: la compra transporta, la entrada exige (F9-PURCH, 2026-09-10)

Una compra es **el papel del proveedor**, no un movimiento de stock. Guarda lo que dice la factura —fechas, folio del proveedor, líneas con costo, descuentos, impuestos y cargos— y no toca el inventario: la mercancía entra por una **entrada de inventario** que nace de ella. Esa asimetría es la ley del módulo: la compra **transporta** lo que se sabe (producto, presentación, cantidad, costo, lote, caducidad) y la entrada **exige** lo que el kardex necesita (lote obligatorio si el producto lo controla, ubicación, cantidades en presentaciones enteras). Por eso la compra acepta una línea sin lote y la entrada no: ahí es donde se completa, antes de confirmar. El transporte tiene un límite en la otra dirección: un lote en un producto que **no** se controla por lote no es algo que la entrada vaya a exigir sino algo que va a RECHAZAR, así que las líneas lo rebotan al capturar (422 `purchases.lot_not_tracked`, nombrando la línea) y el puente no copia el lote de un producto al que le apagaron el control después de confirmar (Carlos, 2026-09-11). Y la caducidad es del LOTE, no de la línea: si el lote ya existe en `product_lots` —con o sin existencias— una línea sin fecha la hereda y una con otra fecha rebota (422 `purchases.lot_expiry_mismatch`), la misma regla que `line-resolver.ts` aplica en la entrada. Las fechas de factura y recepción no pueden ser posteriores al hoy del calendario del negocio (`localCalendarDate` con `tenants.timezone`, nunca el UTC del servidor).

**El costo que cruza el puente es el de la FACTURA en la base del negocio; el que entra al kardex y a la venta es el NETO** (reescrito el 2026-09-11 por F9-COSTMODE; ver §9.10). Al confirmar la compra se materializa `purchase_lines.unit_cost_net = (line_total − tax_amount) / quantity` (HALF_UP a 2, con el descuento de línea dentro). El puente escribe en la entrada DOS números: `unit_cost` en la base que el negocio captura (`tenants.cost_tax_mode`: el neto tal cual en `excluded`, `line_total / quantity` en `included` — la propia línea ya es neto + impuesto en los dos modos, sin snapshot ni ida y vuelta) y `unit_cost_net` EXACTO. Confirmar la entrada pisa `product_presentations.cost` con `unit_cost` (el catálogo se guarda como se captura) y manda `unit_cost_net` a `stock_movements` (el promedio ponderado y la valorización son netos por construcción). Un contrato de punta a punta lo fija con una caja ×12 en los dos modos fiscales y con una línea con descuento. El modo es **por documento** (compra u orden) y NACE del ajuste del negocio, no del modo del precio: el mostrador mexicano vende con IVA adentro y compra con IVA aparte.

**El puente es un par opaco.** `inventory_documents` gana `source_module`/`source_ref` (como `quotes`), **sin FK del core hacia un módulo**, con CHECK de par y un índice único parcial `WHERE source_ref IS NOT NULL AND status <> 'canceled'`: pedir la entrada dos veces devuelve la misma, y si se anula se puede pedir otra — la idempotencia vive en la base, no en un `if`. `POST /purchases/:id/entry-draft` exige `purchases:manage` **Y** `inventory:movement` (Compras no es un camino lateral para acuñar entradas), copia campo a campo y **no confirma**. Anular una compra con su entrada en borrador la anula en la MISMA transacción (`cancelDraftWithinTx`); si la entrada ya se confirmó, 409: la mercancía ya está adentro y se saca con un movimiento, no borrando el papel.

**El descuadre avisa y nunca bloquea.** `declared_total` es lo que dice la factura y `total` la suma de las líneas; la diferencia se DERIVA (misma función en la fila, el detalle, el resumen del rango y el PDF) y se pinta en rojo, pero la compra se confirma igual: ajustar las líneas para cuadrar pisaría el costo del catálogo con un número inventado. Los cargos adicionales (flete, maniobras) entran a la misma llamada de `armarTotales` como líneas de `quantity: 1`, suman al total y **no** se prorratean al costo unitario. **Pospuestos con nombre:** landed cost (prorrateo de fletes), orden de compra con recepciones parciales, devoluciones al proveedor, cuentas por pagar, moneda extranjera, adjuntar el XML de la factura.

#### 9.9 Órdenes de compra: tres papeles y el three-way match (F9-PO, 2026-09-11)

Son **tres papeles y ninguno sustituye al otro**: la **orden** es el compromiso con el proveedor (qué se pidió, a qué precio acordado, para cuándo y a qué almacén), la **recepción** es lo que llegó al andén (con su remisión o *packing slip* y su lote), y la **compra** sigue siendo la factura. El control se llama *three-way match* —orden, recepción y factura tienen que coincidir en cantidad y precio— y las diferencias se **ven**, no se esconden: `priceVariance` por línea (facturado − acordado), `quantityVariance` en la cabecera (facturado > recibido por línea de orden), y el origen y la variación impresos en el PDF de la compra. `confirm` no las mira: avisan y nunca bloquean, la misma doctrina del descuadre. Lo que la práctica de Estados Unidos y Canadá exige —*no PO, no pay*: el número de orden en la factura y en la remisión— va en el pie del PDF de la orden; en México la orden no es fiscal, la remisión llega primero y el CFDI después, y por eso el número de factura de una compra confirmada sigue editable.

**Es un ajuste del negocio, no un plan.** `tenants.uses_purchase_orders` (molde `uses_locations`) se enciende en Mi perfil y solo se ofrece con el módulo Compras. El API lo exige **solo para crear** órdenes (409 `purchase_orders.not_enabled`): apagarlo no esconde datos ni rompe lecturas; el enlace del menú lo condiciona un predicado `when` sobre el `TenantBlock`.

**La recepción NO mueve existencias.** Confirmarla suma `quantity_received` en la línea de la orden (con `SELECT … FOR UPDATE` sobre las líneas: dos recepciones a la vez no reciben 60 + 60 de 100) y rederiva el estado con una función PURA de shared (`purchaseOrderStatusFrom`). La mercancía entra al kardex por la entrada de la compra que nace de lo recibido, y por eso **el costo del catálogo sigue siendo el de la FACTURA, nunca el acordado** (lo fija el e2e de la cadena: 120 acordado, 125 facturado → `product_presentations.cost` = 125). La alternativa de un ERP —stock al costo esperado con corrección por factura— queda pospuesta con nombre.

**Lo compartido se extrajo, no se copió**: las reglas de lote (`purchases/lot-rules.ts`), la composición fiscal (`armarCompraConGrupos`, `gruposPorCodigo`), el hoy del negocio (`business-today.ts`), y en el web `useAutosave` (un PATCH por pausa con todo lo tecleado), `LotCells` y `ProductSearch`. El trigger de inmutabilidad de la orden emitida tiene UNA excepción quirúrgica —`quantity_received` y `closed_short`, las dos columnas que mueve la recepción— y rebota «recibido y costo a la vez». Series `OCO` y `RCP` (no `REC`: la recepción de un traspaso no tiene serie propia). **Pospuestos con nombre:** stock al costo esperado (cuenta «recibido no facturado»), tolerancia de exceso por proveedor, aprobación de órdenes, envío por correo al proveedor, orden sugerida desde mínimos, duplicar orden, cargos en la orden y landed cost, devoluciones al proveedor, reporte de órdenes, lista propia de recepciones.

---

#### 9.10 La base fiscal del costo: se guarda como se captura, el kardex es neto por construcción (F9-COSTMODE, 2026-09-11)

El PRECIO ya tenía su ajuste (`tenants.tax_mode`, F4-TAX: ¿el precio de catálogo ya trae el impuesto?). El COSTO no: era neto **por convención** —el copy de ayuda decía «sin impuestos»— y todo lo que computa dinero lo asumía sin verificarlo. Carlos (2026-09-11) pidió que capturar el costo fuera intuitivo en México, Canadá y EE. UU., configurable por negocio y sembrado por país. La respuesta es un segundo ajuste, hermano del primero: **`tenants.cost_tax_mode`** (`excluded` | `included`: ¿el costo se captura con el impuesto adentro?), con su radio en la tarjeta «Impuestos» de Mi perfil y aviso cuando ya hay costos capturados (cambiar el ajuste NO convierte nada: el número se queda, cambia su lectura — la misma doctrina que el precio).

**El default es «sin impuesto» en todos los mercados, México incluido.** El CFDI trae `ValorUnitario` sin IVA y el IVA es acreditable; Canadá recupera el GST/HST como input tax credit; en EE. UU. la compra para reventa va con certificado de reventa. El «costo con IVA» que ve el pequeño comercio es el precio de mostrador de un proveedor minorista, y para ESE negocio existe el ajuste. `tax-defaults.ts#resolveTaxDefaults` devuelve `costMode` (`DEFAULT_COST_MODE`) y `COST_MODE_BY_COUNTRY` es la única tabla de excepciones, vacía a propósito; `sembrar` escribe los dos modos al terminar el onboarding.

**La LEY:** el costo se GUARDA como se captura, en la base del negocio (los cuatro catálogos con `cost`, las líneas de compra y de entrada); el NETO se materializa en los tres puntos donde se computa dinero — la compra (`purchase_lines.unit_cost_net`), la entrada al confirmar (`inventory_document_lines.unit_cost_net` → `stock_movements.unit_cost`, derivado del costo tecleado con el grupo fiscal efectivo del producto cuando no lo trajo el puente; editar el costo de una línea lo anula) y la venta (`sale_items.unit_cost`, desimpuestado con el grupo del ítem al congelar). Utilidad (F4-TAX-20), promedio ponderado, valorización y el estimado del compuesto (que desimpuesta el costo de lista del componente para no mezclar bases con el promedio) no cambiaron de fórmula: ya eran netos, ahora lo son por construcción. La aritmética vive UNA vez: `packages/shared/src/tax.ts#netUnitCostCents`/`grossUnitCostCents` sobre `splitLineTax` (centavos), con envoltorio `Decimal` en `apps/api/src/modules/cost/cost-tax.ts`; `ContextoFiscal.costMode` viaja en el mismo `select` que `mode`. Compras y órdenes nacen con el modo del negocio y siguen editables por documento; la sugerencia del costo del catálogo NO se ofrece cuando el documento está en la otra base (un costo en la base equivocada es peor que ninguno); los formularios de producto, servicio y estudio, la entrada manual y los diálogos de importación dicen en qué base capturan. Con el default de todos (`excluded`) ningún número cambió: cada bloque lo fija con un test «byte a byte como hoy». Detalle en IMPLEMENTACION.md, módulo F9-COSTMODE.

## 7. Internacionalización + Multi-Currency

SellPoint soporta **dos idiomas** (español, inglés) a nivel de usuario y **dos monedas operacionales** (MXN, USD) a nivel de tenant. Esta sección define el modelo, el alcance, y cómo se propaga por todas las capas del sistema.

### 7.1 Decisiones de diseño

| Decisión | Valor | Razón |
|---|---|---|
| **Idioma — nivel** | Por usuario (`users.locale`) | Cada user ve la UI en su idioma. Natural. |
| **Currency — nivel** | Por tenant (`tenants.currency`) | El inventario y el POS son uniformes en una sola moneda. Sin tasas de cambio, sin conversión. |
| **Idioma default** | `es` (español) | Mercado primario MX/LATAM. |
| **Currency default** | `MXN` | Mercado primario. |
| **Idiomas soportados (MVP)** | `es`, `en` | Extensible: agregar nuevos locales = agregar archivos de traducción + entry en allowlist. |
| **Currencies soportadas** | `MXN`, `USD`, `CAD`, `EUR`, `GBP` | `SUPPORTED_CURRENCIES` en `packages/shared` y la tabla `currencies`. Agregar una = una entrada en ambos. Los planes se cobran solo en MXN, USD y CAD (§ 7.6). |
| **Detección inicial de idioma** | `Accept-Language` del browser al signup; editable en perfil | UX correcta. |
| **Resolución de locale en API** | `user.locale` (si autenticado) → `Accept-Language` (público) → `es` (default) | Predecible y testeable. |
| **Cambio de currency** | Bloqueado si el tenant ya tiene transacciones | Sin tasas de cambio no podemos convertir movimientos históricos. |
| **Lib backend** | `nestjs-i18n` | Estándar Nest, integra con guards/filters/pipes/validaciones. |
| **Lib frontend** | `react-i18next` + namespaces por dominio | Estándar React, lazy-load por ruta. |
| **Catalog data (productos)** | **NO se traduce** en MVP | Es data del tenant. Si en el futuro un tenant necesita catálogo bilingüe, fase aparte. |
| **Tasas de cambio** | No se implementan | El diseño per-tenant las hace innecesarias. |
| **Moneda del cobro** | La del mercado del negocio | El precio del plan sale de su mercado, no de un tipo de cambio: MXN en México, USD en Estados Unidos, CAD en Canadá (§ 7.6). |

### 7.2 Modelo de datos

```sql
-- Nueva columna en users
ALTER TABLE users ADD COLUMN locale CHAR(2) NOT NULL DEFAULT 'es'
  CHECK (locale IN ('es', 'en'));

-- Nueva columna en tenants
ALTER TABLE tenants ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'MXN'
  CHECK (currency IN ('MXN', 'USD'));

-- Tabla maestra de currencies (extensible)
CREATE TABLE currencies (
  code        CHAR(3) PRIMARY KEY,
  symbol      VARCHAR(8) NOT NULL,
  decimals    SMALLINT NOT NULL DEFAULT 2,
  name_es     VARCHAR(64) NOT NULL,
  name_en     VARCHAR(64) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO currencies (code, symbol, decimals, name_es, name_en) VALUES
  ('MXN', '$',  2, 'Peso mexicano',     'Mexican peso'),
  ('USD', 'US$', 2, 'Dólar estadounidense', 'US dollar');
```

### 7.3 Responsabilidades por capa

| Capa | Qué se traduce/formatea | Qué NO |
|---|---|---|
| **Backend — controllers / exceptions** | Mensajes de error, validation messages, respuestas de auth (ej: "Credenciales inválidas" / "Invalid credentials") | Códigos de error (`INVALID_EMAIL`, `PLAN_LIMIT_EXCEEDED`) — siempre estables y en inglés. |
| **Backend — emails** | Subject + cuerpo (templates `welcome.es.hbs`, `welcome.en.hbs`) | Logs internos, mensajes a Sentry — siempre en inglés. |
| **Backend — PDF (recibos, facturas)** | Labels del recibo según `user.locale` que emite | Productos y data del catálogo. |
| **Frontend — UI** | Labels, botones, placeholders, mensajes de éxito/error, breadcrumbs | Nombres de productos, categorías y data del tenant. |
| **Frontend — formateo** | Fechas (`Intl.DateTimeFormat`), números (`Intl.NumberFormat`), monedas (`Intl.NumberFormat({style:'currency'})`) | — |
| **Frontend — currency** | Símbolo, posición, separadores decimales/miles según locale del user + currency del tenant | — |

### 7.4 Resolución de locale en API (cascada)

```
Request → AuthGuard → si user autenticado: usa user.locale
                  → si no autenticado:
                       Header Accept-Language presente y soportado: úsalo
                       de lo contrario: usa 'es'
       → I18nContext.set(locale)
       → Handler / Exception filters traducen con i18n.t('key', { lang })
```

### 7.5 Formateo de moneda (frontend)

```typescript
// packages/shared/src/format.ts
export function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: 'currency',
    currency,
  }).format(amount);
}

// formatMoney(1234.56, 'MXN', 'es') → "$1,234.56"
// formatMoney(1234.56, 'USD', 'en') → "$1,234.56"
// formatMoney(1234.56, 'MXN', 'en') → "MX$1,234.56"
```

El helper vive en `packages/shared` para reutilizarse en `apps/api` (PDFs, emails), `apps/web` y futuro `apps/mobile`.

### 7.6 El cobro: precios por mercado, sin pasarela

- Cada plan tiene **un precio por mercado** en `plan_prices`: MXN en México, USD en Estados Unidos y CAD en Canadá. No se convierte por tipo de cambio.
- El mercado lo resuelve `resolveMarket` (`packages/shared`): el país del negocio manda; sin país, su moneda. **La misma función** la usan la vitrina y el cobro: mostrar un precio y cobrar otro sería el peor error del módulo.
- El cobro es manual (§ 6, Fase 7), así que no hay pasarela que maneje monedas. Cuando entre Stripe, los price IDs por mercado ya tienen su columna en `plan_prices` (`billing/README.md` §7).

### 7.7 Limitaciones explícitas (out of scope MVP)

- ❌ Conversión de moneda entre tenants o usuarios — no hay tasas de cambio.
- ❌ Catalog data multilingüe (un producto con `name_es` y `name_en`) — el tenant carga su catálogo en su idioma.
- ❌ Idiomas RTL (árabe, hebreo) — requeriría layouts CSS especiales y testing dedicado.
- ❌ Facturación fiscal multi-jurisdicción (CFDI MX, AFIP AR, etc.) — fase futura cuando el cliente lo exija.
- ❌ Pluralización compleja (idiomas con múltiples formas plurales) — `react-i18next` lo soporta nativamente cuando lo necesitemos.

---

## 8. Variables de Entorno

> La fuente de verdad del API es `apps/api/src/config/env.schema.ts`: valida cada variable con zod al arrancar, y la API no levanta si falta una obligatoria o si una combinación está prohibida en producción (`MAIL_DRIVER` distinto de `resend`, `BILLING_ADMIN_EMAILS` vacía, `COOKIE_DOMAIN` con valor). Las plantillas son `apps/api/.env.example` y `apps/web/.env.example` para desarrollo, e `infrastructure/env.prod.example` para el servidor (solo nombres y formato, sin valores).

### API

| Grupo | Variables | Nota |
|---|---|---|
| App | `NODE_ENV`, `PORT`, `APP_URL`, `CORS_ORIGINS` | `APP_URL` arma los enlaces de los correos |
| Base | `DATABASE_URL`, `DATABASE_URL_ADMIN` | La primera es el runtime (`sellpoint_app`, sujeto a RLS); la segunda, solo las migraciones y el seed |
| Redis | `REDIS_URL` | |
| JWT | `JWT_PRIVATE_KEY_BASE64`, `JWT_PUBLIC_KEY_BASE64` (producción) · `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH` (desarrollo) · `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_TTL_MIN` | |
| Sesión | `REFRESH_COOKIE_PATH`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_FAMILY_MAX_DAYS`, `COOKIE_DOMAIN` | `COOKIE_DOMAIN` va vacía: la cookie es solo del host |
| Límites | `THROTTLE_ENABLED`, `TRUST_PROXY_HOPS`, `THROTTLE_GLOBAL_*`, `THROTTLE_AUTH_IP_*`, `THROTTLE_AUTH_EMAIL_*` | Los valores por omisión, en SEGURIDAD §2.2 |
| Correo | `MAIL_DRIVER` (`console`, `resend` o `noop`), `MAIL_FROM`, `RESEND_API_KEY` | |
| Errores | `SENTRY_DSN` | |
| Plataforma | `BILLING_ADMIN_EMAILS`, `PLATFORM_NOTIFY_EMAILS`, `BILLING_CRON_ENABLED`, `BILLING_CRON_TZ`, `BILLING_CRON_HOUR`, `SITE_LEADS_RETENTION_ENABLED` | Quién entra al backoffice, a quién se avisa, y los jobs |
| Solo en el servidor | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `SELLPOINT_APP_PASSWORD`, `GHCR_OWNER`, `IMAGE_TAG`, `NODE_OPTIONS` | Los usa docker compose; `IMAGE_TAG` es la versión que corre |

El idioma y la moneda no son variables: salen del negocio (§ 7).

### Web (se hornean en el build)

| Variable | Para qué |
|---|---|
| `VITE_API_URL` | A qué API habla el web |
| `VITE_SENTRY_DSN` | Sentry del navegador |
| `VITE_APP_VERSION`, `VITE_APP_BUILD` | La versión que se ve al pie del menú |

> **En producción los secretos viven en `/opt/sellpoint/.env`** (permisos 600, dueño `deploy`), generado en el servidor y nunca en git; su copia viaja cifrada con `age` en el respaldo nocturno (§ 2.4).

---

## 9. Comandos de Inicio Rápido

> El día a día está en [`README.md`](README.md); las reglas para commitear, probar y desplegar, en [`CONTRIBUTING.md`](CONTRIBUTING.md); y la operación del servidor, en [`RUNBOOK.md`](RUNBOOK.md). Aquí va lo mínimo.

### Primera vez

```bash
pnpm install                              # dependencias y git hooks
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
bash apps/api/scripts/generate-keys.sh    # par RS256 de desarrollo en apps/api/keys/
pnpm dev:up                               # Postgres + Redis (docker-compose.dev.yml)
cd apps/api && pnpm exec prisma migrate deploy && pnpm exec prisma db seed
```

### Día a día

```bash
pnpm dev                      # api + web (turbo)
pnpm lint                     # biome check del repo
pnpm typecheck:full           # los tipos, igual que el CI
pnpm test                     # todas las pruebas; el API usa su propia base, sellpoint_test
pnpm --filter api test:e2e    # e2e del API
pnpm build
pnpm manual                   # regenera el manual de usuario (~10 min)

# Migración nueva
cd apps/api && pnpm exec prisma migrate dev --name <nombre>
```

`pnpm test` migra solo `sellpoint_test`. La base del servidor de desarrollo (`sellpoint_dev`) se migra aparte, con `prisma migrate deploy` y su `DATABASE_URL`.

### Producción (VPS de Vultr)

No hay despliegue a mano: **un push a `main`** corre `deploy.yml` (pruebas → imágenes → sandbox → producción).

| Qué | Cómo |
|---|---|
| Desplegar | Push a `main` |
| Volver a la versión anterior | Automático si falla la prueba de humo; a mano, con `IMAGE_TAG` en `/opt/sellpoint/.env` (`infrastructure/scripts/deploy-remote.sh`) |
| Respaldo | Cron nocturno con `infrastructure/scripts/backup-postgres.sh`; también se puede correr a mano en el servidor |
| Restaurar | [`RUNBOOK.md`](RUNBOOK.md) §4, el procedimiento ensayado |
| Publicar una versión con número | `pnpm release` y push del tag (README, «Releases») |

---

## 10. Glosario del Dominio

| Término | Definición |
|---|---|
| **Tenant** | Cliente del SaaS. Cada tenant tiene sus propios usuarios, datos, productos y schemas. Aislamiento total. |
| **Product Schema** | Definición (JSON Schema) de los campos custom que un tenant decide tener en sus productos. Versionable. |
| **Almacén** | Ubicación física donde se guarda stock. Un tenant puede tener N almacenes. |
| **Movimiento** | Cualquier cambio de stock: Entrada, Salida o Inventario físico. Registrado append-only en `stock_movements` (kardex), colgando siempre de un **documento**. |
| **Documento de inventario** | El **encabezado** de una operación que toca stock (`inventory_documents`): folio, tipo, **estado**, almacén, motivo, referencia, quién y cuándo. Sus líneas capturadas viven en `inventory_document_lines` y lo que el ledger asentó en los `stock_movements` que comparten `document_id`. Es lo que se lista, se busca por folio y se imprime en PDF. Mientras es **borrador** se edita; una vez **confirmado** es intocable (lo impone un trigger) — corregirlo es registrar otro movimiento. |
| **Folio** | El número humano de un documento, `PREFIJO-000001`, con **tres series por tenant**: `ENT` Entrada, `SAL` Salida, `INV` Inventario físico (`VTA` reservado para las ventas de F4). Un traspaso es un `SAL` y su recepción un `ENT`: el motivo no cambia la serie. Se asigna **al crear el borrador**, que es lo que permite retomarlo después. La serie no pierde números: lo abandonado queda anulado con su folio. |
| **Borrador** | Un documento en estado `draft`: tiene folio, se edita, se guarda solo y **se retoma por su folio** aunque se cierre el sistema o lo continúe otro usuario. Todavía no movió stock. Al confirmarlo nacen los movimientos; al abandonarlo queda anulado. |
| **Vista previa** | No es una pantalla aparte: es el **detalle del borrador**, que resuelve y valida sus líneas y devuelve **el stock actual y el resultante por línea** sin tocar nada. Es lo que evita confirmar a ciegas una entrada de 80 productos. |
| **Entrada** | Movimiento de entrada de stock a un almacén con un **motivo** (`reason_code`): factura (`invoice`, exige referencia y costo unitario), ajuste, devolución de cliente. La entrada con motivo traspaso es la **recepción** de un `Transfer` y se hace desde la vista de tránsito. `sale_return` queda reservado para F4. |
| **Salida** | Movimiento de salida de stock de un almacén con un **motivo**: ajuste, traspaso, merma, pérdida, consumo interno, caducado, etc. Si el motivo es traspaso, pide almacén destino. |
| **Traspaso** | Proceso de 2 pasos entre dos almacenes del mismo tenant: (1) Salida motivo traspaso → crea `Transfer` con estado `in_transit` cuyo documento de despacho es una **Salida con motivo traspaso** (`SAL-000019`) — el traspaso no tiene folio ni serie propios; (2) recepción en el destino (desde la vista de tránsito, todas las líneas, `0 ≤ recibido ≤ enviado`) → `Transfer` pasa a `completed`; la recepción es un borrador de **Entrada** con motivo traspaso (`ENT-000043`) precargado con lo enviado, ligado al mismo traspaso. La discrepancia se deriva de las líneas y queda auditada. **Cancelar (solo TenantAdmin) no devuelve stock al origen**: el reingreso es un `adjustment` explícito. |
| **Stock en tránsito** | Stock que salió del almacén origen pero todavía no fue confirmado por el destino. Visible en reportes y en la vista "Traspasos en tránsito". |
| **Inventario físico** | Conteo real del almacén con **una** plantilla: `sku` (+ lote/caducidad/ubicación en los productos que los controlan) + teórico + contado; una fila por (lote, ubicación) cuando aplica; un lote nuevo se crea al aprobar. Reconciliación en seco y aprobación (solo `inventory:manage`) que, para cada línea con diferencia, genera salida del teórico + entrada del contado con `reason_code='physical_count'`. **Sin bloqueo del almacén**: la aprobación relee con `FOR UPDATE` y audita el drift. Caso especial, separado de Entrada/Salida. |
| **Kardex** | Histórico completo de movimientos de un producto. Trazabilidad total. Con lote, caducidad y ubicación por línea cuando el producto los controla, y el **folio** del documento que originó cada línea. |
| **Lote** | Partida de un producto con un `lot_code` único por producto y una **caducidad propia del lote** (`expires_at`, opcional). Solo existe para productos con `tracks_lots = true` (opt-in). Su stock se guarda en `stock_lots` por almacén y **ubicación** (texto libre; la ubicación parte el stock), y la suma siempre iguala al total de `stock_by_warehouse`. |
| **FEFO** | *First Expired, First Out*: en una salida (incluida la venta del POS) de un producto con lotes, el ledger descuenta primero del lote que **vence antes** (`expires_at ASC`, los sin fecha al final). El usuario puede forzar un lote concreto. Es genérico: lo usa una farmacia con medicinas, una tienda con alimentos o una refaccionaria con partidas. |
| **Vertical** | Especialización del sistema para un rubro específico (farmacia, consultorio, óptica, gastronomía, etc.). El core es vertical-agnóstico; los verticales se agregan como add-ons opcionales en Fase 9+. |
| **Add-on / Módulo activable** | Módulo opcional sobre el core. Si es **pactado** (`reception`, `medical_clinic`), lo enciende el operador desde el backoffice y lleva al negocio a Premium con precio pactado; si es **de plan** (`expenses`, `purchases`), viene con el plan (F9-PLANMOD). |
| **Cotización** | Documento previo a la venta con folio `COT-…` y líneas de productos/servicios a precio de **referencia** — sin vigencia ni precios congelados: el POS los recalcula al cargarla. Estados `open → loaded / canceled`. Tabla `quotes` (**Fase 4**, adelantada de F9; la vista pública compartible queda como `F9-QUOTE-SHARE`). |
| **Prescripción / Documento clínico** | Documento generado por un módulo vertical clínico (receta médica, plan dental, receta óptica, orden de servicio) con un **folio** que se referencia en el POS para pre-cargar las líneas de la venta. Tabla `clinical_documents` (Fase 9+). |
| **Folio de prescripción / cotización** | Identificador único del documento. Input opcional en el POS que busca el documento y pre-carga el carrito. |
| **Unidad base (`base_unit`)** | Unidad de medida interna en la que se guarda el stock de un producto (`unit`, `ml`, `gr`, `kg`, `l`, `m`, `cm`, etc.). Invariable una vez que el producto tiene stock o es componente de otro. Definida en Fase 2. |
| **Presentación** | Cómo se compra o vende un producto (Caja 1L, Vaso 200ml, Granel por gr, etc.) con un **factor** de conversión a la `base_unit`. Un mismo producto puede tener N presentaciones — algunas comprables al proveedor, otras vendibles al cliente, otras ambas. Tabla `product_presentations` (Fase 2). |
| **Producto compuesto / BOM (Bill of Materials)** | Producto vendible que se arma a partir de N **componentes** del catálogo con cantidades específicas en la `base_unit` del componente (ej: un lente armado = 1 armazón + 2 cristales; un café = 200 ml de leche + 18 gr de café molido). El producto compuesto **no persiste stock propio** — sus unidades armables se calculan en vivo desde el stock de sus componentes. Al venderse, el POS descuenta los componentes en transacción atómica. Tabla `product_compositions` (Fase 2 del core). El vocabulario es *componente*, nunca *ingrediente* — LEY de genericidad. |
| **Stock decimal** | El stock se almacena con `DECIMAL(14,4)` (no INTEGER) para soportar fracciones (ml, gr, m). El POS y los reportes redondean para humanos según la presentación. |
| **POS** | Punto de Venta. Interfaz PWA optimizada para venta rápida con escáner e impresora. |
| **Ticket** | Comprobante de venta impreso en papel térmico (58 o 80mm) en formato ESC/POS. |
| **RBAC** | Role-Based Access Control. Permisos asignados a roles, roles asignados a usuarios. |
| **RLS** | Row-Level Security de Postgres. Garantiza aislamiento entre tenants a nivel base de datos. |
| **JSONB** | Tipo de dato de Postgres para JSON binario indexable. Usado para atributos custom de productos. |

---

## Apéndice — Referencias

- [ControlDeInventario.md](ControlDeInventario.md) — requerimientos originales del módulo de inventario
- [PuntoDeVenta.md](PuntoDeVenta.md) — requerimientos originales del POS

---

*Documento maestro de SellPoint. Mantener actualizado cuando se tomen decisiones arquitectónicas relevantes.*
