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
- **Movimientos:** Entrada Directa, Salida Directa (ambas con motivo: factura, ajuste, traspaso, devolución, merma, etc.), Inventario físico. Los traspasos son un **proceso de 2 pasos con confirmación**: la salida deja stock "en tránsito" hasta que el almacén destino confirma la entrada. **Toda operación es un documento con folio y estado**: nace en **borrador** (`ENT`, `SAL`, `INV` — el traspaso es una salida con motivo, no una serie propia), se carga a mano o por Excel guardándose sola, **se retoma por su folio** si se cierra el sistema, muestra el stock resultante antes de confirmar, y al confirmarse se baja en PDF firmable.
- **POS:** Venta rápida, búsqueda predictiva, escaneo de cámara, impresión ESC/POS
- **Reportes:** Stock por almacén, Catálogos, Usuarios, Ventas
- **Sistema:** Usuarios, Roles, Permisos granulares por módulo

---

## 2. Stack Tecnológico

### 2.1 Backend (`apps/api`)

| Decisión | Recomendación | Justificación |
|---|---|---|
| Framework | **NestJS 10** | Modular, DI nativa, decoradores, guards/interceptors. Estándar de la industria para APIs Node.js de tamaño medio/grande. |
| Lenguaje | **TypeScript 5** | Type safety en todo el stack. Tipos compartidos con frontend vía `packages/shared`. |
| ORM | **Prisma 5** | Type-safe, soporte nativo de JSONB en Postgres, migraciones declarativas, generación automática de tipos. |
| Base de datos | **PostgreSQL 16** | JSONB + GIN indexes para atributos dinámicos. Row-Level Security nativo. Soporte transaccional ACID. |
| Validación | **Zod** (`ZodValidationPipe`) + **validador derivado** | Zod para DTOs estáticos (lo que F1 implementó de hecho). Los atributos dinámicos se validan con la función pura derivada de `catalog_fields` — sin Ajv (ver § 3.3, 2026-08-16). |
| Auth | **JWT (access) + Refresh rotativo** | Access en memoria, refresh en cookie `httpOnly + Secure + SameSite=Strict`. RS256 (par de claves). |
| Hash | **Argon2id** | Más resistente que bcrypt a ataques GPU/ASIC. Recomendación OWASP 2024. |
| Rate limit | **@nestjs/throttler + Redis** | Por IP y por user. Agresivo en `/auth/*`. |
| Cache / Cola | **Redis 7** | Cache de queries pesadas + cola para jobs (importación Excel, reportes). |
| Docs | **Swagger (OpenAPI 3.1)** | Auto-generada desde decoradores. Fuente de verdad para `packages/api-client`. |
| Logs | **Pino** | JSON estructurado, alto throughput. Redacción de campos sensibles (passwords, tokens). |

### 2.2 Frontend Web (`apps/web`)

| Decisión | Recomendación | Justificación |
|---|---|---|
| Build | **Vite 5** | HMR instantáneo, build optimizado con Rollup. |
| UI | **React 18 + TypeScript** | Concurrent features (transitions, Suspense), ecosistema robusto. |
| Routing | **TanStack Router** | Type-safe routing, code-splitting nativo, loaders integrados con TanStack Query. |
| Server state | **TanStack Query v5** | Cache automático, retries, optimistic updates, invalidation. Indispensable para POS en tiempo real. |
| Client state | **Zustand** | ~1kb, sin boilerplate, ideal para carrito POS, UI state, preferencias. |
| Forms | **React Hook Form + Zod** | Performance, validación compartida con backend (mismo Zod schema en `packages/shared`). |
| UI Kit | **Tailwind CSS + shadcn/ui** | Componentes copiados al proyecto (no dep npm), accesibles (Radix UI), customizables. |
| Tablas | **TanStack Table v8** | Headless, paginación server-side, filtros, ordenamiento. |
| PWA | **vite-plugin-pwa (Workbox)** | Manifest, service worker, offline cache. |
| Escáner | **@zxing/browser** | Códigos de barras vía cámara. Compatible con la mayoría de formatos (EAN, UPC, Code128). |
| Impresión | **escpos-buffer** + Web Bluetooth | Generación de buffer ESC/POS. Bluetooth para mobile, `window.print()` con CSS @page para desktop. |
| HTTP | **Axios** + interceptors | Refresh token automático, manejo de errores centralizado. |

### 2.3 Tooling

| Herramienta | Para qué |
|---|---|
| **Turborepo** | Cache de builds/tests, ejecución paralela, dependency graph. |
| **pnpm workspaces** | Manejo eficiente de dependencias, dedupe automático. |
| **Biome** | Lint + format ultra-rápido (10x ESLint). Alternativa: ESLint + Prettier si el equipo prefiere ecosistema más maduro. |
| **Husky + lint-staged** | Pre-commit: lint + type-check + tests afectados. |
| **Vitest** | Tests unitarios web (compatible con API de Jest). |
| **Jest + Supertest** | Tests unitarios e integración para API Nest. |
| **Playwright** | E2E para flujos críticos (login, venta completa, importación). |

### 2.4 Infraestructura

