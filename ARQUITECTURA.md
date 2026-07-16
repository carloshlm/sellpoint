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
- **Movimientos:** Entrada Directa, Salida Directa (ambas con motivo: factura, ajuste, traspaso, devolución, merma, etc.), Inventario físico. Los traspasos son un **proceso de 2 pasos con confirmación**: la salida deja stock "en tránsito" hasta que el almacén destino confirma la entrada.
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
| Validación | **class-validator** + **Ajv** | class-validator para DTOs estáticos. Ajv para validar JSONB dinámico contra el schema del tenant. |
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
| Servidor | **EC2 Ubuntu 22.04 LTS** (ya disponible) |
| Orquestación local y prod | **Docker Compose** (api, web, postgres, redis, nginx) |
| Proxy reverso | **Nginx** + **Let's Encrypt (certbot)** — HTTPS obligatorio para Web Bluetooth y cámara |
| Imágenes | **Amazon ECR** (privado) |
| CI/CD | **GitHub Actions**: lint → test → build → push ECR → SSH deploy |
| Backups | Cron `pg_dump` cifrado → **S3** con lifecycle a Glacier (90 días) |
| Logs | **Pino** → **CloudWatch** (vía agent o sidecar) |
| Errores | **Sentry** (frontend + backend con `@sentry/nestjs`) |
| Secretos | **AWS Parameter Store** (SecureString con KMS). Nunca commitear `.env` plano. |

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

### 3.3 Esquemas de producto dinámicos

Cada tenant define **qué campos tienen sus productos**.

#### Tablas principales

```prisma
model ProductSchema {
  id        String   @id @default(uuid())
  tenantId  String
  version   Int      @default(1)
  // JSON Schema (draft-07) que describe los campos custom
  schema    Json
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  tenant    Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, version])
}

model Product {
  id          String   @id @default(uuid())
  tenantId    String
  sku         String
  barcode     String?
  name        String
  price       Decimal  @db.Decimal(12, 2)
  stockMin    Int      @default(0)
  // Atributos custom según ProductSchema del tenant
  attributes  Json     @default("{}")
  // ...
  tenant      Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, sku])
  @@index([tenantId, barcode])
  // GIN para queries dentro de JSONB
  @@index([attributes], type: Gin)
}
```

#### Ejemplo: Schema para farmacia

```json
{
  "type": "object",
  "required": ["sustancia_activa", "laboratorio"],
  "properties": {
    "sustancia_activa": { "type": "string" },
    "laboratorio": { "type": "string" },
    "forma_farmaceutica": {
      "type": "string",
      "enum": ["Tableta", "Cápsula", "Solución", "Comprimido", "Suspensión", "Gel"]
    },
    "tipo_medicamento": { "type": "string", "enum": ["Genérico", "Patente"] },
    "registro_ssa": { "type": "string" },
    "grupo_lgs_226": { "type": "string", "enum": ["I", "II", "III", "IV", "V"] }
  }
}
```

#### Validación en runtime

Al crear/actualizar un producto, el service valida `attributes` contra el schema activo del tenant usando **Ajv**:

```typescript
async create(dto: CreateProductDto, tenantId: string) {
  const schema = await this.schemaRepo.findActive(tenantId);
  const validate = this.ajv.compile(schema.schema);
  if (!validate(dto.attributes)) {
    throw new BadRequestException({
      message: 'Validación de atributos fallida',
      errors: validate.errors,
    });
  }
  return this.prisma.product.create({ data: { ...dto, tenantId } });
}
```

#### Frontend dinámico

El frontend obtiene el schema del tenant en login y renderiza formularios dinámicos:

```typescript
const { data: schema } = useQuery({
  queryKey: ['product-schema'],
  queryFn: () => api.productSchemas.getActive(),
});

return <DynamicForm schema={schema} onSubmit={handleSubmit} />;
```

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

