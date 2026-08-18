# SellPoint — Casos de Uso

> Define **quién** hace **qué** en el sistema. Cada caso de uso identifica el actor, la precondición, el flujo principal, los flujos alternativos y la postcondición.

---

## Tabla de Contenidos

1. [Actores del Sistema](#1-actores-del-sistema)
2. [Matriz de Permisos](#2-matriz-de-permisos)
3. [Casos de Uso por Módulo](#3-casos-de-uso-por-módulo)
   - [3.1 Autenticación y Onboarding](#31-autenticación-y-onboarding)
   - [3.2 Sistema (Usuarios y Roles)](#32-sistema-usuarios-y-roles)
   - [3.3 Catálogo](#33-catálogo)
   - [3.4 Almacenes](#34-almacenes)
   - [3.5 Movimientos de Inventario](#35-movimientos-de-inventario)
   - [3.6 Punto de Venta](#36-punto-de-venta)
   - [3.7 Reportes](#37-reportes)

---

## 1. Actores del Sistema

| Actor | Descripción | Alcance |
|---|---|---|
| **SuperAdmin** | Equipo de SellPoint. Administra la plataforma, los tenants, planes y soporte. | Cross-tenant (no participa en operaciones diarias del cliente) |
| **TenantAdmin** | Propietario o administrador del negocio cliente. Configura todo el sistema para su tenant. | Su tenant — acceso total |
| **Manager** | Encargado operativo. Gestiona catálogo, inventario, almacenes y reportes. NO administra usuarios ni schemas. | Su tenant — operaciones |
| **POS_Seller** | Vendedor de mostrador. Solo opera el punto de venta. | Su tenant — solo POS |
| **Viewer** | Consulta. Auditor o supervisor que ve reportes pero no modifica datos. | Su tenant — solo lectura |

> Los roles **`Manager`**, **`POS_Seller`** y **`Viewer`** son configurables: el `TenantAdmin` puede crear roles custom combinando permisos granulares.

### 1.1 Alcance por almacén (scoping)

Además del rol, cada usuario tiene un **alcance opcional por almacén** que define **dónde** puede ejecutar las acciones que su rol permite:

| Caso | Comportamiento |
|---|---|
| `TenantAdmin` | **Siempre bypasea el scoping.** Ve y opera todos los almacenes del tenant. |
| Otro rol sin scope asignado | Default permisivo: ve todos los almacenes. Útil para tenants chicos (un solo almacén). |
| Otro rol con scope asignado | Solo ve y opera los almacenes específicos asignados. El resto es invisible para él. |

**Ejemplos:**
- Cadena con 10 sucursales: cada Manager se asigna a 1 sucursal → solo ve su stock, sus ventas, sus reportes.
- Gerente regional Sur: scope `[Sucursal A, B, C]` → opera 3 almacenes.
- Auditor externo: rol `Viewer` sin scope → lee toda la cadena en modo solo lectura.

Detalle técnico en [ARQUITECTURA.md § 3.4](ARQUITECTURA.md#34-alcance-de-usuarios-por-almacén-multi-sucursal).

---

## 2. Matriz de Permisos

> `✅` = puede ejecutarlo · `👁` = solo lectura · `❌` = sin acceso

| Módulo / Acción | SuperAdmin | TenantAdmin | Manager | POS_Seller | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| **Plataforma** |  |  |  |  |  |
| Gestionar tenants (crear/suspender) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ver métricas globales del SaaS | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Sistema (dentro del tenant)** |  |  |  |  |  |
| Gestionar usuarios | ❌ | ✅ | ❌ | ❌ | ❌ |
| Gestionar roles y permisos | ❌ | ✅ | ❌ | ❌ | ❌ |
| Cambiar mi password | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Catálogo** |  |  |  |  |  |
| Definir/editar campos de los catálogos | ❌ | ✅ | ❌ | ❌ | ❌ |
| CRUD de productos | ❌ | ✅ | ✅ | 👁 | 👁 |
| Definir unidad base y presentaciones | ❌ | ✅ | ✅ | ❌ | ❌ |
| Definir composición (producto compuesto / BOM) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Importar productos desde Excel | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Almacenes** |  |  |  |  |  |
| CRUD de almacenes | ❌ | ✅ | ✅ | 👁 | 👁 |
| **Movimientos** |  |  |  |  |  |
| Entrada (cualquier motivo) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Salida (cualquier motivo) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Confirmar recepción de traspaso | ❌ | ✅ | ✅ | ❌ | ❌ |
| Ver traspasos en tránsito | ❌ | ✅ | ✅ | 👁 | 👁 |
| Inventario físico (plantilla + reconciliar) | ❌ | ✅ | ✅ | ❌ | ❌ |
| Inventario físico (**aprobar**) · Cancelar traspaso | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ver kardex | ❌ | ✅ | ✅ | 👁 | 👁 |
| **POS** |  |  |  |  |  |
| Operar POS (vender) | ❌ | ✅ | ✅ | ✅ | ❌ |
| Cierre de caja | ❌ | ✅ | ✅ | ✅ | ❌ |
| Anular venta | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Reportes** |  |  |  |  |  |
| Ver todos los reportes | ❌ | ✅ | ✅ | ❌ | ✅ |
| Exportar a Excel | ❌ | ✅ | ✅ | ❌ | ✅ |

> **Nota sobre alcance:** los permisos definen QUÉ acciones puede ejecutar el usuario. El **alcance por almacén** (ver § 1.1) determina DÓNDE puede ejecutarlas. Un `Manager` con permiso `inventory:movement` y scope `[Sucursal Centro]` solo puede mover inventario **en Sucursal Centro**, no en otras. El `TenantAdmin` bypasea siempre el scoping.

---

## 3. Casos de Uso por Módulo

### 3.1 Autenticación y Onboarding

---

#### **CU-AUTH-01 — Registrar un nuevo tenant (negocio)**

- **Actor:** Visitante (futuro TenantAdmin)
- **Precondición:** No tiene cuenta. Tiene un email válido.
- **Flujo principal:**
  1. Accede a `/register`
  2. Ingresa: nombre del negocio, email del admin, password (con confirmación)
  3. Sistema valida fortaleza del password (mín 12 chars, mayúsculas, números, símbolos)
  4. Sistema envía email de verificación
  5. Usuario hace click en el link de verificación
  6. Sistema crea: tenant + usuario admin + rol `TenantAdmin` asignado
  7. Sistema redirige al **wizard de onboarding**
- **Flujos alternativos:**
  - 2a. Email ya registrado → mensaje genérico "Si el email existe, recibirás instrucciones"
  - 3a. Password débil → muestra checklist de requisitos en vivo
  - 5a. Link expirado (>24h) → opción de reenviar
- **Postcondición:** Tenant creado con un usuario admin verificado. Listo para configurar.

---

#### **CU-AUTH-02 — Wizard de onboarding inicial**

- **Actor:** TenantAdmin recién registrado
- **Precondición:** CU-AUTH-01 completado.
- **Flujo principal:**
  1. Paso 1: Datos del negocio (razón social, RFC/RUT, dirección, zona horaria)
  2. Paso 2: Definir los campos del Catálogo de Productos (o dejarlo para después)
  3. Paso 3: Crear primer almacén
  4. Paso 4: (Opcional) Invitar usuarios adicionales
  5. Sistema marca tenant como `onboarded`
- **Flujos alternativos:**
  - 2a. Puede saltar el paso y definir los campos más tarde desde el editor
  - 4a. Salta el paso → puede invitar después desde Sistema → Usuarios
- **Postcondición:** Tenant operativo, con sus campos definidos (o pendientes) y al menos un almacén.

---

#### **CU-AUTH-03 — Login**

- **Actor:** Cualquier usuario registrado
- **Precondición:** Cuenta activa y verificada.
- **Flujo principal:**
  1. Accede a `/login`
  2. Ingresa email + password
  3. Sistema verifica credenciales contra hash Argon2id
  4. Sistema genera JWT access token (15 min) + refresh token (cookie httpOnly, 7 días)
  5. Redirige a `/dashboard`
- **Flujos alternativos:**
  - 3a. Credenciales inválidas → respuesta idéntica para "email no existe" o "password incorrecto"
  - 3b. Más de 5 intentos en 15 min desde la misma IP → bloqueo temporal
  - 3c. Cuenta no verificada → enlace para reenviar email
  - 3d. Cuenta suspendida → mensaje "contacta a tu administrador"
- **Postcondición:** Sesión activa, contexto de tenant cargado.

---

#### **CU-AUTH-04 — Recuperar password**

- **Actor:** Usuario que olvidó su password
- **Flujo principal:**
  1. Click en "Olvidé mi password" en `/login`
  2. Ingresa email
  3. Sistema envía link con token de un solo uso (válido 30 min)
  4. Usuario abre link, ingresa nuevo password (con confirmación)
  5. Sistema invalida **todos los refresh tokens** del usuario
  6. Sistema redirige a `/login`
- **Postcondición:** Password actualizado, sesiones previas cerradas.

---

#### **CU-AUTH-05 — Logout**

- **Actor:** Usuario autenticado
- **Flujo principal:**
  1. Click en menú usuario → "Cerrar sesión"
  2. Frontend elimina access token de memoria
  3. Sistema invalida refresh token (revocación en Redis con TTL)
  4. Redirige a `/login`
- **Postcondición:** Sesión cerrada. Refresh token inutilizable.

---

### 3.2 Sistema (Usuarios y Roles)

---

#### **CU-SYS-01 — Crear usuario del sistema**

- **Actor:** TenantAdmin
- **Precondición:** Está autenticado en su tenant.
- **Flujo principal:**
  1. Va a Sistema → Usuarios → "Nuevo usuario"
  2. Completa: número de empleado, nombre, apellido paterno, apellido materno, email, rol(es) asignado(s)
  3. **(Opcional) Define alcance por almacén:** selecciona uno o más almacenes a los que el usuario tendrá acceso. Si no se selecciona ninguno, el usuario ve todos los almacenes del tenant.
  4. Sistema valida email único dentro del tenant
  5. Sistema envía email al usuario con link para que defina su password
  6. Usuario nuevo aparece en la lista con estado `pendiente_activación`
- **Flujos alternativos:**
  - 3a. Si el rol asignado es `TenantAdmin`, el sistema **ignora el alcance** (TenantAdmin siempre ve todo)
  - 4a. Email ya existe en el tenant → error en formulario
  - 5a. Email rebota → admin puede reenviar invitación
- **Postcondición:** Usuario creado, pendiente de activar password. Si tiene scope, queda limitado a esos almacenes.

---

#### **CU-SYS-04 — Asignar / modificar alcance de almacenes de un usuario**

- **Actor:** TenantAdmin
- **Precondición:** Existe el usuario y al menos un almacén.
- **Flujo principal:**
  1. Va a Sistema → Usuarios → selecciona usuario → tab "Alcance"
  2. Sistema muestra los almacenes del tenant con checkbox; los seleccionados son los actualmente asignados
  3. Marca/desmarca almacenes
  4. Click "Guardar alcance"
  5. Sistema actualiza `user_warehouse_scopes` (atómicamente: borra los anteriores e inserta los nuevos)
  6. Cambio aplica en la próxima request del usuario (no requiere relogin)
- **Flujos alternativos:**
  - 2a. Usuario es `TenantAdmin` → tab "Alcance" se muestra deshabilitada con leyenda "TenantAdmin tiene acceso a todos los almacenes"
  - 5a. Si el usuario está logueado con conexión activa al POS de un almacén que acaba de perder, su siguiente request a ese almacén devuelve 403
- **Postcondición:** Usuario ve únicamente los almacenes asignados (o todos, si no quedó ninguno).

---

#### **CU-SYS-02 — Asignar permisos granulares a un rol**

- **Actor:** TenantAdmin
- **Flujo principal:**
  1. Va a Sistema → Roles → selecciona rol (o "Nuevo rol")
  2. Marca/desmarca permisos agrupados por módulo (catálogo:read, inventario:movement, etc.)
  3. Guarda
  4. Cambio aplica a todos los usuarios con ese rol en la próxima request
- **Postcondición:** Rol actualizado.

---

#### **CU-SYS-03 — Suspender / reactivar usuario**

- **Actor:** TenantAdmin
- **Flujo principal:**
  1. Lista de usuarios → switch "Activo" en la fila del usuario
  2. Confirma acción
  3. Si suspende: invalida todos sus refresh tokens (logout forzado)
- **Postcondición:** Usuario suspendido no puede loguearse.

---

#### **CU-SYS-05 — Cambiar idioma de mi perfil**

- **Actor:** Cualquier usuario autenticado
- **Precondición:** Sesión activa.
- **Flujo principal:**
  1. Va a Sistema → Mi perfil
  2. En la sección "Preferencias", abre el selector "Idioma"
  3. Elige uno de los idiomas soportados (`Español`, `English`)
  4. Click "Guardar"
  5. Sistema actualiza `users.locale` y refresca la UI inmediatamente con las traducciones nuevas
  6. Próximas respuestas de la API (mensajes de error, emails, recibos) se devuelven en el nuevo idioma
- **Flujos alternativos:**
  - 3a. Sistema detecta `Accept-Language` del browser al registrarse y lo pre-selecciona automáticamente (CU-AUTH-01).
  - 5a. Si hay traducciones faltantes para una clave, cae al idioma default (`es`) y se loguea como warning en Sentry.
- **Postcondición:** El idioma del usuario queda persistido en su perfil. Aplica de inmediato sin relogin.

---

#### **CU-SYS-06 — Configurar moneda operacional del tenant**

- **Actor:** TenantAdmin
- **Precondición:** Está autenticado en su tenant.
- **Flujo principal (durante onboarding):**
  1. En el wizard de onboarding (CU-AUTH-02), Paso 1 incluye selector "Moneda operacional"
  2. TenantAdmin elige `MXN` o `USD`
  3. Sistema persiste `tenants.currency`
  4. Todos los precios, costos, ventas y reportes del tenant se manejan en esa moneda en adelante
- **Flujo principal (cambio posterior):**
  1. Va a Sistema → Configuración del Negocio → "Moneda operacional"
  2. Sistema verifica si el tenant tiene transacciones registradas (productos con precio, ventas, movimientos con costo, facturas)
  3. **Si NO tiene transacciones:** muestra selector activo. Cambio procede normal.
  4. **Si SÍ tiene transacciones:** selector deshabilitado con mensaje *"No podés cambiar la moneda porque ya existen movimientos. Contactá soporte si necesitás migrar."*
- **Flujos alternativos:**
  - 4a. Caso edge: SuperAdmin puede forzar el cambio vía override manual (genera audit log + entrada en Bitácora).
- **Postcondición:** El tenant opera enteramente en la moneda elegida. No hay conversión: lo que se carga en MXN, se ve en MXN. Lo que se carga en USD, se ve en USD.
- **Nota:** la moneda de **facturación de la suscripción** (Stripe) es independiente y se gestiona en CU-BILL-XX (Fase 7).

---

### 3.3 Catálogo

---

#### **CU-CAT-01 — Definir/editar campos de un catálogo (productos o subcatálogo)**

> **Reescrito en la atomización de F2 (2026-08-16):** el versionado v1/v2 con flujos de
> migrar/forzar y el flag `schema_drift` quedaron **diferidos** — decisión de Carlos: editor
> simple con guardas (modelo Airtable/Notion, sin entrenamiento). Se generalizó además a
> cualquier catálogo del tenant, no solo productos. Detalle: `topic_key: sellpoint/f2-atomizacion`.

- **Actor:** TenantAdmin (permiso `catalogs:manage`)
- **Precondición:** El tenant ya está onboarded.
- **Flujo principal:**
  1. Va a Catálogo → Schema
  2. Elige el catálogo (el de Productos o un subcatálogo; también puede crear un subcatálogo nuevo)
  3. Ve los campos estándar (fijos, no eliminables: Código; en productos además nombre, precio, costo, unidad base) y los campos personalizados
  4. Agrega campos personalizados: etiqueta, tipo (**Texto, Numérico, Lookup** hacia otro catálogo), requerido
  5. Edita etiqueta/requerido/orden de campos existentes
  6. Los cambios aplican al guardar cada campo — sin versiones ni publicación
- **Flujos alternativos (las guardas):**
  - 4a. Campo lookup → exige elegir el catálogo destino (vivo, del tenant)
  - 5a. **Quitar un campo con datos** → confirmación explícita con el conteo ("N registros tienen este campo; se ocultará, no se borra"); el campo se archiva y sus valores se conservan (restaurable)
  - 5b. **Cambiar el tipo de un campo con datos** → bloqueado (el sistema explica el porqué)
  - 5c. Intentar tocar un campo estándar → no hay controles para hacerlo
- **Postcondición:** Los forms y tablas del catálogo reflejan los campos vigentes de inmediato.

---

#### **CU-CAT-02 — Crear producto**

- **Actor:** TenantAdmin / Manager
- **Precondición:** Existe un schema activo.
- **Flujo principal:**
  1. Va a Catálogo → Productos → "Nuevo producto"
  2. Completa campos fijos: SKU, nombre, **unidad base** (selector: Unidad, ml, l, gr, kg, m, cm, etc.), stock mínimo
  3. Indica si es **producto compuesto** (toggle "Este producto se prepara a partir de otros del catálogo")
  4. Completa campos dinámicos según los campos del catálogo de productos del tenant (incluye precio y costo, que crean la presentación base «Unidad ×1» — ver ARQUITECTURA § 3.5)
  5. Sistema valida atributos con el validador derivado de los campos (sin Ajv — ver ARQUITECTURA § 3.3)
  6. Guarda producto (sin presentaciones todavía — esas se definen en CU-CAT-05)
  7. Sistema redirige a la página del producto con tabs habilitados: `Información`, `Presentaciones`, y `Composición` (este último solo si es compuesto)
- **Flujos alternativos:**
  - 2a. SKU duplicado en el tenant → error.
  - 2b. Si el producto no es compuesto, el sistema fuerza al menos una presentación con `is_sellable=true` antes de poder vender en POS.
  - 5a. Validación falla → muestra error por campo.
- **Postcondición:** Producto creado con stock 0 en `base_unit` (el stock se agrega vía movimientos). Sin presentaciones ni composición todavía.

---

#### **CU-CAT-05 — Definir presentaciones de un producto**

- **Actor:** TenantAdmin / Manager
- **Precondición:** Existe el producto (CU-CAT-02).
- **Flujo principal:**
  1. Va al producto → tab "Presentaciones"
  2. Ve una tabla con las presentaciones actuales (vacía al principio)
  3. Click "Agregar presentación" → fila inline editable:
     - **Nombre** (ej: "Caja 1L", "Vaso 200ml", "Granel por gramo")
     - **Factor** (cuántas `base_unit` equivale — ej: 1000 para 1L si la base es ml)
     - **Comprable** (toggle): aparece en Entrada
     - **Vendible** (toggle): aparece en POS
     - **Predeterminada para venta** (radio, una sola por producto)
     - **🔢 Solo enteros** (toggle): si está activo, esta presentación NO acepta cantidades decimales en compra/venta. Default automático:
       - Categoría `count` (unit) → ON (no permite decimales)
       - Categoría `volume`/`weight`/`length` → OFF (permite decimales)
       - TenantAdmin puede override (ej: "Paquete cerrado 250gr" → ON aunque sea peso)
     - **Código de barras** (opcional)
     - **Precio de venta** (si es vendible)
     - **Costo de compra** (si es comprable, último/promedio)
  4. Guarda la fila (se inserta sin salir de la página)
  5. Repite para todas las presentaciones del producto
- **Flujos alternativos:**
  - 3a. Producto **simple** (no compuesto) requiere al menos 1 presentación vendible antes de aparecer en POS.
  - 3b. Producto **compuesto**: las presentaciones son solo del producto compuesto vendible (Vaso 200ml, Vaso 350ml) — no compra al proveedor.
  - 4a. Código de barras duplicado en el tenant → error con link al producto que ya lo tiene.
- **Postcondición:** Producto tiene N presentaciones gestionables. Cada presentación funciona como unidad de transacción en compra/venta.

---

#### **CU-CAT-06 — Definir la composición de un producto compuesto (BOM)**

> **Vocabulario neutro (LEY de genericidad, 2026-08-16):** *composición* y *componente*,
> nunca *receta* ni *ingrediente*. El mismo caso de uso sirve a una óptica que arma un
> lente (armazón + cristales), a una ferretería que arma un kit y a una cafetería que
> prepara un café.

- **Actor:** TenantAdmin / Manager
- **Precondición:** Existe el producto con `is_composite = true` (CU-CAT-02).
- **Filosofía UX:** la UI es **una tabla inline simple**. Sin wizards. Sin pasos. Sin drag-and-drop.
- **Flujo principal:**
  1. Va al producto → tab "Composición" (visible solo si es compuesto)
  2. Ve la tabla de componentes (vacía al principio)
  3. Click en el input de búsqueda "🔍 Agregar componente del catálogo..."
  4. Empieza a tipear → autocompletado muestra productos del catálogo con su `base_unit`
  5. Selecciona un producto → fila se inserta con: nombre del componente, input de cantidad, unidad **pre-cargada** desde el `base_unit` del componente (no editable), (opcional) merma %, ícono ✕ para quitar
  6. Ingresa **cuánto lleva UNA unidad** del producto compuesto (ej: 200 para 200 ml)
  7. Sistema recalcula en vivo:
     - **Costo estimado**: suma de `costo unitario × quantity` por componente
     - **Unidades armables**: `min(stock_componente_i / quantity_i)` redondeado hacia abajo, en cualquier almacén
  8. Repite para cada componente
  9. Click "Guardar composición"
- **Flujos alternativos:**
  - 5a. El componente seleccionado es un producto compuesto → sistema lo permite (composiciones anidadas), pero valida que **no haya recursión** (DFS sobre el grafo).
  - 5b. Recursión detectada (A → B → A) → error claro: *"'X' ya usa este producto como componente, indirectamente."*
  - 5c. El componente no tiene `base_unit` definida → bloqueado con CTA "Define primero la unidad base de este producto".
  - 9a. Composición vacía → guarda OK pero el producto compuesto no se podrá vender hasta tener al menos 1 componente.
- **Postcondición:** Composición guardada. Al vender el producto compuesto en POS, el sistema descuenta los componentes en transacción atómica.

---

#### **CU-CAT-07 — Ver unidades armables de productos compuestos**

- **Actor:** Cualquiera con `products:read`
- **Flujo principal:**
  1. Catálogo → Productos → filtra por "Compuestos"
  2. Tabla muestra por producto: nombre, presentación predeterminada, **unidades armables** (calculado: cuántas veces alcanza el stock actual para armar el producto), componente limitante (el que está más cerca de quedarse sin stock)
- **Postcondición:** Visibilidad de capacidad real de armado.

---

#### **CU-CAT-03 — Importar productos desde Excel**

- **Actor:** TenantAdmin / Manager
- **Flujo principal:**
  1. Catálogo → Productos → "Importar Excel"
  2. Descarga plantilla generada según el schema activo
  3. Llena la plantilla con los productos
  4. Sube el archivo
  5. Sistema procesa **fila por fila** y valida cada una
  6. Muestra resumen: N exitosos, M con errores
  7. Usuario puede descargar Excel con errores marcados para corregir y reintentar
- **Flujos alternativos:**
  - 5a. Archivo > 5MB → procesamiento asíncrono con notificación al terminar
- **Postcondición:** Productos válidos creados; fallidos no impactan los exitosos.

---

#### **CU-CAT-04 — Buscar y filtrar productos**

- **Actor:** Cualquiera con `products:read`
- **Flujo principal:**
  1. Catálogo → Productos
  2. Ingresa texto en búsqueda (busca en SKU, código de barras, nombre)
  3. (Opcional) Aplica filtros por campos custom del schema
  4. Tabla se actualiza con paginación server-side
- **Postcondición:** Lista filtrada.

---

### 3.4 Almacenes

---

#### **CU-ALM-01 — Crear almacén**

- **Actor:** TenantAdmin / Manager
- **Flujo principal:**
  1. Almacenes → "Nuevo almacén"
  2. Completa: nombre, calle, número, colonia, municipio/alcaldía, estado, código postal
  3. (Opcional) Define racks de ubicación (estructura interna del almacén)
  4. Guarda
- **Postcondición:** Almacén disponible para recibir movimientos.

---

#### **CU-ALM-02 — Editar / desactivar almacén**

- **Actor:** TenantAdmin / Manager
- **Flujo principal:**
  1. Lista → click en almacén → editar
  2. Modifica datos o lo desactiva
  3. Si desactiva: sistema valida que no tenga stock pendiente o movimientos abiertos
- **Postcondición:** Almacén actualizado. Desactivados no aparecen en nuevos movimientos.

---

### 3.5 Movimientos de Inventario

> **Modelo unificado:** existen **2 tipos de movimiento** (Entradas y Salidas) — se llamaban «Entrada/Salida Directa» hasta el 2026-08-18, cuando Carlos pidió quitarle el «Directa»: desde que un traspaso ES una salida con motivo, la palabra excluía justo lo que el concepto abarca — cada uno con un campo **motivo** (`reason_code`) que diferencia el caso de uso. El traspaso entre almacenes es un **proceso de 2 pasos con confirmación** (CU-MOV-01 con motivo `transfer` en origen + CU-MOV-03 en destino). **Toda operación es un DOCUMENTO con folio y estado** (decisiones de Carlos, 2026-08-18): **tres series por tenant** — `ENT` Entrada, `SAL` Salida, `INV` Inventario físico. **Un traspaso es una `SAL` con motivo Traspaso y su recepción una `ENT` con el mismo motivo**: el motivo va dentro del documento, nunca en el folio. El documento **nace en borrador** al pulsar «Crear» desde el listado de su serie, se carga a mano o por Excel guardándose sola, y **se puede retomar por su folio** si se cierra el sistema (CU-MOV-08). Su detalle es la **vista previa**: muestra el stock resultante antes de escribir. Al **confirmar** nacen los movimientos y se mueve el stock; abandonarlo lo deja anulado con su folio.

#### Motivos soportados

| Entrada | Salida |
|---|---|
| `invoice` — Factura/Compra (proveedor, costo) | `adjustment` — Ajuste/Merma/Daño |
| `adjustment` — Ajuste por sobrante | `transfer` — Traspaso a otro almacén (pide destino) |
| `transfer` — Traspaso desde otro almacén (pide origen) | `loss` — Pérdida/Robo |
| `customer_return` — Devolución de cliente (manual, sin venta) | `expired` — Caducado |
| `sale_return` — **reservado F4**: anulación / devolución ligada a una venta | `sale` — **reservado F4**: venta desde el POS |
| `physical_count` — solo lo emite la aprobación del inventario físico (CU-MOV-05) | `physical_count` — ídem |

> Cuando el motivo es `transfer`, el sistema vincula el movimiento al `Transfer` correspondiente. Para todos los demás motivos, el movimiento es independiente.
>
> **Evolución (atomización F3, 2026-08-17):** el enum nace **completo** — `sale`/`sale_return` quedan reservados para F4 (los endpoints directos los rechazan) y **`production` se eliminó**: los productos compuestos **nunca** tienen stock persistido (se arman al vender, F4), así que no existe "producción interna" en el MVP. Los campos contextuales se modelan de forma genérica (LEY de genericidad): `reference` (nº de documento, orden, área/concepto, referencia externa) + `authorized_by` (usuario del tenant) + `reason_note`; **no hay catálogo de proveedores** (un tenant puede armarlo como subcatálogo). Los tres permisos de la fase son `inventory:read`, `inventory:movement` e `inventory:manage` (cancelar traspaso y aprobar conteo — solo TenantAdmin). **Lotes (F3-LOTS, mismo día):** un producto puede activar `tracks_lots`; entonces toda entrada exige `lote` (+ `caducidad`, propiedad del lote) y opcionalmente `ubicación` (parte el stock), y toda salida sin lote explícito aplica **FEFO** (sale primero el que vence antes) — el POS de F4 lo hereda. Los productos sin `tracks_lots` nunca ven un lote.

---

#### **CU-MOV-01 — Registrar una entrada**

- **Actor:** TenantAdmin / Manager
- **Precondición:** El usuario tiene scope sobre el almacén destino. Si el motivo es `transfer`, debe existir un `Transfer` en estado `in_transit` con destino a ese almacén (ver CU-MOV-03 para el flujo de confirmación de traspaso, que es la forma recomendada).
- **Flujo principal:**
  1. Movimientos → **Entradas**: listado con buscador por folio y estatus → botón **"Crear entrada"** → nace el borrador con su folio (`ENT-000042`) y se abre su pantalla
  2. Selecciona almacén destino
  3. Elige **motivo** (`reason_code`): factura, ajuste, devolución de cliente (el motivo traspaso no se elige acá — ver CU-MOV-03)
  4. Completa campos contextuales según motivo:
     - `invoice` → `reference` (nº de documento) obligatoria + costo unitario por línea obligatorio
     - `adjustment` → `reason_note` obligatoria + `authorized_by` opcional
     - `transfer` → **no se elige acá**: la recepción de un traspaso se hace desde la vista "Traspasos en tránsito" (CU-MOV-03), que manda `transfer_id`
     - `customer_return` → `reason_note` obligatoria + `reference` opcional (referencia externa; la devolución ligada a una venta del POS es `sale_return`, F4)
  5. Carga las líneas por **cualquiera de las dos vías**: a mano (escanea código de barras o busca por SKU e ingresa cantidad) o **subiendo un Excel/CSV** con la plantilla descargable (`sku, presentacion, cantidad, costo_unitario, lote, caducidad, ubicacion`). Las dos vías terminan en la misma tabla, y **cada cambio se guarda solo** en el borrador.
  6. El panel de previa se actualiza en vivo: resuelve y valida TODO sin escribir nada: cantidades > 0, producto activo, presentación válida, **si la presentación tiene `allow_fractional_input=false` la cantidad no puede tener decimales** (*"La presentación 'Caja 30 tab' solo acepta cantidades enteras"*), lotes. Muestra **el stock actual y el resultante de cada línea**, los lotes que se crearían y los errores marcados sobre su fila. **El stock real no se toca hasta confirmar.**
  7. Usuario revisa. Puede seguir editando (todo se guarda solo), cerrar el sistema y volver más tarde, o click "Confirmar entrada" (deshabilitado si hay errores) → **transacción atómica**:
     - Marca el documento `confirmed` con `UPDATE … WHERE status='draft'` (si otro lo confirmó primero: 409, y el stock no se duplica)
     - Inserta `stock_movement` por línea con `direction='entry'`, `reason_code`, `reason_note`, `presentation_id`, `linked_warehouse_id` (si transfer). La `quantity` se persiste en `base_unit` (convertida con `presentation.factor`).
     - Actualiza `stock_by_warehouse`
     - Si `reason_code='transfer'`: marca el `Transfer` vinculado como `completed` (ver CU-MOV-03)
     - Registra audit log anclado en el documento (el folio es lo que se busca al auditar)
- **Flujos alternativos:**
  - 6a. El archivo trae filas con error (sku inexistente, escala inválida, lote en producto que no los controla) → la previa las marca con su número de fila y el resto sigue visible; confirmar queda bloqueado hasta corregir.
  - 7a. El usuario se arrepiente y anula → el documento queda `canceled` **con su folio**: la serie no pierde números y queda auditable qué pasó con cada uno.
  - 7b. Se cierra el sistema con 40 líneas cargadas → el borrador sigue ahí; se busca `ENT-000042` en el listado de Entradas y se continúa (CU-MOV-08). Lo puede continuar otro usuario con permiso sobre ese almacén.
  - 4a. Motivo `transfer` sin `transfer_id` → **rechazado** (422 `inventory.transfer_entry_requires_transfer`; decisión F3, 2026-08-17). Una entrada `transfer` "huérfana" no explica de dónde vino el stock; la corrección de un traspaso mal registrado se hace con `adjustment`, que sí queda explicada y auditada.
- **Postcondición:** Stock sumado al almacén. Documento `ENT-…` creado y descargable en PDF. Kardex actualizado con el folio en cada línea. Si era traspaso vinculado, ciclo cerrado.

---

#### **CU-MOV-02 — Registrar una salida**

- **Actor:** TenantAdmin / Manager
- **Precondición:** El usuario tiene scope sobre el almacén origen. Hay stock disponible.
- **Flujo principal:**
  1. Movimientos → **Salidas** → botón **"Crear salida"** → nace el borrador con su folio (`SAL-000019`)
  2. Selecciona almacén origen
  3. Elige **motivo** (`reason_code`) del enum: ajuste, traspaso, merma, pérdida, consumo, caducado
  4. Completa campos contextuales según motivo:
     - `adjustment` / `loss` / `expired` → texto libre con explicación + usuario autorizador
     - `transfer` → selector "Almacén destino"
     - `consumption` → área o concepto (texto libre)
  5. Carga las líneas a mano o **subiendo un Excel/CSV** (plantilla `sku, presentacion, cantidad, lote, ubicacion` — sin costo: una salida no tiene precio de compra)
  6. El panel de previa valida stock suficiente (`stock_by_warehouse.quantity >= cantidad solicitada`). **Si la presentación elegida tiene `allow_fractional_input=false`, valida también cantidad entera**. Si el producto controla lotes y la línea no trae uno, el sistema reparte la cantidad **FEFO** (por `expires_at` ascendente) entre los lotes con saldo del almacén; el usuario puede forzar un lote. **La previa muestra, línea por línea, el disponible, el stock resultante y de qué lote saldría** — sin escribir nada ni consumir folio.
  7. Usuario revisa y click "Confirmar salida" → **transacción atómica**:
     - Marca el documento `confirmed` (el folio ya lo tenía desde que nació el borrador). Si el motivo es Traspaso, **el folio sigue siendo un `SAL-…`**: un traspaso no tiene serie propia
     - Inserta `stock_movement` por línea con `direction='exit'`, `reason_code`, `reason_note`, `presentation_id`, `linked_warehouse_id` (si transfer). La `quantity` se persiste en `base_unit` (convertida con `presentation.factor`).
     - Decrementa `stock_by_warehouse`
     - Si `reason_code='transfer'`: crea registro en tabla `transfers` con estado `in_transit`, almacenes origen + destino, líneas
     - Registra audit log
- **Flujos alternativos:**
  - 6a. Stock insuficiente → error con detalle de cuánto hay disponible.
  - 7a. Si motivo es `transfer` y se confirma → el stock sale del origen y queda "en tránsito". NO entra automáticamente al destino. El destino tiene que confirmar con CU-MOV-03.
- **Postcondición:** Stock restado del origen. Documento `SAL-…` confirmado y descargable en PDF. Si era traspaso, `Transfer` queda `in_transit` esperando recepción.

---

#### **CU-MOV-03 — Confirmar recepción de traspaso**

- **Actor:** TenantAdmin / Manager del **almacén destino**
- **Precondición:** Existe un `Transfer` con estado `in_transit` cuyo destino es un almacén dentro del scope del usuario.
- **Flujo principal:**
  1. Movimientos → "Traspasos en tránsito" → tab "Pendientes de recibir"
  2. Selecciona el traspaso a confirmar (muestra origen, fecha de salida, líneas con cantidades enviadas)
  3. Click "Confirmar recepción" → se crea un **borrador de Entrada** con motivo Traspaso (`ENT-000043`) **precargado con las líneas enviadas**, y se abre la misma pantalla que cualquier entrada
  4. Usuario verifica cantidades. Puede:
     - Confirmar **iguales** (cantidad recibida = cantidad enviada)
     - Confirmar **con diferencia** (cantidad recibida < cantidad enviada — faltante por pérdida/robo en tránsito)
  5. Si hay diferencia, ingresa nota explicativa obligatoria
  6. Click "Confirmar" → el borrador de entrada se confirma, vinculado al `Transfer`:
     - Inserta `stock_movement` `direction='entry'` por línea con cantidad RECIBIDA
     - Si recibido < enviado: registra `discrepancy` en `transfer.discrepancies` con la diferencia + nota
     - Cambia `Transfer.status='completed'` con timestamp + usuario que confirmó
     - Audit log detallado de la discrepancia (importante para auditorías)
- **Flujos alternativos:**
  - 4a. Cantidad recibida > enviada → bloqueado. No tiene sentido operacional (¿de dónde salió el excedente?). El operador debe registrar el excedente como Entrada con motivo `adjustment`.
  - 5a. Si NUNCA llega el traspaso (vehículo robado, accidente) → SuperAdmin/TenantAdmin puede cancelar el `Transfer` (estado `canceled`) con justificación; el stock NO retorna al origen automáticamente — queda como pérdida del origen hasta que se haga un ajuste explícito.
- **Postcondición:** `Transfer.status='completed'`. Stock entra al destino con las cantidades realmente recibidas. Cualquier discrepancia auditada.

---

#### **CU-MOV-04 — Ver traspasos en tránsito**

- **Actor:** TenantAdmin / Manager / Viewer
- **Flujo principal:**
  1. Movimientos → "Traspasos en tránsito"
  2. Sistema muestra dos tabs:
     - **Pendientes de recibir** (entrantes a almacenes del scope del usuario)
     - **Pendientes de enviar** (salidas hechas desde almacenes del scope, todavía no confirmadas en destino)
  3. Cada fila: folio, fecha salida, origen, destino, # líneas, días en tránsito
  4. Filtros: rango de fechas, origen, destino, antigüedad (> 7 días en tránsito marcadas con badge naranja)
- **Postcondición:** Visibilidad de stock no consolidado.

---

#### **CU-MOV-05 — Inventario físico**

- **Actor:** TenantAdmin / Manager
- **Flujo principal:**
  1. Movimientos → **Inventario**: listado con buscador por folio y estatus → botón **"Crear conteo"** → nace el borrador con su folio (`INV-000002`)
  2. Selecciona almacén y descarga la plantilla (`sku, nombre, unidad, lote, caducidad, ubicación, teórico, contado`) — solo productos activos y no compuestos; los productos con `tracks_lots` ocupan **una fila por (lote, ubicación)**, los demás una fila con las columnas de lote vacías
  3. *(Sin bloqueo del almacén — decisión F3, 2026-08-17: la aprobación relee el teórico con `FOR UPDATE`; lo que se movió entre reconciliar y aprobar queda como **drift auditado**.)*
  4. Sube la planilla contada: la clave de cada fila es `sku` (+ `lote` y `ubicación` si el producto controla lotes); un `lote` nuevo se **crea** al aprobar (exige `caducidad` si el producto la maneja); un lote en un producto sin `tracks_lots` es error de fila (decisión F3-LOTS, 2026-08-17: lote/caducidad/ubicación son dimensiones **genéricas** del stock, opt-in por producto)
  5. Sistema reconcilia:
     - Reconcilia en seco (sin escribir): teórico vs contado por fila, resumen (coincidencias / discrepancias / omitidas / errores)
     - Filas con `counted` vacío = no contadas → se omiten y se reportan
  6. Usuario revisa; **aprueba solo quien tenga `inventory:manage`** (TenantAdmin) → transacción atómica que, **solo para las líneas con diferencia**, genera salida `physical_count` del teórico total + entrada `physical_count` del contado, todo bajo el documento `INV-000002` **que ya existía como borrador desde el paso 1**; las líneas iguales no generan movimiento
- **Postcondición:** Inventario reconciliado al contado. Documento `INV-…` creado y descargable en PDF (con las columnas teórico / contado / diferencia). Discrepancias y drift (si el teórico cambió entre reconciliar y aprobar) registrados en audit log.

---

#### **CU-MOV-06 — Consultar Kardex de un producto**

- **Actor:** Cualquiera con `inventory:read`
- **Flujo principal:**
  1. Catálogo → Productos → selecciona producto → tab "Kardex"
  2. Sistema muestra histórico completo de movimientos del producto en todos los almacenes accesibles según el scope del usuario
  3. Filtros: rango de fechas, almacén, dirección (entrada/salida), motivo (`reason_code`)
  4. Cada línea muestra el **folio** del documento que la originó, y es un link a ese documento
- **Postcondición:** Visualización de trazabilidad.

---

#### **CU-MOV-07 — Buscar un documento y reimprimir su PDF**

- **Actor:** Cualquiera con `inventory:read`
- **Precondición:** El documento pertenece a un almacén dentro del scope del usuario.
- **Motivación:** El proveedor llama y dicta un folio; el contador pide el papel de una entrada del mes pasado; se traspapeló la copia firmada. El folio existe justamente para poder volver.
- **Flujo principal:**
  1. Movimientos → **Entradas**, **Salidas** o **Inventario** (cada serie tiene su propio listado; son la misma pantalla con distinto tipo)
  2. Busca por **folio** (parcial, sin distinguir mayúsculas: `000042`, `ent-42`) o filtra por estatus (Borradores / Confirmados / Anulados), almacén, rango de fechas y usuario
  3. Sistema lista los documentos de los almacenes en su scope, más nuevos primero. Por defecto **no muestra los anulados**: entran con su chip
  4. Click en una fila → detalle con la cabecera completa (folio, tipo, almacén, fecha, motivo, referencia, nota, quién registró y quién autorizó) y sus líneas
  5. Click "Descargar PDF" → se baja el documento con el folio como nombre de archivo
- **Flujos alternativos:**
  - 3a. El documento pertenece a un almacén fuera del scope → no aparece en el listado y su detalle da 404 (no se filtra "para que no lo vea": no existe para ese usuario).
  - 5a. El documento tiene cientos de líneas → el PDF sale paginado con el encabezado de la tabla repetido en cada hoja.
- **Postcondición:** Ninguna — es solo lectura. Un documento **confirmado** no se puede editar ni borrar (lo impide un trigger en la base): corregirlo es registrar otro movimiento (`adjustment`), que queda explicado y auditado. Un **borrador** sí se edita — es justamente lo que permite CU-MOV-08.

---

#### **CU-MOV-08 — Retomar un movimiento a medio cargar**

- **Actor:** TenantAdmin / Manager (`inventory:movement` sobre ese almacén)
- **Precondición:** Existe un documento en estado **borrador** en un almacén dentro del scope del usuario.
- **Motivación (Carlos, 2026-08-18):** *«si llevas muchos productos agregados en el movimiento y se cierra el sistema, debes poder continuar el movimiento buscándolo por su folio»*. Cargar 80 productos lleva media hora; perderlos por un corte de luz, una sesión vencida o un navegador que se cierra no es aceptable. Por eso el borrador vive en el **servidor** y no en el navegador: sobrevive al equipo, y lo puede terminar otra persona.
- **Flujo principal:**
  1. Movimientos → el listado de la serie que corresponda (Entradas / Salidas / Inventario)
  2. El borrador aparece con **badge «Borrador»**, su folio, la fecha y cuántas líneas lleva; también se llega buscando el folio directo
  3. Click en la fila → se abre la misma pantalla donde se quedó, con todas sus líneas
  4. Continúa cargando; cada cambio se guarda solo
  5. Confirma cuando termina (o lo anula)
- **Flujos alternativos:**
  - 3a. Lo abre **otro usuario** con permiso sobre ese almacén → puede continuarlo. No hay bloqueo de edición: si dos editan a la vez gana el último cambio, y **confirmar** usa un lock lógico para que solo uno lo cierre (el segundo recibe 409 y ve el documento ya confirmado).
  - 5a. Nunca se termina → queda en borrador indefinidamente; anularlo lo deja `canceled` **con su folio**, así la serie no pierde números.
- **Postcondición:** El movimiento se completa sin haber perdido nada. Mientras fue borrador, **el stock nunca se tocó**.

---

### 3.6 Punto de Venta

---

#### **CU-POS-01 — Realizar una venta**

- **Actor:** TenantAdmin / Manager / POS_Seller
- **Precondición:** Sesión activa con permiso `pos:sell`. Existe stock.
- **Flujo principal:**
  1. POS → pantalla de venta
  2. Escanea código de barras o busca por nombre/SKU (búsqueda predictiva)
  3. Sistema agrega al carrito; valida que haya stock
  4. Ajusta cantidades / aplica descuento por línea o global (si tiene permiso)
  5. Click "Cobrar" → selecciona método de pago (efectivo, tarjeta, transferencia)
  6. Sistema ejecuta **transacción atómica**:
     - Crea `sale` y sus `sale_items`
     - Descuenta stock de cada producto
     - Registra movimientos de salida
     - Genera ticket
  7. Imprime ticket (USB/Red o Bluetooth) y/o lo envía por email
- **Flujos alternativos:**
  - 3a. Producto sin stock → bloquea o pide confirmación según política del tenant
  - 4a. Descuento sobre el permitido → requiere autorización (login secundario de manager)
  - 6a. Falla la impresión → opción de reimprimir desde el historial
- **Postcondición:** Venta registrada. Stock descontado. Ticket emitido.

---

#### **CU-POS-02 — Anular venta**

- **Actor:** TenantAdmin / Manager
- **Precondición:** Venta del mismo día (configurable).
- **Flujo principal:**
  1. POS → Historial de ventas → selecciona venta → "Anular"
  2. Ingresa motivo
  3. Sistema crea movimientos de **devolución a stock** (entradas por ajuste con motivo "anulación de venta")
  4. Venta queda marcada como `anulada`
- **Postcondición:** Stock restituido. Venta no contabiliza.

---

#### **CU-POS-03 — Cierre de caja**

- **Actor:** TenantAdmin / Manager / POS_Seller
- **Flujo principal:**
  1. POS → "Cierre de caja"
  2. Sistema muestra totales del turno por método de pago + cantidad de ventas
  3. Usuario ingresa el efectivo contado en caja
  4. Sistema calcula diferencia (sobrante/faltante)
  5. Confirma cierre → genera reporte de cierre imprimible
- **Postcondición:** Turno cerrado. No se pueden hacer más ventas hasta abrir otro turno.

---

### 3.7 Reportes

---

#### **CU-REP-01 — Reporte de Stock por Almacén**

- **Actor:** TenantAdmin / Manager / Viewer
- **Flujo principal:**
  1. Reportes → Stock por almacén
  2. Filtros: almacén(es), producto, mostrar solo bajo stock mínimo
  3. Tabla paginada server-side
  4. Click "Exportar Excel" → descarga `.xlsx`
- **Postcondición:** Datos visualizados o descargados.

---

#### **CU-REP-02 — Reporte de Catálogo de Productos**

- **Actor:** TenantAdmin / Manager / Viewer
- **Flujo principal:**
  1. Reportes → Catálogo
  2. Filtros por cualquier campo del schema activo
  3. Visualiza o exporta a Excel (incluye campos custom)
- **Postcondición:** Reporte generado.

---

#### **CU-REP-03 — Reporte de Ventas**

- **Actor:** TenantAdmin / Manager / Viewer
- **Flujo principal:**
  1. Reportes → Ventas
  2. Filtros: rango de fechas, vendedor, método de pago, almacén
  3. Visualiza totales agrupados + listado detallado
  4. Exporta
- **Postcondición:** Reporte generado.

---

#### **CU-REP-04 — Reporte de Kardex Detallado**

- **Actor:** TenantAdmin / Manager / Viewer
- **Flujo principal:**
  1. Reportes → Kardex
  2. Selecciona producto + rango de fechas + almacén(es)
  3. Muestra todos los movimientos cronológicos con stock acumulado
  4. Exporta
- **Postcondición:** Trazabilidad completa visible.

---

*Documento de casos de uso de SellPoint. Mantener sincronizado con [ARQUITECTURA.md](ARQUITECTURA.md) y [VISTAS.md](VISTAS.md).*