| Componente | Stack |
|---|---|
| Servidor | **VPS Vultr High Frequency 2GB, Ciudad de México** (Ubuntu LTS; decidido 2026-08-04 tras descartar Hetzner post-suba de precios; EC2 previa dada de baja) |
| Orquestación local y prod | **Docker Compose** (api, web, postgres, redis, nginx) |
| Proxy reverso | **Nginx** + **Let's Encrypt (certbot)** — HTTPS obligatorio para Web Bluetooth y cámara |
| Imágenes | **GHCR** (privado, gratis con el repo) |
| CI/CD | **GitHub Actions**: lint → test → build → push GHCR → SSH deploy |
| Backups | Cron `pg_dump` cifrado → **Cloudflare R2 / Backblaze B2** (retención 14 días en F0, endurece F6) |
| Logs | **Pino** → archivo con rotación en F0; destino final a revisar en F6 (sin cuenta AWS: Grafana Loki self-hosted o similar) |
| Errores | **Sentry** (frontend + backend con `@sentry/nestjs`) |
| Secretos | `.env.prod` con permisos 600 en F0 (F0-DEPLOY-07); gestor a revisar en F6 (sin cuenta AWS: sops/age o Infisical). Nunca commitear `.env` plano. |

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

catalog_fields     id, tenant_id, catalog_id, key, label,
                   field_type ENUM('text','number','lookup'), lookup_catalog_id NULL,
                   required, position, is_archived, timestamps
                   UNIQUE(catalog_id, key)
                   CHECK: field_type='lookup' ⇔ lookup_catalog_id IS NOT NULL

catalog_records    id, tenant_id, catalog_id, code, attributes JSONB, is_active, timestamps
                   UNIQUE(catalog_id, code) · GIN(attributes)
                   ← SOLO filas de subcatálogos. Los productos NO viven acá.