> Este modelo es **parte del core** desde Fase 2. Cubre desde productos simples (caja de pastillas vendida entera) hasta productos a granel (café molido por gramo) y productos compuestos (café latte = leche + café + azúcar).

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

-- Composición / Receta (BOM)
CREATE TABLE product_compositions (
  id                   UUID PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  parent_product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_product_id UUID NOT NULL REFERENCES products(id),
  quantity             DECIMAL(14,4) NOT NULL,    -- en base_unit del ingrediente
  waste_percentage     DECIMAL(5,2) NOT NULL DEFAULT 0,  -- merma de preparación (0-100)
  notes                TEXT NULL,
  UNIQUE (parent_product_id, ingredient_product_id),
  CHECK (parent_product_id != ingredient_product_id)
);

-- Stock: DECIMAL en lugar de INTEGER para soportar fracciones
ALTER TABLE stock_movements   ALTER COLUMN quantity TYPE DECIMAL(14,4);
ALTER TABLE stock_by_warehouse ALTER COLUMN quantity TYPE DECIMAL(14,4);
```

#### Reglas operativas

| Tipo de producto | Stock | Reposición | Venta |
|---|---|---|---|
| **Simple no-compuesto** (`is_composite=false`) | Persistido en `stock_by_warehouse` en `base_unit` | Entrada Directa con presentación de compra (sistema convierte a base_unit) | POS con presentación de venta (sistema convierte) |
| **Compuesto** (`is_composite=true`) | **NO se persiste.** Se **calcula** en vivo: `min(stock_ingrediente_i / qty_requerida_i)` para cada ingrediente | NO se "compra" — se prepara automáticamente al venderse | POS expande la receta y descuenta los ingredientes en transacción atómica |

#### Conversiones entre unidades

- **Dentro de la misma categoría** (ej: `l → ml`, `kg → gr`): conversión automática. El sistema sabe que `1 l = 1000 ml`.
- **Entre categorías** (ej: `ml → gr` para café): **NO se hace.** Depende de la densidad y eso es responsabilidad del usuario al definir presentaciones.

> Si una cafetería compra café molido en bolsa de 250 gr y vende lattes que usan 18 gr cada uno, ambos están en `gr` → cero conversión necesaria. Simple.

#### Validaciones críticas

1. **Recursión en BOM**: un compuesto no puede ser ingrediente de sí mismo (directo o indirecto vía grafo). Se valida con DFS al guardar.
2. **Cambio de `base_unit`**: bloqueado si el producto tiene stock > 0 o es ingrediente de otro producto. Sería ambiguo cambiarla.
3. **Borrado de producto**: bloqueado si es ingrediente de otro (FK + mensaje claro).
4. **Stock negativo**: bloqueado en cualquier movimiento que lo cause. En productos compuestos, falla la venta si CUALQUIER ingrediente no tiene stock suficiente.
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

El TenantAdmin gestiona presentaciones y recetas con la **mínima fricción posible**:
- **Presentaciones**: tabla inline en el form de Producto. Una fila por presentación. Botón "+ Agregar presentación".
- **Receta**: tab "Receta" visible solo si `is_composite=true`. Tabla con `Ingrediente | Cantidad | Unidad | ✕`. Picker de productos con autocompletado. Costo y disponibilidad estimados en vivo.
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
│   │   │   │   ├── product-schemas/  # editor de schemas dinámicos
│   │   │   │   ├── products/         # CRUD productos con validación Ajv
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
- Permisos granulares (formato `recurso:accion`): `catalog:read`, `catalog:write`, `inventory:movement`, `pos:sell`, `reports:view`, `users:manage`, etc.
- Decorator: `@RequirePermissions('inventory:movement')`.
- `TenantAdmin` bypasea el scoping de almacenes; el resto de roles, si tiene scope asignado, queda filtrado automáticamente en repos.

### 5.3 API

| Control | Detalle |
|---|---|
| CORS | Whitelist estricta de origins (dev + prod) |
| Helmet | CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| Rate limit global | 100 req/min por IP |
| Rate limit auth | 10 req/min por IP en `/auth/*` |
| Input validation | class-validator (DTO) + Ajv (atributos dinámicos) |
| SQL injection | Imposible — Prisma usa queries parametrizadas |
| CSRF | Cookie `SameSite=Strict`. Double-submit token en endpoints sensibles si se requiere |
| Logging | Pino con redacción de `password`, `token`, `authorization`, `cookie` |

### 5.4 Datos

- **PII en reposo:** cifrado a nivel disco (EBS encryption en EC2). Passwords hasheadas con Argon2id. Sin almacenamiento de tarjetas (integración futura con pasarela tercerizada).
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
- [x] **A03 Injection** — Prisma (SQL), Ajv (JSON), class-validator (input)
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

### Fase 2 — Catálogos Dinámicos + UOM + BOM (3-4 semanas)

1. Módulo `product-schemas`: CRUD + versionado + validación del JSON Schema mismo
2. Módulo `units`: catálogo global de unidades (`ml`, `l`, `gr`, `kg`, `unit`, `m`, `cm`, etc.) + seed inicial
3. Módulo `products`: CRUD con validación Ajv dinámica + columnas `base_unit` y `is_composite`
4. Módulo `product-presentations`: CRUD de presentaciones por producto (caja, vaso, granel, etc. con factor a `base_unit`, flags purchasable/sellable, barcode, precio, costo)
5. Módulo `product-compositions` (BOM): CRUD de recetas con validación anti-recursión (DFS) y stock calculado en vivo para productos compuestos
6. Módulo `warehouses`: CRUD
7. Frontend: editor visual de schema (drag & drop campos, tipos, validaciones)
8. Frontend: formularios dinámicos para productos con tabs **Información**, **Presentaciones**, **Receta** (solo si `is_composite`)
9. Importación masiva desde Excel con validación fila por fila + reporte de errores (incluye presentaciones y composición)
10. Búsqueda full-text en productos (Postgres `tsvector` o `pg_trgm`) — busca por nombre, SKU y barcodes de cualquier presentación

**Entregable:** un admin puede definir el schema de su vertical, crear productos simples, productos a granel (con stock decimal), productos compuestos (con receta), y todas sus presentaciones de compra/venta.

### Fase 3 — Movimientos de Inventario (2-3 semanas)

1. Módulo `inventory` con **2 movimientos directos** + procesos especiales:
   - **Entrada Directa** con campo `reason_code` (factura, ajuste, traspaso, devolución de cliente, producción, etc.) + `reason_note`
   - **Salida Directa** con `reason_code` (ajuste, traspaso, merma, pérdida, consumo interno, caducado, etc.) + `reason_note`
   - Cuando `reason_code='transfer'`: la Salida pide **almacén destino** y la Entrada pide **almacén origen** (vinculados a un `transfer_id`)
   - **Inventario físico** (carga Excel + reconciliación con discrepancias) — caso especial separado
2. **Traspaso = proceso de 2 pasos**: Salida con motivo Traspaso → crea `Transfer` con estado `in_transit` → almacén destino lo ve como "pendiente de recibir" → Entrada con motivo Traspaso lo confirma → `Transfer` pasa a `completed`. Si hay diferencias en cantidades recibidas, se registran como discrepancia auditada.
3. Transacciones atómicas Postgres para no perder stock en concurrencia
4. Tabla `stock_movements` (kardex) — append-only. Tabla `transfers` para el ciclo de vida del traspaso (estado, vinculación de movimientos).
5. Validaciones: stock no negativo, cantidades > 0, traspaso entre almacenes del mismo tenant, stock en tránsito visible en reportes
6. Frontend: 2 pantallas de movimientos + vista "Traspasos en tránsito" (pendientes de enviar/recibir) + UX optimizada para teclado
7. Audit log de cada movimiento (usuario, timestamp, motivo, antes/después)

**Entregable:** se puede mover stock entre almacenes con trazabilidad total y stock en tránsito visible.

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
3. CI/CD: GitHub Actions → ECR → SSH deploy a EC2
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
| **Movimiento** | Cualquier cambio de stock: Entrada Directa, Salida Directa o Inventario físico. Registrado append-only en `stock_movements` (kardex). |
| **Entrada Directa** | Movimiento de entrada de stock a un almacén con un **motivo** (`reason_code`): factura, ajuste, traspaso, devolución de cliente, producción, etc. Si el motivo es traspaso, pide almacén origen. |
| **Salida Directa** | Movimiento de salida de stock de un almacén con un **motivo**: ajuste, traspaso, merma, pérdida, consumo interno, caducado, etc. Si el motivo es traspaso, pide almacén destino. |
| **Traspaso** | Proceso de 2 pasos entre dos almacenes del mismo tenant: (1) Salida Directa motivo traspaso → crea `Transfer` con estado `in_transit`; (2) Entrada Directa motivo traspaso en el destino confirma la recepción → `Transfer` pasa a `completed`. Discrepancias en cantidades quedan auditadas. |
| **Stock en tránsito** | Stock que salió del almacén origen pero todavía no fue confirmado por el destino. Visible en reportes y en la vista "Traspasos en tránsito". |
| **Inventario físico** | Conteo real del almacén. Sistema genera salida del stock teórico + entrada del stock real. Reporta discrepancias. Caso especial, separado de Entrada/Salida Directa. |
| **Kardex** | Histórico completo de movimientos de un producto. Trazabilidad total. |
| **Vertical** | Especialización del sistema para un rubro específico (farmacia, consultorio, óptica, gastronomía, etc.). El core es vertical-agnóstico; los verticales se agregan como add-ons opcionales en Fase 9+. |
| **Add-on / Módulo activable** | Módulo opcional que un tenant activa en `/settings/modules` con precio independiente del plan base. Stripe lo modela como `subscription_item` adicional (Fase 7 + Fase 9). |
| **Cotización / Pedido** | Documento previo a la venta con folio, líneas de productos del catálogo, validez y estados (draft → sent → approved → converted). Aplica a cualquier vertical B2B o consultivo. Tabla `quotes` (Fase 9). |
| **Prescripción / Documento clínico** | Documento generado por un módulo vertical clínico (receta médica, plan dental, receta óptica, orden de servicio) con un **folio** que se referencia en el POS para pre-cargar las líneas de la venta. Tabla `clinical_documents` (Fase 9+). |
| **Folio de prescripción / cotización** | Identificador único del documento. Input opcional en el POS que busca el documento y pre-carga el carrito. |
| **Unidad base (`base_unit`)** | Unidad de medida interna en la que se guarda el stock de un producto (`unit`, `ml`, `gr`, `kg`, `l`, `m`, `cm`, etc.). Invariable una vez que el producto tiene stock o es ingrediente de otro. Definida en Fase 2. |
| **Presentación** | Cómo se compra o vende un producto (Caja 1L, Vaso 200ml, Granel por gr, etc.) con un **factor** de conversión a la `base_unit`. Un mismo producto puede tener N presentaciones — algunas comprables al proveedor, otras vendibles al cliente, otras ambas. Tabla `product_presentations` (Fase 2). |
| **Producto compuesto / BOM (Bill of Materials)** | Producto vendible que se construye a partir de N ingredientes del catálogo con cantidades específicas en la `base_unit` del ingrediente (ej: un café latte = 200 ml de "Leche Lala" + 18 gr de "Café molido premium"). El producto compuesto **no persiste stock propio** — su disponibilidad se calcula en vivo desde el stock de sus ingredientes. Al venderse, el POS descuenta los ingredientes en transacción atómica. Tabla `product_compositions` (Fase 2 del core). |
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
