# SellPoint — Vistas y Acciones del Usuario

> Mapa completo de **todas las vistas** del sistema con wireframe ASCII, descripción, acciones disponibles y permisos requeridos.

> **Convención:** los wireframes son **ilustrativos**, no diseños finales. Sirven para entender estructura, jerarquía y elementos por pantalla.

---

## Tabla de Contenidos

1. [Convenciones](#1-convenciones)
2. [Layout Global Autenticado](#2-layout-global-autenticado)
3. [Vistas Públicas](#3-vistas-públicas)
   - 3.1 Login
   - 3.2 Registro de Tenant
   - 3.3 Verificar Email
   - 3.4 Recuperar Password
4. [Onboarding](#4-onboarding)
5. [Dashboard](#5-dashboard)
6. [Catálogo](#6-catálogo)
   - 6.1 Productos — Lista
   - 6.2 Producto — Detalle / Form
   - 6.3 Editor de Schema
   - 6.4 Importar desde Excel
7. [Almacenes](#7-almacenes)
8. [Movimientos](#8-movimientos)
   - 8.1 Entrada
   - 8.2 Salida
   - 8.3 Traspasos en Tránsito
   - 8.4 Inventario Físico
   - 8.5 Histórico de Movimientos / Kardex
9. [Punto de Venta (POS)](#9-punto-de-venta-pos)
   - 9.1 Pantalla principal de venta
   - 9.2 Modal de cobro
   - 9.3 Historial de ventas
   - 9.4 Cierre de caja
10. [Reportes](#10-reportes)
11. [Sistema](#11-sistema)
    - 11.1 Usuarios
    - 11.2 Roles y Permisos
    - 11.3 Mi perfil

---

## 1. Convenciones

| Símbolo | Significado |
|---|---|
| `[Texto]` | Botón |
| `(Texto)` | Input / campo de formulario |
| `{Texto}` | Variable / dato dinámico |
| `▼` | Dropdown |
| `☑` / `☐` | Checkbox |
| `🔍` | Búsqueda |
| `📷` | Cámara / escáner |
| `🖨` | Impresora |
| `⚠️` | Alerta |

**Permisos:** cada vista indica qué roles tienen acceso. Los permisos granulares se listan en [CASOS_DE_USO.md § 2](CASOS_DE_USO.md#2-matriz-de-permisos).

---

## 2. Layout Global Autenticado

```
┌────────────────────────────────────────────────────────────────────────┐
│  🏪 SellPoint   {Tenant: Farmacia Arcangel Uriel}   🔔  👤 {Nombre} ▼  │
├──────────────┬─────────────────────────────────────────────────────────┤
│              │                                                         │
│  📊 Dashboard│                                                         │
│              │                                                         │
│  📦 Catálogo │              CONTENIDO DE LA VISTA                      │
│   └ Productos│                                                         │
│   └ Schema   │                                                         │
│              │                                                         │
│  🏬 Almacenes│                                                         │
│              │                                                         │
│  🔄 Movimientos                                                        │
│   └ Entradas │                                                         │
│   └ Salidas  │                                                         │
│   └ Inv.Físico                                                         │
│              │                                                         │
│  🛒 POS      │                                                         │
│              │                                                         │
│  📈 Reportes │                                                         │
│              │                                                         │
│  ⚙️ Sistema  │                                                         │
│   └ Usuarios │                                                         │
│   └ Roles    │                                                         │
│              │                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

**Elementos comunes:**
- **Header:** logo, nombre del tenant, notificaciones, menú de usuario (Mi perfil, Cerrar sesión).
- **Sidebar:** menú colapsable. Solo se muestran las secciones a las que el rol tiene acceso.
- **Breadcrumbs** en la parte superior del contenido cuando aplique.
- **Toasts** para feedback (éxito, error, advertencia).
- **Responsive:** sidebar colapsa a hamburger menu en pantallas < 768px.

---

## 3. Vistas Públicas

### 3.1 Login

**Ruta:** `/login` · **Acceso:** público

```
┌──────────────────────────────────────────┐
│              🏪 SellPoint                │
│                                          │
│         Inicia sesión en tu cuenta       │
│                                          │
│   Email                                  │
│   (___________________________________)  │
│                                          │
│   Password                               │
│   (___________________________________)  │
│                                          │
│   ☐ Recordarme                          │
│                                          │
│          [    Iniciar sesión    ]        │
│                                          │
│   ¿Olvidaste tu password?                │
│   ¿No tienes cuenta? Regístrate          │
│                                          │
└──────────────────────────────────────────┘
```

**Acciones:**
- Iniciar sesión
- Ir a recuperación de password
- Ir a registro

---

### 3.2 Registro de Tenant

**Ruta:** `/register` · **Acceso:** público

```
┌──────────────────────────────────────────┐
│         Crea tu cuenta SellPoint         │
│                                          │
│   Nombre del negocio                     │
│   (___________________________________)  │
│                                          │
│   Tu email                               │
│   (___________________________________)  │
│                                          │
│   Password                               │
│   (___________________________________)  │
│   ✓ 12+ caracteres                       │
│   ✗ Mayúscula                            │
│   ✓ Número                               │
│   ✓ Símbolo                              │
│                                          │
│   Confirmar password                     │
│   (___________________________________)  │
│                                          │
│   ☐ Acepto términos y privacidad        │
│                                          │
│          [    Crear cuenta    ]          │
│                                          │
│   ¿Ya tienes cuenta? Iniciar sesión      │
└──────────────────────────────────────────┘
```

**Acciones:**
- Validación en vivo de fortaleza de password
- Crear cuenta (envía email de verificación)

---

### 3.3 Verificar Email

**Ruta:** `/verify?token=xxx` · **Acceso:** público

```
┌──────────────────────────────────────────┐
│              ✅ Verificado                │
│                                          │
│   Tu cuenta ha sido verificada.          │
│   Vamos a configurar tu negocio.         │
│                                          │
│          [   Comenzar setup   ]          │
└──────────────────────────────────────────┘
```

Si el token expiró:
```
┌──────────────────────────────────────────┐
│              ⚠️ Token expirado            │
│                                          │
│   El link expiró. Solicita uno nuevo.    │
│                                          │
│          [  Reenviar email   ]           │
└──────────────────────────────────────────┘
```

---

### 3.4 Recuperar Password

**Rutas:** `/forgot-password` y `/reset-password?token=xxx` · **Acceso:** público

```
┌──────────────────────────────────────────┐
│         Recuperar password               │
│                                          │
│   Ingresa tu email y te enviaremos       │
│   un link para resetear tu password.     │
│                                          │
│   Email                                  │
│   (___________________________________)  │
│                                          │
│         [   Enviar link   ]              │
└──────────────────────────────────────────┘
```

---

## 4. Onboarding

**Ruta:** `/onboarding` · **Acceso:** TenantAdmin recién verificado

Wizard de 4 pasos. Indicador de progreso arriba.

```
┌────────────────────────────────────────────────┐
│  ●━━━━━○━━━━━○━━━━━○                          │
│  Paso 1/4: Datos del negocio                   │
│                                                │
│   Razón social                                 │
│   (_______________________________________)    │
│                                                │
│   RFC / RUT                                    │
│   (_______________________________________)    │
│                                                │
│   Dirección fiscal                             │
│   (_______________________________________)    │
│                                                │
│   Zona horaria                                 │
│   ▼ America/Mexico_City                        │
│                                                │
│   Moneda operacional                           │
│   ┌────────────────────────────┐              │
│   │  MXN — Peso mexicano  ▾   │              │
│   │  ─────────────────────    │              │
│   │  MXN — Peso mexicano      │              │
│   │  USD — Dólar estadounidense│              │
│   └────────────────────────────┘              │
│   ⚠️ Esta moneda aplica a TODO el inventario  │
│      y ventas del negocio. No se puede cambiar │
│      una vez que registres movimientos.        │
│                                                │
│              [Atrás]  [Continuar]              │
└────────────────────────────────────────────────┘
```

**Paso 2: Campos de tu catálogo**

> **Actualizado por la LEY de genericidad (2026-08-16):** el selector de rubros
> (Farmacia / Ferretería / Abarrotes) desapareció de este paso. SellPoint **no trae
> campos definidos para ningún giro** — el negocio nombra los suyos. Las plantillas
> sugeridas por rubro (Layouts) son una funcionalidad posterior y opcional
> (IMPLEMENTACION.md § Fase 9.0).

```
┌────────────────────────────────────────────────┐
│  ○━━━━━●━━━━━○━━━━━○                          │
│  Paso 2/4: Campos de tu catálogo               │
│                                                │
│  Tus productos ya tienen lo esencial:          │
│  Código, Nombre, Precio, Costo, Unidad base.   │
│                                                │
│  Agrega los campos propios de tu negocio:      │
│                                                │
│   ┌──────────────────────────────────────┐    │
│   │ (Nombre del campo)  ▼ Tipo   [+ Agregar]│  │
│   └──────────────────────────────────────┘    │
│                                                │
│   • {campos agregados hasta ahora}             │
│                                                │
│   Puedes hacerlo después desde Catálogo →      │
│   Schema.                                      │
│                                                │
│      [Atrás]  [Definir después]  [Continuar]   │
└────────────────────────────────────────────────┘
```

**Pasos 3 y 4:** crear primer almacén, invitar usuarios (opcional).

---

## 5. Dashboard

**Ruta:** `/dashboard` · **Acceso:** todos los roles autenticados (contenido varía)

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard — {Hoy 17 May 2026}                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Ventas  │ │Productos│ │ Stock   │ │Almacenes│           │
│  │  hoy    │ │ activos │ │  bajo   │ │ activos │           │
│  │ $12,540 │ │  1,250  │ │   23    │ │    3    │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│                                                             │
│  ┌──────────────────────────┐  ┌────────────────────────┐  │
│  │  Ventas últimos 30 días  │  │  Productos bajo stock  │  │
│  │                          │  │  ──────────────────    │  │
│  │   📈 (gráfico de área)   │  │  • Paracetamol 500mg   │  │
│  │                          │  │  • Ibuprofeno 400mg    │  │
│  │                          │  │  • Amoxicilina 500mg   │  │
│  │                          │  │  ...                   │  │
│  └──────────────────────────┘  └────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────┐  ┌────────────────────────┐  │
│  │  Movimientos recientes   │  │   Atajos rápidos       │  │
│  │  ──────────────────      │  │   [Nueva venta]        │  │
│  │  • 14:30 Entrada factura │  │   [Nuevo producto]     │  │
│  │  • 13:15 Venta #4521     │  │   [Inventario físico]  │  │
│  │  • 12:00 Traspaso A→B    │  │                        │  │
│  └──────────────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Acciones por rol:**

| Rol | Ve KPIs | Ventas | Stock bajo | Atajos |
|---|:-:|:-:|:-:|---|
| TenantAdmin | ✅ | ✅ | ✅ | Todos |
| Manager | ✅ | ✅ | ✅ | Sin "Crear usuario" |
| POS_Seller | Solo ventas | ✅ | ❌ | Solo "Nueva venta" |
| Viewer | ✅ | ✅ | ✅ | Solo ver reportes |

---

## 6. Catálogo

### 6.1 Productos — Lista

**Ruta:** `/catalog/products` · **Permiso:** `products:read`

```
┌────────────────────────────────────────────────────────────────┐
│  Catálogo > Productos                                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  🔍 (Buscar SKU, nombre, código de barras...)                  │
│                                                                │
│  ▼ Filtros: Forma farmacéutica · Laboratorio · Stock bajo     │
│                                                                │
│  [📥 Importar Excel]   [➕ Nuevo producto]   [📤 Exportar]    │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ SKU       │ Nombre              │ Precio │ Stock │ ⋮  │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ PAR-500   │ Paracetamol 500mg   │ $15.00 │  120  │ ⋮  │   │
│  │ IBU-400   │ Ibuprofeno 400mg    │ $22.50 │   ⚠5  │ ⋮  │   │
│  │ AMX-500   │ Amoxicilina 500mg   │ $45.00 │   80  │ ⋮  │   │
│  │ ...                                                    │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  ◄ 1 2 3 ... 25 ►            Mostrando 1-20 de 1,250          │
└────────────────────────────────────────────────────────────────┘
```

**Acciones disponibles por rol:**

| Acción | TenantAdmin | Manager | Otros |
|---|:-:|:-:|:-:|
| Buscar y filtrar | ✅ | ✅ | ✅ (lectura) |
| Crear producto | ✅ | ✅ | ❌ |
| Editar producto (`⋮ → Editar`) | ✅ | ✅ | ❌ |
| Ver detalle (`⋮ → Ver`) | ✅ | ✅ | ✅ |
| Ver kardex (`⋮ → Kardex`) | ✅ | ✅ | ✅ |
| Eliminar (`⋮ → Eliminar`) | ✅ | ❌ | ❌ |
| Importar Excel | ✅ | ✅ | ❌ |
| Exportar Excel | ✅ | ✅ | ✅ |

---

### 6.2 Producto — Detalle / Form

**Rutas:** `/catalog/products/new` y `/catalog/products/{id}` · **Permiso:** `products:manage`

**Modo creación** — solo tab "Información" hasta guardar:

```
┌────────────────────────────────────────────────────────────────┐
│  Catálogo > Productos > Nuevo                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ─── Datos generales ─────────────────────────────────         │
│                                                                │
│   SKU *                       Stock mínimo                     │
│   (___________________)       (_____)                          │
│                                                                │
│   Nombre comercial *                                           │
│   (_________________________________________________)         │
│                                                                │
│   Unidad base *               ¿Producto compuesto?            │
│   ▼ Mililitro (ml)            ☐ Este producto se prepara      │
│                                  a partir de otros del         │
│                                  catálogo (kit, lente, etc.)   │
│                                                                │
│  ─── Campos personalizados del tenant ───────────────         │
│                                                                │
│   Sustancia activa *                                           │
│   (_________________________________________________)         │
│                                                                │
│   Laboratorio *                                                │
│   ▼ Seleccionar...                                            │
│                                                                │
│   {resto de campos dinámicos según el schema del tenant}      │
│                                                                │
│                            [Cancelar]  [Guardar producto]      │
└────────────────────────────────────────────────────────────────┘
```

**Modo edición** — tabs: `[Información] [Presentaciones] [Composición]* [Stock por almacén] [Kardex]`
*(la pestaña "Composición" aparece solo si el producto es compuesto)*

---

#### Tab "Presentaciones" — tabla inline simple

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Leche Lala — Presentaciones                                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Unidad base: ml (mililitros, categoría 'volume')                       │
│   Stock actual: 4,500 ml  ≈  4.5 cajas de 1L  ≈  22 vasos de 200ml       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Nombre    │ Factor→ml │🛒│💵│Default│🔢Solo enteros │ Precio │ ✕ │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ Caja 1L   │  1,000   │✅│✅│   ◉   │  ☑ (override) │ $35.00 │ ✕ │ │
│  │ Vaso 200ml│    200   │❌│✅│   ○   │  ☐            │ $12.00 │ ✕ │ │
│  │ Granel/ml │      1   │❌│❌│   ○   │  ☐            │   —    │ ✕ │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│   [ + Agregar presentación ]                                             │
│                                                                          │
│   ℹ️ "Solo enteros" controla si el POS y movimientos permiten decimales │
│      en esta presentación. Default según categoría de la unidad base:    │
│      • count (pastillas) → ☑ siempre                                    │
│      • volume/weight/length → ☐ pero se puede activar manualmente       │
│                                                                          │
│                                              [Cancelar]  [Guardar]       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Acciones:**
- Agregar presentación → fila inline editable. Submit valida factor > 0 y nombre único por producto.
- Marcar "Default": radio, una sola por producto. Es la que aparece pre-seleccionada en POS.
- Toggle "🔢 Solo enteros": viene pre-marcado según la categoría de la unidad base; el TenantAdmin puede activarlo manualmente para presentaciones cerradas (paquetes, frascos, rollos).
- Eliminar presentación: bloqueado si hay ventas históricas que la referencian (mensaje claro con CTA "Marcar como inactiva").

**Casos de uso relacionados:** [CU-CAT-05](CASOS_DE_USO.md#cu-cat-05--definir-presentaciones-de-un-producto).

---

#### Tab "Composición" — editor inline para productos compuestos

> Aparece **solo** si el producto tiene `is_composite = true`.
>
> **Vocabulario neutro (LEY de genericidad):** *composición* y *componente*, nunca
> *receta* ni *ingrediente*. El ejemplo de abajo es una óptica; el mismo editor sirve a
> una ferretería que arma kits o a una cafetería que prepara bebidas.

```
┌────────────────────────────────────────────────────────────────────┐
│  Lente terminado monofocal — Composición                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   🔍 (Buscar producto del catálogo para agregar como componente)   │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Componente                   │ Cantidad │ Unidad │ Merma │ ✕ │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ Armazón acetato clásico      │    (1)   │ unidad │ (0%)  │ ✕ │ │
│  │ Cristal CR-39 antirreflejo   │    (2)   │ unidad │ (5%)  │ ✕ │ │
│  │ Estuche rígido               │    (1)   │ unidad │ (0%)  │ ✕ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ─── Resumen en vivo ───────────────────────────                  │
│                                                                    │
│   💵 Costo estimado:    $480.00                                    │
│      • Armazón (1 × $260.00):  $260.00                             │
│      • Cristal (2 × $100.00):  $200.00                             │
│      • Estuche (1 × $20.00):    $20.00                             │
│                                                                    │
│   📦 Alcanza para:  18 unidades                                   │
│      ⚠ Limitado por: Cristal CR-39 (38 en stock ÷ 2 por unidad)   │
│                                                                    │
│   💰 Precio de venta sugerido (margen 70%):  $816.00               │
│                                                                    │
│                                  [Cancelar]  [Guardar composición] │
└────────────────────────────────────────────────────────────────────┘
```

**Acciones:**
- Buscar componente: autocompletado server-side. Muestra nombre + `base_unit` + stock global.
- Agregar componente: fila inline. Cantidad **por UNA unidad** del compuesto. Unidad **pre-cargada y no editable** desde el `base_unit` del componente. Merma % opcional (default 0).
- Quitar componente: ✕ inline.
- Guardar: valida que no haya recursión (un producto no puede ser componente de sí mismo, ni directa ni indirectamente). Mensaje claro si la hay.

**Filosofía UX:** sin wizards, sin pasos, sin drag-and-drop. Solo una tabla editable y un picker. **El TenantAdmin no debería necesitar entrenamiento para usar esto.**

**Casos de uso relacionados:** [CU-CAT-06](CASOS_DE_USO.md#cu-cat-06--definir-la-composición-de-un-producto-compuesto-bom).

---

### 6.3 Editor de Schema (campos de cualquier catálogo)

**Ruta:** `/catalog/schema` · **Permiso:** `catalogs:manage` (solo TenantAdmin)

> **Actualizado en la atomización de F2 (2026-08-16):** sin versiones ni publicación —
> editor simple con guardas (decisión de Carlos; el mockup previo con "v2/publicar/
> historial/migrar" quedó obsoleto). Edita los campos de **cualquier** catálogo: el de
> Productos o un subcatálogo del tenant.

```
┌────────────────────────────────────────────────────────────────┐
│  Catálogo > Schema                                             │
├────────────────────────────────────────────────────────────────┤
│  Catálogo: ▼ Catálogo de Productos      [+ Nuevo subcatálogo]  │
│                                                                │
│  ┌──────────────────────────┐  ┌─────────────────────────┐    │
│  │  CAMPOS ESTÁNDAR (fijos) │  │  PREVISUALIZACIÓN       │    │
│  │  Código (SKU) · Nombre   │  ├─────────────────────────┤    │
│  │  Precio · Costo · Unidad │  │ Código (SKU) *          │    │
│  ├──────────────────────────┤  │ (_______________)       │    │
│  │  CAMPOS PERSONALIZADOS   │  │ Sustancia activa *      │    │
│  │                          │  │ (_______________)       │    │
│  │ ☰ Sustancia activa  ✏️ 🗑│  │ Laboratorio *           │    │
│  │   texto · requerido      │  │ ▼ Seleccionar...        │    │
│  │ ☰ Laboratorio  ✏️ 🗑     │  │ {campos según el        │    │
│  │   lookup → Laboratorios  │  │  catálogo elegido}      │    │
│  │ ☰ Registro SSA  ✏️ 🗑    │  │                         │    │
│  │   texto · opcional       │  │                         │    │
│  │ [+ Agregar campo]        │  │                         │    │
│  └──────────────────────────┘  └─────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

**Acciones (solo TenantAdmin):**
- Selector de catálogo + crear subcatálogo nuevo
- ➕ Agregar campo (etiqueta, tipo **Texto / Numérico / Lookup** con catálogo destino, requerido)
- ✏️ Editar etiqueta/requerido/orden
- 🗑 Quitar campo **con guardas**: con datos pide confirmación explícita ("N registros tienen este campo; se ocultará, no se borra") y lo archiva recuperable; cambiar el tipo con datos está bloqueado
- Los campos estándar se muestran fijos, sin controles de edición
- Los cambios aplican al guardar cada campo — sin versiones, sin publicación

---

### 6.4 Importar desde Excel

**Modal sobre `/catalog/products`** · **Permiso:** `products:manage`

```
┌──────────────────────────────────────────────┐
│  Importar productos desde Excel              │
├──────────────────────────────────────────────┤
│                                              │
│  1. Descarga la plantilla con los campos     │
│     del schema activo:                       │
│     [📥 Descargar plantilla]                │
│                                              │
│  2. Llena la plantilla y súbela:             │
│     ┌──────────────────────────────────┐    │
│     │   📁 Arrastra archivo aquí       │    │
│     │   o haz click para seleccionar   │    │
│     └──────────────────────────────────┘    │
│                                              │
│  3. Validación previa:                       │
│     ✓ 245 filas válidas                     │
│     ⚠ 3 filas con error → [Ver detalles]    │
│                                              │
│  ☐ Saltar las filas con error e importar    │
│    solo las válidas                          │
│                                              │
│             [Cancelar]  [Importar 245]       │
└──────────────────────────────────────────────┘
```

---

### 6.5 Servicios — Lista y alta

**Ruta:** `/catalog/services` · **Permiso:** `services:read`

> **Nuevo en F3-SVC (2026-08-19):** el catálogo de lo que el negocio **vende pero no almacena** — un corte de pelo, una reparación, una consulta. Tabla propia y no un producto con bandera: un servicio no tiene unidad base, ni lotes, ni stock, ni presentaciones, y nunca aparece en Entradas, Salidas, Conteos ni Kardex. El POS de F4 lo cobra igual que a un producto.
>
> **Extendido en F3-SVC-06..09 (servicios por almacén):** esta pantalla es el **catálogo MAESTRO**, y cada servicio declara **en qué almacenes se ofrece**. Semántica explícita: **sin almacenes marcados, el servicio no se vende en ninguno** (al revés que el alcance de usuarios, donde vacío = todos). El alta nace con todos marcados —desmarcar es restringir— y el POS de F4 solo ofrece los asociados al almacén del turno. **Consecuencia a tener presente: un almacén nuevo nace sin servicios** hasta que alguien los asocie desde acá.

```
┌────────────────────────────────────────────────────────────────┐
│  Catálogo › Servicios                     [➕ Nuevo servicio]   │
│                                                                │
│  Buscar servicio                                               │
│  ┌──────────────────────────┐                                  │
│  │ Código o nombre…         │                                  │
│  └──────────────────────────┘                                  │
│                                                                │
│  │ Código │ Nombre          │ Costo │ Precio │Almacén│ Estado│       │
│  ├────────┼─────────────────┼───────┼────────┼────────┼───────┤│
│  │ CORTE  │ Corte de cabello│  40   │  150   │ 2 de 2│ Activo│ ⋮   ││
│  │ TINTE  │ Tinte completo  │ 120   │  450   │ 1 de 2│ Activo│ ⋮   ││
│  │ MANI   │ Manicura        │  30   │  120   │ 0 de 2│Inactivo│ ⋮  ││
└────────────────────────────────────────────────────────────────┘
```

**Form (alta y edición, en línea sobre la tabla):**

```
┌──────────────────────────────────────────────┐
│  Nuevo servicio                              │
│                                              │
│  Código *              Nombre *              │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │ CORTE        │      │ Corte de cabello │  │
│  └──────────────┘      └──────────────────┘  │
│  El nombre corto con el                      │
│  que lo buscas al cobrar.                    │
│                                              │
│  Descripción                                 │
│  ┌────────────────────────────────────────┐  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Costo                 Precio                │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │ 40.00        │      │ 150.00           │  │
│  └──────────────┘      └──────────────────┘  │
│                        Lo que cobras por     │
│                        este servicio.        │
│                                              │
│  Almacenes donde se ofrece                   │
│                        [Deseleccionar todos] │
│  Marca dónde se puede vender este servicio.  │
│    ☑ Almacén Central                         │
│    ☑ Sucursal Norte                          │
│                                              │
│             [Guardar]  [Cancelar]            │
└──────────────────────────────────────────────┘
```

Con **cero almacenes marcados** el form avisa: «Sin almacenes marcados, este servicio NO se podrá vender en ninguno». Es un estado **válido** —un servicio en preparación— pero nunca silencioso.

**Acciones disponibles por rol**

| Acción | TenantAdmin | Manager | POS_Seller | Viewer |
|---|---|---|---|---|
| Ver el catálogo | ✅ | ✅ | ✅ (para vender) | ✅ |
| Crear / editar | ✅ | ✅ | ❌ | ❌ |
| Desactivar | ✅ | ✅ | ❌ | ❌ |
| Eliminar | ✅ | ✅ | ❌ | ❌ |

**Desactivar vs eliminar:** desactivar lo esconde del POS y se deshace con un clic — **no pide confirmación**. Eliminar lo borra sin vuelta atrás y **sí** la pide, con el diálogo nombrando la alternativa. Cuando F4 traiga ventas, un servicio ya vendido dejará de poder eliminarse (409) y desactivar será la única salida.

---

## 7. Almacenes

**Ruta:** `/warehouses` · **Permiso:** `warehouses:read`

```
┌────────────────────────────────────────────────────────────────┐
│  Almacenes                                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  🔍 (Buscar...)                          [➕ Nuevo almacén]   │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Nombre        │ Ubicación         │ Productos │ Estado ⋮ │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ Central       │ CDMX · Roma Norte │   1,250   │  ●  ⋮   │ │
│  │ Sucursal Sur  │ CDMX · Coyoacán   │     830   │  ●  ⋮   │ │
│  │ Bodega Norte  │ EdoMex · Tlalnepantla │ 2,100 │  ●  ⋮   │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Form de creación/edición:**

> **Actualizado en la atomización de F2 (2026-08-16):** la dirección es **texto libre
> opcional** — el desglose colonia/alcaldía/estado del mockup previo era México-céntrico
> y SellPoint vende a 26 mercados (MERCADOS.md §4: los formatos postales difieren). Los
> **racks quedaron FUERA de F2**: no existen en ningún modelo de datos y se decidirán
> cuando llegue el stock por ubicación.

```
┌────────────────────────────────────────────────────────────────┐
│  Nuevo almacén                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Nombre del almacén *                                         │
│   (_________________________________________________)          │
│                                                                │
│   Dirección                                                    │
│   (_________________________________________________)          │
│   (_________________________________________________)          │
│                                                                │
│                            [Cancelar]  [Guardar almacén]       │
└────────────────────────────────────────────────────────────────┘
```

**Acciones (TenantAdmin/Manager):** crear, editar, desactivar. Desactivar pide confirmación; la validación "no desactivar con stock" llega con F3 (hoy no hay movimientos).

---

## 8. Movimientos

> **Evolución (atomización F3, 2026-08-17).** Los mockups de esta sección quedan alineados con el tablero de F3: **sin campo `Fecha`** en entradas y salidas (no hay backdating — `created_at` es el momento real, el kardex es cronología real); **sin `Producción interna`** (los compuestos nunca tienen stock persistido); "Merma / Daño" va bajo `adjustment` (o `loss` si es pérdida) — el enum no tiene `waste`; el motivo `transfer` **no aparece en el form de entrada** (la recepción se hace desde "Traspasos en tránsito"); en Inventario físico **no hay checkbox de bloqueo** y la plantilla es **una sola**: `sku, nombre, unidad, lote, caducidad, ubicación, teórico, contado` — los productos que controlan lotes (`tracks_lots`) ocupan una fila por (lote, ubicación), los demás una fila con esas columnas vacías (F3-LOTS, mismo día: lote/caducidad/ubicación son dimensiones genéricas del stock, opt-in por producto; la salida y el POS aplican **FEFO**); **aprobar** el conteo y **cancelar** un traspaso exigen `inventory:manage` (solo TenantAdmin). El detalle de producto gana dos tabs: **Kardex** y **Stock por almacén** (con total, bajo mínimo y en tránsito).
>
> **Evolución (documentos con borrador, 2026-08-18).** Cada serie tiene ahora **su propio menú y su propio listado** — Entradas, Salidas, Inventario — con buscador por folio, filtro de estatus y botón de crear (§ 8.6, un mismo componente montado tres veces). Ese botón **crea el borrador con su folio** y abre la pantalla del documento (§ 8.7), que es una sola: en `draft` es captura con **autoguardado** y panel de previa en vivo (stock actual → resultante), y en `confirmed` es solo lectura. Un movimiento a medio cargar **se retoma buscando su folio**, incluso desde otra máquina u otro usuario. **Tres series y nada más**: `ENT`, `SAL`, `INV` — un traspaso es una `SAL` con motivo Traspaso y su recepción una `ENT` con el mismo motivo, porque el motivo no cambia el tipo de papel.

### 8.1 Entradas

**Rutas:** `/movements/entries` (listado con buscador por folio + botón «Nueva entrada») → `/movements/documents/$documentId` (captura) · **Permiso:** `inventory:movement`

> Una sola pantalla cubre todos los casos de entrada. El campo **Motivo** dispara campos contextuales adicionales.
>
> La captura vive en la pantalla del documento, que es común a Entradas, Salidas e Inventario Físico: el borrador nace con folio, así que se puede cerrar el sistema a mitad de la carga y retomarlo buscándolo por folio.

```
┌────────────────────────────────────────────────────────────────┐
│  Movimientos > Nueva Entrada                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ─── Cabecera ─────────────────────────────────────            │
│                                                                │
│   Almacén destino *                                            │
│   ▼ Central                                                    │
│                                                                │
│   Motivo *                                                     │
│   ▼ Factura/Compra                                             │
│     ──────────────                                             │
│     Factura/Compra                                             │
│     Ajuste                                                     │
│     Traspaso (desde otro almacén)                              │
│     Devolución de cliente                                      │
│                                                                │
│                                                                │
│  ─── Campos según motivo ─────────────────────                │
│  {motivo = Factura}                                            │
│   Referencia (nº de documento) *                               │
│   (FAC-001-2026)                                               │
│   Costo unitario por línea (columna adicional en la tabla)     │
│   ℹ️ Sin catálogo de proveedores: si lo necesitás, armalo como  │
│      subcatálogo. El nº de documento va en Referencia.          │
│                                                                │
│  {motivo = Traspaso}  ← no está en este form: la recepción     │
│   se confirma desde "Traspasos en tránsito" (§ 8.3), que       │
│   manda el transfer_id. Una entrada 'transfer' sin traspaso    │
│   se rechaza; para corregir un traspaso mal hecho, usá Ajuste. │
│                                                                │
│  {motivo = Ajuste / Devolución}                                │
│   Nota *                  Autoriza (opcional)                  │
│   (_______________________)  ▼ Juan Pérez                     │
│                                                                │
│  ─── Productos ───────────────────────────────────             │
│                                                                │
│   📷 [Escanear código]  o  🔍 (Buscar producto...)            │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ SKU     │ Producto         │ Cant. │ {Costo}* │ Tot.│    │
│   ├──────────────────────────────────────────────────────┤    │
│   │ PAR-500 │ Paracetamol 500mg│  50   │  $10.00  │ $500│ 🗑 │
│   │ IBU-400 │ Ibuprofeno 400mg │  30   │  $15.00  │ $450│ 🗑 │
│   └──────────────────────────────────────────────────────┘    │
│   * Columna Costo solo visible si motivo=Factura               │
│                                                                │
│                                       Total: $950.00           │
│                                                                │
│   💾 Guardado · ENT-000042 · Borrador                          │
│                          [Anular]        [Confirmar entrada]   │
└────────────────────────────────────────────────────────────────┘
```

**Carga por Excel (alternativa a cargar producto por producto):**

```
│  ─── Cargar desde archivo ─────────────────────────            │
│   📥 [Descargar plantilla .xlsx] [.csv]                        │
│      (columnas: sku, presentacion, cantidad,                   │
│       costo_unitario, lote, caducidad, ubicacion)              │
│   📎 [ Elegir archivo ]  entrada-agosto.xlsx                   │
```

**Panel de previa (siempre visible, se actualiza al editar):**

```
┌────────────────────────────────────────────────────────────────┐
│  Previa — ENT-000042 · Borrador · Almacén Central              │
│  Motivo: Factura de compra · Ref: F-88213                      │
├────────────────────────────────────────────────────────────────┤
│  12 líneas · 12 productos · 1 lote nuevo · 1 error             │
│                                                                │
│  # SKU      Producto      Present.  Cant.   Stock              │
│  1 PAR-500  Paracetamol   Caja x12  3 = 36   10 → 46           │
│  2 IBU-400  Ibuprofeno    Unidad        50    0 → 50  🆕 lote  │
│  3 XXX-999  —                          10     —                │
│    ⚠ Fila 3: no existe un producto con ese código             │
│                                                                │
│                            [Confirmar entrada]                 │
│                             (bloqueado: hay 1 error)           │
└────────────────────────────────────────────────────────────────┘
```

**Al confirmar,** la misma pantalla pasa a solo lectura:

```
│  ENT-000042 · Confirmado · 18/08/2026 19:42                    │
│     [ Descargar PDF ]              [ Volver a Entradas ]       │
```

**Acciones:**
- Cambiar el motivo dispara reactividad en la UI (muestra/oculta campos contextuales)
- Escanear con cámara o buscar manualmente (predictivo por SKU/nombre/barcode)
- Descargar la plantilla y subir un archivo (reemplaza o suma líneas a la tabla)
- Editar cantidad (y costo unitario si motivo=Factura) en cada línea
- Eliminar línea
- Todo se **guarda solo** con debounce; el indicador dice "Guardado". Se puede cerrar el sistema y volver por el folio (§ 8.6)
- **Confirmar** dispara la transacción atómica; el folio ya lo tenía desde que nació el borrador
- **Anular** deja el documento `canceled` con su folio (la serie no pierde números)

**Casos de uso relacionados:** [CU-MOV-01](CASOS_DE_USO.md#cu-mov-01--registrar-una-entrada).

**Selector de presentación al agregar línea:** cuando el usuario escanea o busca un producto, si tiene varias **presentaciones comprables**, aparece un selector inline (ej: "Caja 1L" / "Caja 2L" / "Granel"). El sistema convierte automáticamente la cantidad ingresada a la `base_unit` del producto al persistir el movimiento.

---

### 8.2 Salidas

**Rutas:** `/movements/exits` (listado con buscador por folio + botón «Nueva salida») → `/movements/documents/$documentId` (captura) · **Permiso:** `inventory:movement`

> Una sola pantalla cubre todos los casos de salida. El campo **Motivo** dispara campos contextuales y validaciones. Entre ellos, **Traspaso**: ver § 8.3.

```
┌────────────────────────────────────────────────────────────────┐
│  Movimientos > Nueva Salida                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Almacén origen *                                             │
│   ▼ Central                                                    │
│                                                                │
│   Motivo *                                                     │
│   ▼ Ajuste                                                     │
│     ──────────────                                             │
│     Ajuste / Merma / Daño                                      │
│     Traspaso (a otro almacén)                                  │
│                                                                │
│     Pérdida / Robo                                             │
│     Consumo interno                                            │
│     Caducado                                                   │
│                                                                │
│  ─── Campos según motivo ─────────────────────                │
│  {motivo = Traspaso}                                           │
│   Almacén destino *                                            │
│   ▼ Sucursal Sur                                               │
│   ℹ️ Al confirmar, el stock queda EN TRÁNSITO hasta que        │
│      Sucursal Sur confirme la recepción. Mirá el estado en     │
│      la vista 'Traspasos en tránsito'.                         │
│                                                                │
│  {motivo = Ajuste / Merma / Pérdida / Caducado}               │
│   Autoriza *              Nota *                               │
│   ▼ Juan Pérez            (_____________________________)     │
│                                                                │
│  {motivo = Consumo interno}                                    │
│   Área / Concepto *                                            │
│   (Limpieza, EPP, evento, etc.)                                │
│                                                                │
│  ─── Productos ──                                              │
│   📷 [Escanear]  🔍 (Buscar...)                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │ SKU     │ Producto         │ Disponible │ Cantidad  │    │
│   ├──────────────────────────────────────────────────────┤    │
│   │ PAR-500 │ Paracetamol 500mg│    120     │   (50)    │ 🗑 │
│   │ IBU-400 │ Ibuprofeno 400mg │     30     │   (15)    │ 🗑 │
│   └──────────────────────────────────────────────────────┘    │
│   ⚠ Validación en vivo: bloquea cantidad > stock disponible   │
│                                                                │
│   💾 Guardado · SAL-000019 · Borrador                          │
│                          [Anular]        [Confirmar salida]    │
└────────────────────────────────────────────────────────────────┘
```

**Acciones:**
- Cambiar motivo dispara campos contextuales
- Validación en vivo de stock disponible (no permite confirmar si excede)
- Descargar plantilla (`sku, presentacion, cantidad, lote, ubicacion` — sin costo: una salida no tiene precio de compra) y subir un Excel
- El panel de previa suma el **Disponible** por línea y, en productos con lote, **de qué lote saldría por FEFO** ("saldrá 1 del lote st10, vence 01/07/2026")
- El folio es `SAL-000019` **también cuando el motivo es Traspaso**: un traspaso no tiene serie propia, y la nota de envío es el PDF de esa salida

**Casos de uso relacionados:** [CU-MOV-02](CASOS_DE_USO.md#cu-mov-02--registrar-una-salida).

**Selector de presentación y productos compuestos:** análogo a Entrada. Si el motivo es `consumption` o `expired` y el producto es compuesto, se descuentan los componentes en transacción atómica (no el compuesto en sí).

---

### 8.3 Traspasos en Tránsito

**Ruta:** `/movements/transfers` · **Permiso:** `inventory:read` (ver) · `inventory:movement` (confirmar recepción)

> Stock que está fuera del almacén origen pero todavía no fue confirmado en el destino. Visibilidad crítica para detectar pérdidas o demoras.

**El traspaso no tiene pantalla de captura propia ni serie de folios propia.** Es un par de documentos que ya existen:

| Etapa | Qué es | Dónde se captura | Folio |
|---|---|---|---|
| Despacho | **Salida** con motivo `transfer` + almacén destino | § 8.2 Salidas | `SAL-…` |
| Recepción | **Entrada** con motivo `transfer`, líneas precargadas con lo enviado | § 8.1 Entradas | `ENT-…` |

Al confirmar la salida, el stock baja en el origen y queda **en tránsito**: no suma en el destino hasta que alguien confirma la entrada. Esta pantalla no captura nada — muestra el **estado del viaje** (qué salió y todavía no llegó, y hace cuánto), que es lo único que no se ve desde Entradas ni Salidas.

```
┌────────────────────────────────────────────────────────────────┐
│  Movimientos > Traspasos en Tránsito                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────┐ ┌────────────────────────────┐       │
│  │ Pendientes de recibir│ │ Pendientes de enviar (mis) │       │
│  │        (3)           │ │           (1)              │       │
│  └──────────────────────┘ └────────────────────────────┘       │
│                                                                │
│   Filtros: Fecha 📅 | Origen ▼ | Destino ▼ | Antigüedad ▼     │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Folio   │ Fecha   │ Origen   │ Destino │ Líneas │ Días │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ SAL-127 │ 17/05   │ Norte    │ Central │   8    │  0   │   │
│  │ SAL-124 │ 16/05   │ Norte    │ Central │   3    │  1   │   │
│  │ SAL-118 │ 09/05   │ Sur      │ Central │  12    │ 🟠 8 │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│   🟠 = más de 7 días en tránsito (revisar si llegó)           │
│                                                                │
│   {Click en una fila → confirmar que vas a recibirlo}          │
└────────────────────────────────────────────────────────────────┘
```

**Confirmación de intención** (al hacer click en un traspaso pendiente de recibir):

```
┌────────────────────────────────────────────────────────┐
│  Recibir el traspaso SAL-000124                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│   Bodega Norte → Central  ·  3 líneas                  │
│   Enviado: 16/05/2026  ·  Autorizó: María López        │
│                                                        │
│   Se va a crear una Entrada en borrador con las        │
│   cantidades enviadas ya cargadas. Ahí ajustas lo      │
│   que realmente llegó y la confirmas.                  │
│                                                        │
│                     [Cancelar]  [Crear entrada]        │
└────────────────────────────────────────────────────────┘
```

Este diálogo **no captura cantidades**: `POST /transfers/:id/receipt-draft` crea el borrador `ENT-…` y navega a `/movements/documents/$id`. El conteo real ocurre ahí, en la misma pantalla de documento que cualquier entrada — con las mismas columnas, las mismas validaciones y, sobre todo, con folio: si el sistema se cierra a mitad de la descarga del camión, la recepción se retoma buscando ese folio. Un modal no sobrevive a un F5.

En la pantalla del documento, la cara de recepción agrega la columna **Enviado** junto a la cantidad, y:

- **Recibido < enviado** → nota explicativa obligatoria; la diferencia queda como merma del traspaso.
- **Recibido > enviado** → bloqueado. Si llegó excedente, se registra como Entrada aparte con motivo Ajuste.

**Acciones (TenantAdmin/Manager del almacén destino):**
- Confirmar sin diferencias
- Confirmar con diferencia menor (cantidad recibida < enviada) → nota obligatoria
- Cancelar traspaso (caso edge: nunca llegó por robo total) → solo TenantAdmin, requiere justificación

**Casos de uso relacionados:** [CU-MOV-03](CASOS_DE_USO.md#cu-mov-03--confirmar-recepción-de-traspaso), [CU-MOV-04](CASOS_DE_USO.md#cu-mov-04--ver-traspasos-en-tránsito).

---

### 8.4 Inventario Físico

**Rutas:** `/movements/counts` (listado con buscador por folio + botón «Nuevo conteo») → `/movements/documents/$documentId` (captura) · **Permiso:** `inventory:movement`

**Paso 1 — Iniciar conteo:**

```
┌────────────────────────────────────────────────────────────────┐
│  Inventario Físico                                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Almacén a inventariar *                                      │
│   ▼ Central                                                    │
│                                                                │
│   ℹ️ El conteo se aplica sobre el saldo del momento de aprobar │
│                                                                │
│   📥 [Descargar plantilla .xlsx] [.csv]                       │
│      (columnas: sku, nombre, unidad, lote, caducidad,          │
│       ubicación, teórico, contado — lote/cad./ubic. vacíos     │
│       en productos que no controlan lotes)                     │
│                                                                │
│   ─── Sube tu Excel completado ──                              │
│   ┌──────────────────────────────────────┐                    │
│   │   📁 Arrastra o selecciona archivo   │                    │
│   └──────────────────────────────────────┘                    │
│                                                                │
│                                  [Procesar inventario]         │
└────────────────────────────────────────────────────────────────┘
```

**Paso 2 — Reporte de discrepancias:**

```
┌────────────────────────────────────────────────────────────────┐
│  Reconciliación — Almacén Central                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Resumen:                                                      │
│    Productos contados: 1,247                                   │
│    Coincidencias exactas: 1,180                                │
│    Discrepancias: 67                                           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ SKU     │ Teórico │ Contado │ Diferencia │ Ajuste neto │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ PAR-500 │   120   │   115   │     -5     │   -5 unid.  │ │
│  │ IBU-400 │     5   │    12   │     +7     │   +7 unid.  │ │
│  │ AMX-500 │    80   │    78   │     -2     │   -2 unid.  │ │
│  │ ...                                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ⚠ Al aprobar, el sistema generará:                           │
│    • Salida total del stock teórico                            │
│    • Entrada total del stock contado                           │
│    • Todas las diferencias quedarán en el audit log            │
│                                                                │
│             [Cancelar]    [Descargar reporte]    [Aprobar]     │
└────────────────────────────────────────────────────────────────┘
```

---

### 8.5 Histórico de Movimientos / Kardex

**Ruta:** tab **Kardex** dentro de `/catalog/products` (detalle de producto) — `GET /products/:id/kardex` · **Permiso:** `inventory:read` · *(`/movements/history` como vista global no está en F3; el kardex es una vista del producto)*

```
┌────────────────────────────────────────────────────────────────┐
│  Kardex — Paracetamol 500mg (SKU: PAR-500)                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Almacén: ▼ Todos     Rango: 📅 01/04 — 17/05/2026           │
│   Tipo movimiento: ▼ Todos                                     │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Fecha     │ Tipo          │ Cant │ Stock final │ Usuario │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ 17/05 14:30│ Entrada factura│ +50 │     120     │ Juan   │ │
│  │ 17/05 13:15│ Venta #4521    │  -2 │      70     │ María  │ │
│  │ 17/05 11:00│ Salida ajuste  │ -10 │      72     │ Juan   │ │
│  │ 16/05 18:45│ Venta #4498    │  -5 │      82     │ Pedro  │ │
│  │ ...                                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  [📤 Exportar Excel]                                          │
└────────────────────────────────────────────────────────────────┘
```

---

### 8.6 Listados por serie (Entradas · Salidas · Inventario)

**Rutas:** `/movements/entries` · `/movements/exits` · `/movements/counts` — **el mismo componente montado tres veces**, parametrizado por tipo · **Permiso:** `inventory:read` (crear exige `inventory:movement`)

> Es la puerta de entrada de cada serie: acá se busca por folio, se ve el estatus y se crea. **El botón de crear es el que genera el folio y el borrador.**

```
┌────────────────────────────────────────────────────────────────┐
│  Movimientos > Entradas                    [ + Crear entrada ] │
├────────────────────────────────────────────────────────────────┤
│  🔍 [ folio…            ]                                      │
│  ( Borradores )( Confirmados )( Anulados )                     │
│  [Almacén ▾] [Desde][Hasta] [Usuario ▾]                        │
├────────────────────────────────────────────────────────────────┤
│  Folio       Estado      Almacén   Motivo      Líneas  Quién   │
│  ENT-000043  ● Borrador  Central   Traspaso      8     J. Paz  │
│  ENT-000042  ✓ Confirmado Central  Factura      12     A. Ruiz │
│  ENT-000041  ✓ Confirmado Sucursal Devolución    2     C. Díaz │
│                                              ‹ 1 2 3 ›         │
└────────────────────────────────────────────────────────────────┘
```

- Por defecto **no lista los anulados**; entran con su chip.
- Un **borrador** se abre y se sigue cargando donde quedó ([CU-MOV-08](CASOS_DE_USO.md#cu-mov-08--retomar-un-movimiento-a-medio-cargar)).
- Sin `inventory:movement` el listado se ve pero el botón de crear no existe.
- En **Salidas**, los traspasos aparecen como cualquier salida, con motivo «Traspaso» y su destino.

---

### 8.7 Documento (captura y detalle)

**Ruta:** `/movements/documents/$documentId` · **Permiso:** `inventory:read` (editar y confirmar, `inventory:movement`; confirmar un conteo, `inventory:manage`)

> **Una sola pantalla con dos caras.** En `draft` es el formulario de captura con autoguardado y previa en vivo (los mockups de § 8.1 y § 8.2). En `confirmed` o `canceled` es solo lectura de lo que realmente pasó.

**Cabecera del confirmado:**

```
┌────────────────────────────────────────────────────────────────┐
│  ENT-000042   ✓ Confirmado          [ Descargar PDF ]          │
│  Entrada · Almacén Central · 18/08/2026 19:42          │
│  Motivo: Factura de compra · Ref: F-88213 · Registró: A. Ruiz  │
├────────────────────────────────────────────────────────────────┤
│  #  SKU      Producto      Present.   Cantidad   Costo         │
│  1  PAR-500  Paracetamol   Caja x12   3 = 36 u   $15.50        │
│  2  IBU-400  Ibuprofeno    Unidad         50 u   $ 9.00        │
└────────────────────────────────────────────────────────────────┘
```

En un documento confirmado las líneas muestran **lo que el ledger asentó**: si FEFO partió una línea en dos lotes, se ven los dos.

**El PDF:**

```
┌──────────────────────────────────────────────┐
│ DISTRIBUIDORA DEL NORTE S.A. DE C.V.         │
│ RFC: DNO010203AB4        ENTRADA     │
│                          Folio: ENT-000042   │
├──────────────────────────────────────────────┤
│ Almacén: Central      Fecha: 18/08/2026 19:42│
│ Motivo: Factura de compra   Ref: F-88213     │
│ Registró: Ana Ruiz                           │
├──────────────────────────────────────────────┤
│ #  SKU      Producto        Present.   Cant. │
│ 1  PAR-500  Paracetamol   Caja x12    3 = 36 │
│ 2  IBU-400  Ibuprofeno     Unidad         50 │
├──────────────────────────────────────────────┤
│ Total de líneas: 2                           │
│                                              │
│ ____________  ____________  ____________     │
│   Entregó       Recibió       Autorizó       │
└──────────────────────────────────────────────┘
```

**Notas de diseño:**
- El PDF de un **borrador** sale con marca de agua «BORRADOR» y el de un anulado, «ANULADO». Un papel sin marca es un papel que alguien va a firmar.
- **No hay un "total de unidades"**: sumar 36 unidades + 2.5 kg + 400 ml da un número que no significa nada. El pie cuenta **líneas**; la cantidad va por línea con su unidad.
- El cuerpo cambia por tipo: un inventario físico muestra **teórico / contado / diferencia** en vez de presentación y costo.
- Se renderiza en el servidor y se baja con el token en la cabecera (un `<a href>` plano daría 401), con el folio como nombre de archivo.
- Un documento de cientos de líneas sale paginado con el encabezado de la tabla repetido.

**Casos de uso relacionados:** [CU-MOV-07](CASOS_DE_USO.md#cu-mov-07--buscar-un-documento-y-reimprimir-su-pdf), [CU-MOV-08](CASOS_DE_USO.md#cu-mov-08--retomar-un-movimiento-a-medio-cargar).

---

## 9. Punto de Venta (POS)

### 9.1 Pantalla principal de venta

**Ruta:** `/pos` · **Permiso:** `pos:sell` · **PWA optimizada para tablet**

```
┌─────────────────────────────────────────────────────────────────┐
│  🛒 POS — Turno abierto desde 09:00          {María L. ▼}      │
├──────────────────────────────────────────┬──────────────────────┤
│                                          │                      │
│  📷 [   Escanear con cámara    ]         │      CARRITO         │
│                                          │                      │
│  🔍 (Buscar producto...)                 │  ┌────────────────┐  │
│                                          │  │ Paracetamol    │  │
│  ─── Acceso rápido ───                  │  │ 1 × $15.00     │  │
│                                          │  │           🗑   │  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │  │ [- 1 +]        │  │
│  │ 💊  │ │ 💊  │ │ 💊  │ │ 💊  │        │  ├────────────────┤  │
│  │PAR  │ │IBU  │ │AMX  │ │OME  │        │  │ Ibuprofeno     │  │
│  │$15  │ │$22  │ │$45  │ │$30  │        │  │ 2 × $22.50     │  │
│  └─────┘ └─────┘ └─────┘ └─────┘        │  │ [- 2 +]    🗑  │  │
│                                          │  └────────────────┘  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │                      │
│  │ 💊  │ │ 💊  │ │ 💊  │ │ 💊  │        │  Subtotal:   $60.00 │
│  │...  │ │...  │ │...  │ │...  │        │  Descuento:   -$0.00 │
│  └─────┘ └─────┘ └─────┘ └─────┘        │  ─────────────────  │
│                                          │  TOTAL:      $60.00  │
│                                          │                      │
│                                          │  [🗑 Vaciar]         │
│                                          │  [💳 COBRAR]        │
│                                          │                      │
└──────────────────────────────────────────┴──────────────────────┘
```

**Acciones:**
- Escanear código de barras con cámara (`@zxing/browser`)
- Búsqueda predictiva por SKU/nombre
- Acceso rápido a productos favoritos (configurables)
- Ajustar cantidad por línea (+/−)
- Eliminar línea
- Aplicar descuento global (botón emerge antes del COBRAR si tiene permiso)
- Vaciar carrito (con confirmación)
- Click COBRAR → abre modal

**Selector de presentación al agregar producto:**
- Si el producto tiene varias presentaciones **vendibles**, aparece un selector inline (radio buttons o botones segmentados) tras escanear/elegir. La presentación marcada como `is_default_sale=true` viene pre-seleccionada.
- El escaneo de un código de barras que coincida con el `barcode` de una presentación específica salta directamente a esa presentación (sin selector).
- El POS muestra el **precio** de la presentación seleccionada (ej: Caja 1L = $35, Vaso 200ml = $10).

**Numpad inteligente (cantidades enteras vs decimales):**
- Cuando la presentación elegida tiene `allow_fractional_input = false`, el numpad **oculta el botón `.`** → el cajero NO puede ingresar decimales por accidente. Aplica a: pastillas, cajas, blisters, frascos cerrados, rollos.
- Cuando es `true` (líquidos a granel, productos a peso, cable por metro), el numpad incluye el `.` y acepta hasta 4 decimales en el input.
- Si el cajero intenta pegar texto con punto decimal en una presentación entera, el sistema lo trunca con mensaje informativo: *"Esta presentación solo acepta cantidades enteras."*

**Productos compuestos:**
- Se ven y suman al carrito como cualquier producto.
- Internamente, al COBRAR, el sistema **expande la composición** y descuenta los componentes en transacción atómica (ver [CU-MOV-01](CASOS_DE_USO.md#cu-mov-01--registrar-una-entrada)).
- Si algún componente no tiene stock suficiente en el almacén del POS → la venta falla con mensaje claro indicando qué componente falta y cuántas unidades son posibles con el stock actual.
- El stock visible del compuesto en el POS es el **calculado en vivo**: `min(stock_componente_i / qty_i)`.

---

### 9.2 Modal de cobro

```
┌──────────────────────────────────────────────────┐
│           Cobrar — Total $60.00                  │
├──────────────────────────────────────────────────┤
│                                                  │
│   Método de pago                                 │
│   ┌─────────┐ ┌─────────┐ ┌─────────────┐       │
│   │ 💵      │ │ 💳      │ │ 🏦          │       │
│   │Efectivo │ │Tarjeta  │ │Transferencia│       │
│   └─────────┘ └─────────┘ └─────────────┘       │
│                                                  │
│   ─── Efectivo seleccionado ───                  │
│                                                  │
│   Monto recibido                                 │
│   ($_____________)                              │
│                                                  │
│   Vuelto: $40.00                                 │
│                                                  │
│   ☐ Enviar ticket por email a:                  │
│   (___________________________)                 │
│                                                  │
│   ☑ Imprimir ticket                             │
│                                                  │
│                [Cancelar]  [Confirmar venta]     │
└──────────────────────────────────────────────────┘
```

Después de confirmar:
- Toast "Venta #4523 registrada"
- Auto-imprime ticket
- Limpia carrito y vuelve a la pantalla principal lista para la siguiente venta

---

### 9.3 Historial de ventas

**Ruta:** `/pos/sales` · **Permiso:** `pos:view`

```
┌────────────────────────────────────────────────────────────────┐
│  POS > Historial de ventas                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   📅 Hoy  ▼     Vendedor: ▼ Todos                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ # Venta │ Hora   │ Total   │ Método   │ Vendedor   │ ⋮  │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  4523   │ 14:30  │ $60.00  │Efectivo  │ María L.   │ ⋮  │ │
│  │  4522   │ 14:15  │ $145.00 │ Tarjeta  │ María L.   │ ⋮  │ │
│  │  4521   │ 13:50  │ $80.00  │Efectivo  │ Pedro G.   │ ⋮  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Total del día: $4,520.00  ·  18 ventas                        │
└────────────────────────────────────────────────────────────────┘
```

**Acciones (menú ⋮):**
- Ver detalle del ticket
- Reimprimir
- Anular (solo TenantAdmin/Manager, registra devolución a stock)

---

### 9.4 Cierre de caja

**Ruta:** `/pos/close-cashbox` · **Permiso:** `pos:sell`

```
┌────────────────────────────────────────────────────────────────┐
│  Cierre de caja — Turno desde 09:00                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Vendedor: María López                                         │
│  Duración del turno: 7h 30min                                  │
│                                                                │
│  ─── Resumen ─────────────────────────                         │
│                                                                │
│   Efectivo (sistema):       $2,340.00     18 ventas            │
│   Tarjeta:                  $1,650.00     12 ventas            │
│   Transferencia:              $530.00      4 ventas            │
│                              ─────────                         │
│   Total del turno:          $4,520.00     34 ventas            │
│                                                                │
│  ─── Conteo físico ───────────────────                         │
│                                                                │
│   Efectivo contado en caja                                     │
│   ($____________)                                              │
│                                                                │
│   Diferencia: --                                               │
│                                                                │
│   Notas (opcional)                                             │
│   (_________________________________________________)          │
│                                                                │
│                  [Cancelar]  [Cerrar turno e imprimir]         │
└────────────────────────────────────────────────────────────────┘
```

---

## 10. Reportes

**Ruta:** `/reports` · **Permiso:** `reports:view`

```
┌────────────────────────────────────────────────────────────────┐
│  Reportes                                                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 📦 Stock por almacén│  │ 📋 Catálogo         │             │
│  │ Stock actual con    │  │ Listado completo de │             │
│  │ alertas             │  │ productos           │             │
│  └─────────────────────┘  └─────────────────────┘             │
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 💰 Ventas           │  │ 📜 Kardex           │             │
│  │ Por período /       │  │ Trazabilidad por    │             │
│  │ vendedor / método   │  │ producto            │             │
│  └─────────────────────┘  └─────────────────────┘             │
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 🏬 Almacenes        │  │ 👥 Usuarios         │             │
│  │ Listado de          │  │ Listado de usuarios │             │
│  │ almacenes           │  │ y roles             │             │
│  └─────────────────────┘  └─────────────────────┘             │
└────────────────────────────────────────────────────────────────┘
```

**Patrón común de cada reporte:**

```
┌────────────────────────────────────────────────────────────────┐
│  Reportes > Stock por almacén                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ─── Filtros ───                                               │
│   Almacén: ▼ Todos          Categoría: ▼ Todas                │
│   ☑ Solo productos bajo stock mínimo                          │
│                                                                │
│   [Aplicar filtros]  [Limpiar]  [📤 Exportar Excel]           │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ {Tabla server-side con paginación y ordenamiento}        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ◄ 1 2 3 ►            Mostrando 1-50 de 1,250                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 11. Sistema

### 11.1 Usuarios

**Ruta:** `/system/users` · **Permiso:** `users:manage` (solo TenantAdmin)

```
┌────────────────────────────────────────────────────────────────┐
│  Sistema > Usuarios                                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  🔍 (Buscar...)                       [➕ Nuevo usuario]      │
│                                                                │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │# Empp│Nombre       │Roles  │Alcance              │Estado │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ 001  │Juan Pérez   │Admin  │Todos los almacenes  │  ●   │ │
│  │ 002  │María López  │Manager│Centro, Sur          │  ●   │ │
│  │ 003  │Pedro García │POS    │Norte                │  ○   │ │
│  │ 004  │Ana Ruiz     │Viewer │Todos (sin scope)    │  ●   │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Form de creación/edición:**

```
┌────────────────────────────────────────────────────────────────┐
│  Nuevo usuario                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Número de empleado *                                         │
│   (___________________)                                       │
│                                                                │
│   Nombre *                Apellido paterno *                   │
│   (___________________)   (___________________)               │
│                                                                │
│   Apellido materno                                             │
│   (___________________)                                       │
│                                                                │
│   Email *                                                      │
│   (_________________________________________________)          │
│                                                                │
│   Roles asignados *                                            │
│   ☐ TenantAdmin                                               │
│   ☑ Manager                                                   │
│   ☐ POS_Seller                                                │
│   ☐ Viewer                                                    │
│                                                                │
│  ─── Alcance por almacén ────────────────────                  │
│                                                                │
│   ℹ️ Si no seleccionas ninguno, el usuario tendrá acceso       │
│      a TODOS los almacenes del tenant.                         │
│                                                                │
│   ☑ Sucursal Centro                                           │
│   ☐ Sucursal Norte                                            │
│   ☑ Sucursal Sur                                              │
│   ☐ Bodega Central                                            │
│                                                                │
│   ℹ️ El usuario recibirá un email para definir su password    │
│                                                                │
│                  [Cancelar]  [Crear y enviar invitación]       │
└────────────────────────────────────────────────────────────────┘
```

> **Nota:** si el rol asignado incluye `TenantAdmin`, la sección "Alcance por almacén" se deshabilita automáticamente con la leyenda: *"TenantAdmin tiene acceso a todos los almacenes (no se puede limitar)"*.

**Acciones (TenantAdmin):**
- Crear usuario (envía email)
- Editar (cambiar nombre, roles, número de empleado, **alcance de almacenes**)
- Reenviar invitación
- Suspender / reactivar (toggle)
- Reset de password (envía link)

**Vista de detalle / edición** — incluye un tab adicional **"Alcance"** para gestionar la asignación de almacenes sin tocar el resto del perfil:

```
┌────────────────────────────────────────────────────────────────┐
│  Sistema > Usuarios > María López                              │
├────────────────────────────────────────────────────────────────┤
│   [Datos]  [Roles]  [Alcance ●]  [Sesiones]                   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Alcance por almacén                                          │
│   ───────────────────                                          │
│                                                                │
│   María López puede operar en los siguientes almacenes:        │
│                                                                │
│   ☑ Sucursal Centro      (3,420 productos · 1 POS activo)     │
│   ☐ Sucursal Norte       (2,180 productos)                    │
│   ☑ Sucursal Sur         (4,100 productos · 1 POS activo)     │
│   ☐ Bodega Central       (12,500 productos)                   │
│                                                                │
│   [Seleccionar todos]  [Limpiar]                              │
│                                                                │
│   ⚠️ Si María tiene una sesión POS abierta en un almacén que   │
│      acabas de desmarcar, perderá acceso en su próxima         │
│      acción.                                                   │
│                                                                │
│                                          [Guardar alcance]     │
└────────────────────────────────────────────────────────────────┘
```

---

### 11.2 Roles y Permisos

**Ruta:** `/system/roles` · **Permiso:** `roles:manage` (solo TenantAdmin)

```
┌────────────────────────────────────────────────────────────────┐
│  Sistema > Roles y Permisos                                    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┬───────────────────────────────────────────┐ │
│  │ ROLES        │  Permisos del rol seleccionado            │ │
│  ├──────────────┼───────────────────────────────────────────┤ │
│  │ • TenantAdmin│  ─── Catálogo ───                         │ │
│  │ • Manager  ✓ │   ☑ products:read                          │ │
│  │ • POS_Seller │   ☑ products:manage                         │ │
│  │ • Viewer     │   ☐ catalogs:manage                  │ │
│  │              │                                           │ │
│  │ [+ Nuevo rol]│  ─── Almacenes ───                        │ │
│  │              │   ☑ warehouses:read                       │ │
│  │              │   ☑ warehouses:write                      │ │
│  │              │                                           │ │
│  │              │  ─── Inventario ───                       │ │
│  │              │   ☑ inventory:read                        │ │
│  │              │   ☑ inventory:movement                    │ │
│  │              │   ☑ inventory:manage                      │ │
│  │              │                                           │ │
│  │              │  ─── POS ───                              │ │
│  │              │   ☑ pos:sell                              │ │
│  │              │   ☑ pos:close_cashbox                     │ │
│  │              │   ☐ pos:annul                             │ │
│  │              │                                           │ │
│  │              │  ─── Reportes ───                         │ │
│  │              │   ☑ reports:view                          │ │
│  │              │   ☑ reports:export                        │ │
│  │              │                                           │ │
│  │              │  ─── Sistema ───                          │ │
│  │              │   ☐ users:manage                          │ │
│  │              │   ☐ roles:manage                          │ │
│  │              │                                           │ │
│  │              │              [Guardar cambios]            │ │
│  └──────────────┴───────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

**Acciones:**
- Crear rol custom
- Editar permisos de cualquier rol (cambios aplican en la siguiente request de cada usuario)
- Eliminar rol (solo si no tiene usuarios asignados)

---

### 11.3 Mi perfil

**Ruta:** `/profile` · **Permiso:** todos los autenticados

```
┌────────────────────────────────────────────────────────────────┐
│  Mi perfil                                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Datos personales                                             │
│   ─────────────                                                │
│   Nombre:        Juan Pérez                                    │
│   Empleado:      #001                                          │
│   Email:         juan@farmaciasanjuan.com                      │
│   Roles:         TenantAdmin                                   │
│   Último login:  17/05/2026 09:15                              │
│                                                                │
│                            [✏️ Editar datos]                  │
│                                                                │
│  ─── Cambiar password ──                                       │
│                                                                │
│   Password actual                                              │
│   (___________________)                                       │
│                                                                │
│   Nuevo password                                               │
│   (___________________)                                       │
│                                                                │
│   Confirmar nuevo password                                     │
│   (___________________)                                       │
│                                                                │
│   ℹ️ Cambiar el password cerrará todas tus otras sesiones     │
│                                                                │
│                              [Cambiar password]                │
│                                                                │
│  ─── Sesiones activas ────                                     │
│                                                                │
│   • Chrome — macOS · CDMX · ahora (sesión actual)              │
│   • Safari — iPhone · CDMX · hace 2h    [Cerrar]              │
│                                                                │
│  ─── Preferencias ────────                                     │
│                                                                │
│   Idioma de la interfaz                                        │
│   ┌────────────────────────────┐                              │
│   │  Español ▾                 │                              │
│   │  ─────────                 │                              │
│   │  Español                   │                              │
│   │  English                   │                              │
│   └────────────────────────────┘                              │
│                                                                │
│   ℹ️ El cambio se aplica de inmediato. Los emails y recibos   │
│      futuros llegan en este idioma.                            │
│                                                                │
│                              [Guardar preferencias]            │
└────────────────────────────────────────────────────────────────┘
```

**Acciones del usuario:**
- Cambiar idioma → `PATCH /me { locale: 'en' }` → refresca traducciones del frontend sin recargar la página.
- Detección inicial: al hacer signup, el sistema toma `Accept-Language` del browser y pre-selecciona el locale soportado más cercano.

**Casos de uso relacionados:** [CU-SYS-05](CASOS_DE_USO.md#cu-sys-05--cambiar-idioma-de-mi-perfil).

---

## Apéndice — Documentos Relacionados

- [ARQUITECTURA.md](ARQUITECTURA.md) — Stack, multi-tenancy, seguridad, roadmap
- [CASOS_DE_USO.md](CASOS_DE_USO.md) — Casos de uso detallados con flujos alternativos
- [FLUJOS.md](FLUJOS.md) — Diagramas Mermaid de los flujos críticos
- [ControlDeInventario.md](ControlDeInventario.md) — Requerimientos originales del cliente
- [PuntoDeVenta.md](PuntoDeVenta.md) — Requerimientos originales del POS

---

*Documento de vistas y acciones de SellPoint. Los wireframes son ilustrativos; el diseño final será definido durante la Fase 0 con un sistema de diseño basado en shadcn/ui + Tailwind.*