```

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
  is_purchasable         BOOLEAN NOT NULL DEFAULT TRUE,  -- aparece en Entrada Directa (compras)
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
| **Simple no-compuesto** (`is_composite=false`) | Persistido en `stock_by_warehouse` en `base_unit` | Entrada Directa con presentación de compra (sistema convierte a base_unit) | POS con presentación de venta (sistema convierte) |
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

```
sellpoint/
├── apps/
│   ├── api/                          # NestJS — API REST
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/             # login, register, refresh, logout
│   │   │   │   ├── tenants/          # gestión de tenants y onboarding
│   │   │   │   ├── users/            # CRUD usuarios, roles, permisos
│   │   │   │   ├── catalogs/         # motor de catálogos: catálogos, campos, registros
│   │   │   │   ├── products/         # CRUD productos (validador derivado de campos)
│   │   │   │   ├── warehouses/       # CRUD almacenes
│   │   │   │   ├── inventory/        # entradas, salidas, inventario físico
│   │   │   │   ├── pos/              # ventas, tickets, cierre de caja
│   │   │   │   ├── reports/          # generación + exportación a Excel
│   │   │   │   └── audit/            # kardex, audit log
│   │   │   ├── common/
│   │   │   │   ├── guards/           # JwtAuthGuard, PermissionsGuard
│   │   │   │   ├── decorators/       # @CurrentUser, @RequirePermissions
│   │   │   │   ├── pipes/            # ZodValidationPipe
│   │   │   │   ├── filters/          # AllExceptionsFilter
│   │   │   │   └── interceptors/     # LoggingInterceptor
│   │   │   ├── infrastructure/
│   │   │   │   ├── prisma/           # PrismaService, TenantContextMiddleware
│   │   │   │   ├── redis/
│   │   │   │   ├── mail/             # SES o SendGrid
│   │   │   │   └── storage/          # S3 para imports/exports
│   │   │   ├── config/               # variables de entorno tipadas
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── test/                     # e2e tests
│   │
│   └── web/                          # React + Vite — PWA
│       ├── src/
│       │   ├── features/             # Screaming architecture
│       │   │   ├── auth/
│       │   │   │   ├── components/
│       │   │   │   ├── hooks/
│       │   │   │   └── api.ts
│       │   │   ├── catalog/
│       │   │   ├── inventory/
│       │   │   ├── pos/
│       │   │   └── reports/
│       │   ├── shared/
│       │   │   ├── components/       # shadcn/ui copiados acá
│       │   │   ├── hooks/
│       │   │   ├── lib/
│       │   │   │   ├── api.ts        # axios instance + interceptors
│       │   │   │   ├── auth.ts       # auth store + refresh logic
│       │   │   │   └── utils.ts
│       │   │   └── stores/           # Zustand stores
│       │   ├── routes/               # TanStack Router routes
│       │   ├── main.tsx
│       │   └── App.tsx
│       ├── public/
│       └── vite.config.ts
│
├── packages/
│   ├── shared/                       # Tipos, Zod schemas, constantes
│   │   ├── src/
│   │   │   ├── schemas/              # Zod schemas compartidos
│   │   │   ├── types/                # Tipos comunes
│   │   │   └── constants/
│   │   └── package.json
│   ├── api-client/                   # Cliente HTTP generado desde OpenAPI
│   │   └── src/
│   └── ui/                           # (futuro) componentes compartidos web/mobile
│
├── infrastructure/
│   ├── docker/
│   │   ├── api.Dockerfile            # multi-stage, non-root user
│   │   ├── web.Dockerfile            # nginx + build estático
│   │   └── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── ssl/
│   └── scripts/
│       ├── backup.sh                 # pg_dump → S3 cifrado
│       ├── restore.sh
│       └── deploy.sh
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # lint + test + build
│       └── deploy.yml                # push imágenes + SSH deploy
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
├── .env.example
└── README.md
```

---

## 5. Seguridad

### 5.1 Autenticación

| Control | Implementación |
|---|---|
| Hash de password | **Argon2id** — `memoryCost: 65536, timeCost: 3, parallelism: 4` |
| Access token | **JWT RS256**, vida 15 min, contiene `userId`, `tenantId`, `permissions` |
| Refresh token | Rotativo, en cookie `httpOnly + Secure + SameSite=Strict`, vida 7 días |
| Detección de reuse | Si se reusa un refresh ya rotado → se invalida toda la familia |
| Logout | Marca refresh como revocado en Redis (TTL = remaining lifetime) |
| Throttling login | 5 intentos / 15 min por IP + 10 intentos / hora por email |
| Email enumeration | Respuesta idéntica para email inexistente y password incorrecto |
| Recuperación de password | Token de un solo uso, 30 min de vida, link enviado por email |
| Cambio de password | Invalida TODOS los refresh tokens del usuario |

### 5.2 Autorización

- **RBAC con scoping de dos capas**: roles + permisos definen QUÉ; `user_warehouse_scopes` define DÓNDE (ver § 3.4).
- Roles por tenant: `admin`, `manager`, `pos_seller`, `viewer` (extensibles).
- Permisos granulares (formato `recurso:accion`): `catalogs:read/write/manage`, `products:read/manage`, `warehouses:read/manage`, `inventory:read/movement/manage` (F3: `manage` = cancelar traspaso y aprobar conteo, solo TenantAdmin), `pos:sell`, `reports:view`, `users:manage`, etc.
- Decorator: `@RequirePermissions('inventory:movement')`.
- `TenantAdmin` bypasea el scoping de almacenes; el resto de roles, si tiene scope asignado, queda filtrado automáticamente en repos.

### 5.3 API

| Control | Detalle |
|---|---|
| CORS | Whitelist estricta de origins (dev + prod) |
| Helmet | CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| Rate limit global | 100 req/min por IP |
| Rate limit auth | 10 req/min por IP en `/auth/*` |
| Input validation | Zod vía `ZodValidationPipe` (DTO) + validador derivado de `catalog_fields` (atributos dinámicos) |
| SQL injection | Imposible — Prisma usa queries parametrizadas |
| CSRF | Cookie `SameSite=Strict`. Double-submit token en endpoints sensibles si se requiere |
| Logging | Pino con redacción de `password`, `token`, `authorization`, `cookie` |

### 5.4 Datos

- **PII en reposo:** cifrado a nivel disco (cifrado de disco del VPS). Passwords hasheadas con Argon2id. Sin almacenamiento de tarjetas (integración futura con pasarela tercerizada).
- **Backups cifrados** en S3 con KMS (`SSE-KMS`).
- **Auditoría:** tabla `audit_log` con `who/what/when/before/after` para:
  - Movimientos de inventario
  - Cambios de stock
  - Creación/edición de usuarios
  - Cambios en schemas de producto
  - Logins y logouts

### 5.5 Frontend

- **Access token en memoria** (store Zustand) — nunca `localStorage` ni cookie legible.
- **Refresh automático** vía interceptor de Axios cuando el access expira (status 401).
- **Logout** al cerrar pestaña: el access se pierde, el refresh está en cookie pero invalidado al hacer logout explícito.
- **CSP estricta** en respuesta de Nginx.
- **Sanitización de HTML** en cualquier renderizado de input de usuario (DOMPurify si se renderiza markdown/HTML).

### 5.6 Checklist OWASP Top 10 (2021)

- [x] **A01 Broken Access Control** — Guards Nest + RLS Postgres
- [x] **A02 Cryptographic Failures** — HTTPS forzado, Argon2id, KMS para backups
- [x] **A03 Injection** — Prisma (SQL), Zod (input), validador derivado (JSON dinámico)
- [x] **A04 Insecure Design** — Threat modeling al inicio de cada módulo crítico
- [x] **A05 Security Misconfiguration** — Helmet, CSP, cabeceras revisadas
- [x] **A06 Vulnerable Components** — Dependabot + `pnpm audit` en CI
- [x] **A07 Identification/Auth Failures** — Throttling, refresh rotativo, MFA opcional v2
- [x] **A08 Data Integrity Failures** — Transacciones atómicas, signed JWT
- [x] **A09 Security Logging Failures** — Pino + Sentry + CloudWatch + audit log
- [x] **A10 SSRF** — No se hacen requests salientes a URLs controladas por el usuario

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

### Fase 3 — Movimientos de Inventario (3-4 semanas)

> **Evolución (atomización, 2026-08-17 — detalle en IMPLEMENTACION.md § Fase 3 y `topic_key: sellpoint/f3-atomizacion`).** El diseño se mantiene; se fijan las decisiones que el outline dejaba abiertas y se sube la estimación (kardex con saldo, stock por almacén, conteo completo y guardas heredadas de F2 no estaban contadas).

1. Módulo `inventory` con **2 movimientos directos** + procesos especiales, todos escribiendo por **un único servicio** (`StockLedgerService.apply`): agrupa líneas, bloquea `stock_by_warehouse` con `SELECT … FOR UPDATE` **ordenado por (product_id, warehouse_id)** (anti-deadlock), valida, inserta en `stock_movements` y actualiza saldos en la misma transacción. Entradas, salidas, recepción de traspaso, conteo y (F4) la venta son **llamadores**, nunca escritores propios.
   - **Entrada Directa** con `reason_code` ∈ {`invoice`, `adjustment`, `customer_return`} + `reason_note`; `invoice` exige `reference` (nº de documento) y `unit_cost` por línea. La entrada `transfer` solo existe como **recepción** de un traspaso (con `transfer_id`) desde la vista de tránsito.
   - **Salida Directa** con `reason_code` ∈ {`adjustment`, `transfer`, `loss`, `consumption`, `expired`}; `transfer` pide **almacén destino** (no exige scope del emisor sobre el destino) y crea el `Transfer`.
   - **Inventario físico** (una sola plantilla: `sku` + lote/caducidad/ubicación cuando el producto los controla + teórico + contado, reconciliación en seco, aprobación transaccional) — caso especial separado; **sin bloqueo del almacén**: la aprobación relee el teórico con `FOR UPDATE` y audita el drift.
   - **Lotes, caducidad y ubicación (F3-LOTS, opt-in por producto con `products.tracks_lots`)**: modelo de **dos niveles** — `stock_by_warehouse` sigue siendo el total; `product_lots (product_id, lot_code, expires_at)` porque la caducidad es del lote; `stock_lots (lot_id, warehouse_id, location) → quantity` porque la ubicación parte el stock (texto libre, sin catálogo de racks). Invariante del ledger: `Σ stock_lots == stock_by_warehouse`. En salida sin lote explícito, `apply` reparte **FEFO** (`expires_at ASC NULLS LAST`) en la misma tx y el mismo `FOR UPDATE`; el POS de F4 lo hereda. Quien no activa el flag no ve un lote jamás.
   - **Documentos con estado (F3-DOC, decisiones de Carlos 2026-08-18)**: `inventory_documents` es el **encabezado** de toda operación que toca stock (folio, tipo, **estado**, almacén, motivo, referencia, autorizador, quién y cuándo); `inventory_document_lines` guarda **lo que el usuario capturó** y `stock_movements.document_id` **lo que el ledger hizo** — no es duplicación: FEFO parte una línea en N movimientos y un compuesto la expande en componentes. Ciclo `draft → confirmed` (escribe movimientos y mueve stock) o `draft → canceled` (queda el folio, sin stock). **TRES series por tenant**: `ENT`, `SAL`, `INV`; `VTA` reservada para F4. Un traspaso es una `SAL` con `reason_code='transfer'` y su recepción una `ENT` con el mismo motivo: el motivo viaja dentro del documento, **nunca en el folio**.
   - **Inmutabilidad de lo confirmado**: el documento **no puede blindarse con `REVOKE UPDATE, DELETE`** como `stock_movements`, `units` o `currencies`, porque un borrador se edita. La garantía la da un **trigger `BEFORE UPDATE OR DELETE` que revienta si `OLD.status <> 'draft'`** — el primer trigger del proyecto. `stock_movements` conserva su REVOKE: nace al confirmar y no se toca nunca más.
   - **Folio y borrador**: el folio se toma **al crear el borrador**, en una transacción corta propia (`tenant_sequences` con `INSERT … ON CONFLICT DO UPDATE … RETURNING`), no dentro de la del ledger — el lock de la serie dura milisegundos en vez de todo el posteo, y el mismo patrón le sirve a F4 para tomar folio al abrir el carrito. La serie **no pierde números**: un borrador abandonado queda `canceled` con su folio. Es lo que permite **retomar un movimiento a medio cargar buscándolo por su folio**, incluso desde otra máquina u otro usuario — la razón de que el borrador viva en el servidor y no en el navegador.
   - **El borrador ES la vista previa**: no hay endpoint de previa aparte. `GET /inventory/documents/:id` devuelve las filas resueltas con **`stockBefore`/`stockAfter`**, los lotes nuevos, la expansión de compuestos, el reparto FEFO que se aplicaría y los errores por línea, sin escribir nada. El Excel entra por `POST /inventory/documents/:id/lines/import`, que agrega líneas al borrador.
   - **PDF**: renderizado en el **servidor** con `pdfmake` (pagina la tabla solo y repite el encabezado; un conteo son 500 líneas) y entregado como binario `application/pdf` — no base64 en JSON — porque el front lo baja con axios `responseType: 'blob'`: un `<a href>` plano iría sin el Bearer y daría 401. Encabezado y pie comunes (negocio, folio, tipo, firmas Entregó / Recibió / Autorizó), **cuerpo por tipo**. **Sin total de unidades**: sumar 36 unidades + 2.5 kg no significa nada; el pie cuenta LÍNEAS.
   - El enum `reason_code` nace **completo**: `invoice | adjustment | transfer | customer_return | sale | sale_return | loss | consumption | expired | physical_count` — `sale`/`sale_return` **reservados para F4**; **no hay `production`** (los compuestos nunca tienen stock persistido: salida `consumption`/`expired` expande componentes con la misma fórmula que `availability`; cualquier otro movimiento sobre un compuesto → 409).
2. **Traspaso = proceso de 2 pasos**: Salida Directa con motivo `transfer` → `Transfer` `in_transit` (su folio es el de esa salida, un `SAL-…`; el traspaso no tiene serie propia) → el destino lo ve "pendiente de recibir" → recepción (todas las líneas, en base_unit, `0 ≤ recibido ≤ enviado`, nota obligatoria si hay faltante) → `completed`. La discrepancia se **deriva** de `transfer_lines` (`quantity_sent − quantity_received`), no se guarda como JSONB. **Cancelar** (solo `inventory:manage`) **no devuelve stock** al origen: la salida ya es historia; el reingreso es un `adjustment` explícito.
3. Concurrencia real: transacciones interactivas (`withTenantContext`, READ COMMITTED) + `FOR UPDATE` ordenado + upsert de la fila de stock antes del lock; `Prisma.Decimal` en toda aritmética (nunca `Number()`). Es la **primera** vez del proyecto en ambas cosas: se prueba con transacciones concurrentes contra Postgres real y con un test de propiedad (`stock_by_warehouse == Σentradas − Σsalidas`).
4. Tabla `stock_movements` (kardex) — **append-only por privilegios** (`REVOKE UPDATE, DELETE` a `sellpoint_app`), con `seq BIGINT IDENTITY` como desempate cronológico (`now()` es del inicio de la tx; UUID v4 no ordena), `batch_id` por operación, `parent_product_id` en salidas expandidas, `reference` + `authorized_by` como campos contextuales genéricos, y CHECKs de coherencia (dirección × motivo, `transfer ⇔ linked_warehouse_id`). FKs `RESTRICT` desde movimientos hacia productos, presentaciones y almacenes: el histórico no se borra. Tablas `transfers` + `transfer_lines` para el ciclo de vida. `tenant_sequences` para folios por tenant (reusable por F4).
5. Validaciones: stock no negativo (CHECK como red, el guard es el service), cantidades > 0 con hasta 4 decimales, enteros si la presentación es solo-enteros, traspaso entre almacenes del mismo tenant y distintos, almacén activo, alcance por almacén (`@CurrentUserScope()` — primer consumidor real), stock en tránsito visible.
6. Frontend: 2 pantallas de movimientos (cabecera reactiva por motivo, selector de presentación por línea, disponible en vivo en salida, UX teclado) + vista "Traspasos en tránsito" (dos tabs por scope, modal de recepción, badge > 7 días) + inventario físico en 2 pasos + tabs **Kardex** (con `balanceAfter` server-side) y **Stock por almacén** en el detalle de producto + selector de almacén reusable + UI de alcance por almacén en usuarios (deuda F2-SCOPE-03) + **tres listados por serie** (Entradas, Salidas, Inventario — el mismo componente montado tres veces, con buscador por folio, filtro de estatus y botón de crear) y **una pantalla de documento** que en `draft` es captura con autoguardado y panel de previa, y en `confirmed` es solo lectura con descarga del PDF.
7. Audit log de cada lote de movimientos (usuario, momento, motivo, saldo posterior por línea) y entradas detalladas para discrepancias y drift.
8. **Se cierran los puntos de extensión que F2 dejó para F3**: `assertDeletable` (presentación con movimientos → 409), `products.remove`/`assertBaseUnitChangeable` con movimientos, almacén no desactivable con stock o traspaso abierto (CU-ALM-02), `TenantTransactionsGate.hasTransactions()`, `availability` con scope. Diferidos con nombre: **costo promedio ponderado → F5**, **idempotencia → F4**, **backdating → F5 si se pide**. (Lote/caducidad/ubicación se habían diferido a Fase 9 y **entraron a F3 el mismo día** sobre un Excel real de cliente — ver F3-LOTS.)

**Permisos:** `inventory:read` (kardex, stock, tránsito — Viewer automático), `inventory:movement` (entradas, salidas, recepción, conteo — Manager), `inventory:manage` (cancelar traspaso, aprobar conteo — solo TenantAdmin).

**Entregable:** se puede mover stock entre almacenes con trazabilidad total, sin oversell bajo concurrencia, con stock en tránsito visible y kardex con saldo por almacén.

### Fase 4 — POS PWA (3 semanas)

1. Módulo `pos`: ventas, tickets, cierre de caja, descuento de stock atómico
2. PWA: manifest, service worker (vite-plugin-pwa), offline básico
3. Carrito con búsqueda predictiva (debounced) + escáner cámara (@zxing/browser)
4. Impresión:
   - Desktop: `window.print()` con CSS @page optimizado para 58/80mm
   - Mobile: Web Bluetooth API → buffer ESC/POS con `escpos-buffer`
5. Pantalla de cierre de caja con totales por método de pago

**Entregable:** vendedor puede operar el POS desde tablet con escáner e impresora térmica.

### Fase 5 — Reportes (1-2 semanas)

1. Reportes mínimos:
   - Stock por almacén
   - Catálogo de productos
   - Catálogo de almacenes
   - Usuarios del sistema
   - Ventas por período
   - Kardex por producto
2. Frontend: TanStack Table con paginación, filtros, ordenamiento server-side
3. Exportación a Excel (`exceljs`)
4. (Opcional) Generación asíncrona en background con cola Redis para reportes pesados

**Entregable:** todos los reportes solicitados en los requerimientos originales, visibles en sistema y descargables.

### Fase 6 — Hardening de Producción (1 semana)

1. Dockerfiles productivos: multi-stage, non-root user, sin dependencias de dev
2. `docker-compose.prod.yml` con Nginx + certbot + healthchecks
3. CI/CD: GitHub Actions → GHCR → SSH deploy al VPS (Vultr CDMX)
4. Cron de backups a S3 cifrado
5. Sentry + CloudWatch
6. Smoke tests post-deploy
7. Documentación de runbook (cómo desplegar, rollback, restore)

**Entregable:** sistema corriendo en EC2 con HTTPS, backups y monitoreo.

### Fase 7 — Planes + Billing + Suscripciones (3-4 semanas)

1. Modelo de `plans` (Chica/Mediana/Empresa) con dimensiones de límite (`max_users`, `max_warehouses`)
2. `subscriptions` por tenant con estados: trial → active → past_due → canceled
3. Integración Stripe vía `PaymentGatewayPort` (adapter pattern) — extensible a MercadoPago en el futuro
4. Trial de 14 días sin tarjeta + dunning con grace period de 7 días → read-only
5. Webhooks idempotentes (`webhook_events` con unique key) procesados async vía BullMQ
6. Guards de límite (`@CheckLimit('max_users')`) aplicados retroactivamente a endpoints existentes
7. Vistas: SuperAdmin (MRR/ARR, override manual), TenantAdmin (mi plan, métodos de pago, historial)
8. Facturación fiscal (CFDI/SAT, AFIP, DIAN) **fuera de scope MVP** — integración futura con Facturapi/PAC cuando lo pida el primer cliente

**Entregable:** monetización activa, tenants en planes pagos con suscripciones recurrentes.

### Fase 8 — Mobile (futuro)

- **Expo + React Native** consumiendo la misma API
- Reutiliza `packages/shared` y `packages/api-client`
- Considerar **Tamagui** o solución similar para `packages/ui` compartido
- Fuera del MVP

### Fase 9+ — Extensiones Verticales y Módulos Avanzados (futuro, fuera de MVP)

> Módulos opcionales activables por tenant (add-ons sobre el plan base). Se construyen **sobre el core** sin modificarlo. Los add-ons se ofrecen como `subscription_items` adicionales en Stripe — el TenantAdmin los activa/desactiva en `/settings/modules` en cualquier momento, **no obligatoriamente en el onboarding**.

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

**Crítico:** este diseño NO requiere cambios en el core actual. Los módulos se agregan como activables independientes que **referencian** el catálogo, el POS y las ventas existentes. El POS de Fase 4 debe diseñarse con **input principal extensible** (strategy pattern: `SkuLookup`, `BarcodeLookup`, `TextSearchLookup`, futuro `QuoteLookup`, `PrescriptionLookup`) para no requerir refactor cuando llegue Fase 9.

#### 9.5 Modelo de pricing de los add-ons

Cada módulo activable es un **add-on con precio mensual/anual independiente** del plan base:

| Plan base | Incluye |
|---|---|
| Chica / Mediana / Empresa | Catálogo, almacenes, movimientos, POS, reportes — **todo el core** |

| Add-on | Precio orientativo |
|---|---|
| Cotizador / Pedidos | +$X/mes |
| Gastronomía Avanzada (KDS, modificadores) | +$Y/mes |
| Vertical Consultorio Médico | +$Z/mes |
| Vertical Consultorio Dental | +$Z/mes |
| Vertical Óptica | +$Z/mes |
| Vertical Taller Mecánico | +$Z/mes |

En Stripe se modelan como `subscription_items` adicionales — agregar/quitar un add-on proratea automáticamente.

---

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
| **Currencies soportadas (MVP)** | `MXN`, `USD` | Extensible: agregar nuevas = agregar entry en tabla `currencies` + Stripe Prices. |
| **Detección inicial de idioma** | `Accept-Language` del browser al signup; editable en perfil | UX correcta. |
| **Resolución de locale en API** | `user.locale` (si autenticado) → `Accept-Language` (público) → `es` (default) | Predecible y testeable. |
| **Cambio de currency** | Bloqueado si el tenant ya tiene transacciones | Sin tasas de cambio no podemos convertir movimientos históricos. |
| **Lib backend** | `nestjs-i18n` | Estándar Nest, integra con guards/filters/pipes/validaciones. |
| **Lib frontend** | `react-i18next` + namespaces por dominio | Estándar React, lazy-load por ruta. |
| **Catalog data (productos)** | **NO se traduce** en MVP | Es data del tenant. Si en el futuro un tenant necesita catálogo bilingüe, fase aparte. |
| **Tasas de cambio** | No se implementan | El diseño per-tenant las hace innecesarias. |
| **Billing currency** | Independiente de la operacional | Tenant MX puede operar en MXN y pagar Stripe en USD si quiere (Stripe maneja multi-currency). |

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

### 7.6 Stripe — multi-currency en billing

- Cada `plans.code` tiene **2 `Price` por ciclo** en Stripe: uno en MXN y otro en USD (4 prices por plan: monthly_MXN, monthly_USD, annual_MXN, annual_USD).
- Al onboarding, el tenant elige la `currency` operacional. Esa es **también** la moneda de su suscripción por default — pero puede cambiarla en `/settings/billing`.
- La conversión MXN↔USD en billing la maneja **Stripe**: no hay tasas en nuestra DB. Si el tenant cambia de currency en billing, Stripe genera invoice de cierre + invoice nueva con prorating.

### 7.7 Limitaciones explícitas (out of scope MVP)

- ❌ Conversión de moneda entre tenants o usuarios — no hay tasas de cambio.
- ❌ Catalog data multilingüe (un producto con `name_es` y `name_en`) — el tenant carga su catálogo en su idioma.
- ❌ Idiomas RTL (árabe, hebreo) — requeriría layouts CSS especiales y testing dedicado.
- ❌ Facturación fiscal multi-jurisdicción (CFDI MX, AFIP AR, etc.) — fase futura cuando el cliente lo exija.
- ❌ Pluralización compleja (idiomas con múltiples formas plurales) — `react-i18next` lo soporta nativamente cuando lo necesitemos.

---

## 8. Variables de Entorno

### `apps/api/.env.example`

```bash
# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://sellpoint:sellpoint@localhost:5432/sellpoint?schema=public

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_PRIVATE_KEY_PATH=./keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=./keys/jwt-public.pem
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Cookies
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false  # true en prod

# CORS
CORS_ORIGINS=http://localhost:5173

# Mail (SES o SendGrid)
MAIL_FROM=noreply@sellpoint.app
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# AWS (prod)
AWS_REGION=us-east-1
S3_BACKUPS_BUCKET=sellpoint-backups

# Sentry
SENTRY_DSN=

# Logs
LOG_LEVEL=info

# i18n
DEFAULT_LOCALE=es
SUPPORTED_LOCALES=es,en

# Currency
DEFAULT_CURRENCY=MXN
SUPPORTED_CURRENCIES=MXN,USD
```

### `apps/web/.env.example`

```bash
VITE_API_URL=http://localhost:3000
VITE_SENTRY_DSN=
VITE_DEFAULT_LOCALE=es
VITE_SUPPORTED_LOCALES=es,en
```

> **Importante:** En producción, los secretos viven en **AWS Parameter Store** (SecureString con KMS), no en `.env` plano. Los servicios los leen en startup o vía sidecar.

---

## 9. Comandos de Inicio Rápido

### Primera vez

```bash
# Clonar e instalar
git clone <repo>
cd sellpoint
pnpm install

# Copiar envs
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Generar par de claves JWT
mkdir -p apps/api/keys
openssl genpkey -algorithm RSA -out apps/api/keys/jwt-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in apps/api/keys/jwt-private.pem -out apps/api/keys/jwt-public.pem

# Levantar Postgres + Redis
docker compose -f infrastructure/docker-compose.dev.yml up -d postgres redis

# Migraciones + seed
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
```

### Día a día

```bash
# Levantar todo en dev (api + web)
pnpm dev

# Solo API
pnpm --filter api dev

# Solo Web
pnpm --filter web dev

# Tests
pnpm test           # todos
pnpm --filter api test
pnpm --filter web test

# Lint + format
pnpm lint
pnpm format

# Type-check
pnpm type-check

# Build producción
pnpm build

# Prisma
pnpm --filter api prisma migrate dev --name <nombre>
pnpm --filter api prisma studio
```

### Producción (EC2)

```bash
# Deploy manual
./infrastructure/scripts/deploy.sh

# Backup manual
./infrastructure/scripts/backup.sh

# Restore
./infrastructure/scripts/restore.sh <backup-file>
```

---

## 10. Glosario del Dominio

| Término | Definición |
|---|---|
| **Tenant** | Cliente del SaaS. Cada tenant tiene sus propios usuarios, datos, productos y schemas. Aislamiento total. |
| **Product Schema** | Definición (JSON Schema) de los campos custom que un tenant decide tener en sus productos. Versionable. |
| **Almacén** | Ubicación física donde se guarda stock. Un tenant puede tener N almacenes. |
| **Movimiento** | Cualquier cambio de stock: Entrada Directa, Salida Directa o Inventario físico. Registrado append-only en `stock_movements` (kardex), colgando siempre de un **documento**. |
| **Documento de inventario** | El **encabezado** de una operación que toca stock (`inventory_documents`): folio, tipo, **estado**, almacén, motivo, referencia, quién y cuándo. Sus líneas capturadas viven en `inventory_document_lines` y lo que el ledger asentó en los `stock_movements` que comparten `document_id`. Es lo que se lista, se busca por folio y se imprime en PDF. Mientras es **borrador** se edita; una vez **confirmado** es intocable (lo impone un trigger) — corregirlo es registrar otro movimiento. |
| **Folio** | El número humano de un documento, `PREFIJO-000001`, con **tres series por tenant**: `ENT` Entrada Directa, `SAL` Salida Directa, `INV` Inventario físico (`VTA` reservado para las ventas de F4). Un traspaso es un `SAL` y su recepción un `ENT`: el motivo no cambia la serie. Se asigna **al crear el borrador**, que es lo que permite retomarlo después. La serie no pierde números: lo abandonado queda anulado con su folio. |
| **Borrador** | Un documento en estado `draft`: tiene folio, se edita, se guarda solo y **se retoma por su folio** aunque se cierre el sistema o lo continúe otro usuario. Todavía no movió stock. Al confirmarlo nacen los movimientos; al abandonarlo queda anulado. |
| **Vista previa** | No es una pantalla aparte: es el **detalle del borrador**, que resuelve y valida sus líneas y devuelve **el stock actual y el resultante por línea** sin tocar nada. Es lo que evita confirmar a ciegas una entrada de 80 productos. |
| **Entrada Directa** | Movimiento de entrada de stock a un almacén con un **motivo** (`reason_code`): factura (`invoice`, exige referencia y costo unitario), ajuste, devolución de cliente. La entrada con motivo traspaso es la **recepción** de un `Transfer` y se hace desde la vista de tránsito. `sale_return` queda reservado para F4. |
| **Salida Directa** | Movimiento de salida de stock de un almacén con un **motivo**: ajuste, traspaso, merma, pérdida, consumo interno, caducado, etc. Si el motivo es traspaso, pide almacén destino. |
| **Traspaso** | Proceso de 2 pasos entre dos almacenes del mismo tenant: (1) Salida Directa motivo traspaso → crea `Transfer` con estado `in_transit` cuyo documento de despacho es una **Salida Directa con motivo traspaso** (`SAL-000019`) — el traspaso no tiene folio ni serie propios; (2) recepción en el destino (desde la vista de tránsito, todas las líneas, `0 ≤ recibido ≤ enviado`) → `Transfer` pasa a `completed`; la recepción es un borrador de **Entrada Directa** con motivo traspaso (`ENT-000043`) precargado con lo enviado, ligado al mismo traspaso. La discrepancia se deriva de las líneas y queda auditada. **Cancelar (solo TenantAdmin) no devuelve stock al origen**: el reingreso es un `adjustment` explícito. |
| **Stock en tránsito** | Stock que salió del almacén origen pero todavía no fue confirmado por el destino. Visible en reportes y en la vista "Traspasos en tránsito". |
| **Inventario físico** | Conteo real del almacén con **una** plantilla: `sku` (+ lote/caducidad/ubicación en los productos que los controlan) + teórico + contado; una fila por (lote, ubicación) cuando aplica; un lote nuevo se crea al aprobar. Reconciliación en seco y aprobación (solo `inventory:manage`) que, para cada línea con diferencia, genera salida del teórico + entrada del contado con `reason_code='physical_count'`. **Sin bloqueo del almacén**: la aprobación relee con `FOR UPDATE` y audita el drift. Caso especial, separado de Entrada/Salida Directa. |
| **Kardex** | Histórico completo de movimientos de un producto. Trazabilidad total. Con lote, caducidad y ubicación por línea cuando el producto los controla, y el **folio** del documento que originó cada línea. |
| **Lote** | Partida de un producto con un `lot_code` único por producto y una **caducidad propia del lote** (`expires_at`, opcional). Solo existe para productos con `tracks_lots = true` (opt-in). Su stock se guarda en `stock_lots` por almacén y **ubicación** (texto libre; la ubicación parte el stock), y la suma siempre iguala al total de `stock_by_warehouse`. |
| **FEFO** | *First Expired, First Out*: en una salida (incluida la venta del POS) de un producto con lotes, el ledger descuenta primero del lote que **vence antes** (`expires_at ASC`, los sin fecha al final). El usuario puede forzar un lote concreto. Es genérico: lo usa una farmacia con medicinas, una tienda con alimentos o una refaccionaria con partidas. |
| **Vertical** | Especialización del sistema para un rubro específico (farmacia, consultorio, óptica, gastronomía, etc.). El core es vertical-agnóstico; los verticales se agregan como add-ons opcionales en Fase 9+. |
| **Add-on / Módulo activable** | Módulo opcional que un tenant activa en `/settings/modules` con precio independiente del plan base. Stripe lo modela como `subscription_item` adicional (Fase 7 + Fase 9). |
| **Cotización / Pedido** | Documento previo a la venta con folio, líneas de productos del catálogo, validez y estados (draft → sent → approved → converted). Aplica a cualquier vertical B2B o consultivo. Tabla `quotes` (Fase 9). |
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
