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
   - 6.5 Servicios — Lista y alta
7. [Almacenes](#7-almacenes)
8. [Movimientos](#8-movimientos)
   - 8.1 Entrada
   - 8.2 Salida
   - 8.3 Traspasos en Tránsito
   - 8.4 Inventario Físico
   - 8.5 Histórico de Movimientos / Kardex
   - 8.6 Listados por serie
   - 8.7 Documento
9. [Punto de Venta (POS)](#9-punto-de-venta-pos)
   - 9.1 Pantalla principal de venta
   - 9.2 Modal de cobro
   - 9.3 Historial de ventas
   - 9.4 Cierre de caja
   - 9.5 Cotización
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
│   └ Servicios│                                                         │
│   └ Schema   │                                                         │
│              │                                                         │
│  🏬 Almacenes│                                                         │
│              │                                                         │
│  🔄 Movimientos                                                        │
│   └ Entradas │                                                         │
│   └ Salidas  │                                                         │
│   └ Traspasos│                                                         │
│   └ Inv.Físico                                                         │
│   └ Próx. a vencer                                                     │
│              │                                                         │
│  🛒 Punto de venta                                                     │
│   └ Venta    │  ← pos:sell                                             │
│   └ Cotización  ← pos:quote (F4)                                       │
│   └ Historial│  ← pos:view (F4)                                        │
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

> **Provincia o estado (F4-TAX-18, 2026-09-06):** al elegir Canadá o Estados Unidos el
> paso 1 muestra un select «Provincia o territorio» / «Estado» con el nombre oficial,
> obligatorio ahí y ausente para el resto del mundo; cambiar de país lo vacía. Con él, al
> Terminar se siembra el catálogo fiscal del negocio (F4-TAX-19).
>
> **Registro fiscal por país (F1-TAXID, 2026-09-10):** el campo «Identificación fiscal
> (RFC)» / «(GST/HST No.)» trae el hint «Por ejemplo ABC010101AB1» del país elegido, al
> salir del campo el valor se normaliza (mayúsculas, separadores en su lugar) y un valor
> que no cumple la regla del país detiene «Continuar» con «Escribe una identificación
> fiscal válida para tu país, como …». Sin hint ni regla donde no hay fuente oficial (NI,
> PA, BZ). CUIT, RUT y CNPJ también verifican su dígito.

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

> **Impuesto (F4-TAX-15, 2026-09-06):** el alta y la edición de producto, servicio y
> estudio llevan un select «Impuesto» con la opción «Predeterminado del negocio (IVA 16%)»
> (= NULL) y los grupos activos del negocio; guardar sin tocarlo manda `null`. La misma
> columna `impuesto` (EN `tax`) viaja en las plantillas de Excel: vacío hereda el default,
> un código lo fija, uno desconocido es error de fila.
>
> **La base del costo (F9-COSTMODE-10, 2026-09-11):** la etiqueta del costo en producto,
> servicio y estudio dice en qué base captura el negocio — «Costo (sin impuesto)» o
> «Costo (con impuesto incluido)», según el ajuste de Mi perfil › Impuestos— con una ayuda
> que lo explica; el número viaja tal cual (el web no convierte). Los diálogos de
> importación aclaran bajo el paso 1 en qué base va la columna «costo». La entrada manual
> lo dice en el encabezado de «Costo unitario» y, confirmada, muestra «Costo sin impuesto»
> cuando difiere. El estimado del compuesto y el valor del reporte de existencias llevan
> la nota «sin impuesto».

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

> **Actualizado en F1-ADDR (2026-09-08):** la dirección dejó de ser texto libre. Es
> **estructurada y universal** (calle y número, línea 2, ciudad, región, código
> postal) y el formulario pinta los campos que el PAÍS del negocio usa, en su orden
> y con su vocabulario —«Colonia» y «Estado» en México, «Apt, suite or unit» y
> «Province or territory» en Canadá— desde `packages/shared/src/address.ts`
> (MERCADOS.md §4). Sigue siendo opcional en el almacén; el código postal, si viene,
> se valida contra la regla del país. La versión de 2026-08-16 la había dejado en
> texto libre porque el desglose colonia/alcaldía/estado del mockup original era
> México-céntrico: la respuesta correcta no era quitar el desglose, era hacerlo por
> país. Los **racks quedaron FUERA de F2**: no existen en ningún modelo de datos y
> se decidirán cuando llegue el stock por ubicación.

```
┌────────────────────────────────────────────────────────────────┐
│  Nuevo almacén                                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Nombre del almacén *                                         │
│   (_________________________________________________)          │
│                                                                │
│   Calle y número                                               │
│   (_________________________________________________)          │
│   Colonia                          (según el país)             │
│   (_________________________________________________)          │
│   Código postal          Ciudad o municipio                    │
│   (______________)       (___________________________)         │
│   Estado                                                       │
│   [ Elige uno                                          ▾ ]     │
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
│  🛒 POS — {Almacén Centro} · Turno abierto desde 09:00  {María L. ▼} │
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

> **Actualizado pre-F4 (2026-08-21):** la barra muestra el **almacén del turno** (deuda
> de F3-HOME-05: el vendedor tiene que saber desde dónde está descontando), y el input
> principal es **extensible** (strategy de lookups, ARQUITECTURA § 9.4): acepta SKU,
> código de barras, texto, **servicios** ofrecidos en ese almacén y **folio `COT-…`**
> (carga una cotización — ver § 9.5 y CU-POS-05).

**Acciones:**
- Escanear código de barras con cámara (`@zxing/browser`)
- Búsqueda predictiva por SKU/nombre/servicio, o folio `COT-…` para cargar una cotización
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

> **Impuestos en el carrito (F4-TAX-17, 2026-09-06), dos disposiciones:** con precio final
> (`included`, México y la UE) el carrito muestra el **TOTAL** grande y debajo «IVA 16%
> incluido $6.21»; con impuesto agregado (`excluded`, Canadá y EE. UU.) muestra Subtotal,
> una fila por componente («GST 5%», «PST 7%») y el TOTAL con el impuesto sumado. El
> desglose sale de `splitLineTax` de shared, la misma aritmética que el servidor.

**Casos de uso relacionados:** [CU-POS-01](CASOS_DE_USO.md#cu-pos-01--realizar-una-venta) · [CU-POS-05](CASOS_DE_USO.md#cu-pos-05--cargar-una-cotización-en-la-venta)

---

### 9.2 Modal de cobro

> **F4-TAX-17 (2026-09-06):** el modal repite el desglose del carrito (Subtotal +
> componentes + Total en `excluded`; Total + «IVA 16% incluido» en `included`) y cobra el
> TOTAL con impuesto: el vuelto y el faltante salen de ahí. El ticket (F4-TAX-12/13) imprime
> Descuento / Subtotal (base) / una fila por componente / Total; en `excluded` las líneas
> van a precio neto (CRA) y en `included` a precio final (LFPC).
>
> **F4-DISC (2026-09-09):** botón «Aplicar descuento» —solo si el Admin definió el código en
> Mi perfil— que abre «Descuento» (importe con moneda y dos decimales, hint «Tope del
> negocio: N % del subtotal»), «Código de autorización» (oculto, numérico, 4 a 8 dígitos),
> «Motivo (opcional)» y «Quitar descuento». Con un importe válido aparecen «Subtotal» y
> «Descuento −$x» sobre el Total, el impuesto incluido se recalcula y el vuelto sale del total
> descontado. Un importe con coma, mayor que el subtotal o que el tope, o sin código, se marca
> y BLOQUEA Cobrar: nunca se descarta en silencio. El servidor verifica el código (403 si
> falla; cinco fallos → 429 por 15 minutos) y prorratea el importe entre las líneas.
>
> **F4-TAXMARK (2026-09-10):** cuando el ticket mezcla dos o más grupos de impuesto (GST 5% y
> HST 13% en Canadá; IVA 16% y exento en una farmacia), cada línea lleva una letra tras el
> importe («CA$6.00  A») y bajo el Total va la leyenda en gris chico («A = GST 5%», «B = HST
> 13%»); con un solo grupo el papel no cambia. El registro fiscal sale con su nombre según el
> país del negocio («RFC: DNO010203AB4», «GST/HST No.: 123456789 RT0001»), y la casilla de
> Configuración del ticket y el campo de Datos del negocio se llaman igual.
>
> **El papel con descuento (Carlos, 2026-09-09):** cada línea se imprime a PRECIO DE LISTA
> (precio × cantidad), nunca ya descontada —si no, las líneas sumaban el total final y abajo
> volvía a aparecer «Descuento»—. El pie dice Subtotal (Σ líneas) → Descuento → Base
> gravable → una fila por impuesto → Total, y las dos restas cierran a la vista; sin
> descuento, el pie sigue siendo el de F4-TAX-12 (la base como «Subtotal»). El prorrateo por
> línea vive en `sale_items.discount` para rentabilidad y devoluciones, no en el papel.

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
- Toast "Venta VTA-004523 registrada" — el folio sale de la serie `VTA` del tenant
  (`tenant_sequences`, el mismo mecanismo que `ENT`/`SAL`/`INV`), nunca un contador suelto
- Auto-imprime ticket
- Limpia carrito y vuelve a la pantalla principal lista para la siguiente venta

> **Idempotencia (F4-SALE-02):** al abrirse el modal se genera una `Idempotency-Key`;
> un doble tap en «Confirmar venta» devuelve **la misma venta** (200), no una duplicada.
> Un 409 de stock concurrente cae SOBRE el modal, nunca se traga (lección del confirm
> mudo de F3).

---

### 9.3 Historial de ventas

**Ruta:** `/pos/sales` · **Permiso:** `pos:view`

> **`pos:view` nace en F4-DB-03.** Esta vista lo exigía desde el diseño original y el
> permiso **no existía** en el catálogo (fantasma detectado en la atomización de F4,
> 2026-08-20): se crea ahí, no se hereda el hueco. La columna es el **folio `VTA-…`**,
> no un número suelto.
>
> **Construido (2026-08-21):** el filtro es por **estado** y va contra el servidor —
> el historial son miles de filas y filtrar en el cliente solo acotaría la página que
> ya llegó. Los filtros por fecha, vendedor y turno **existen en el API**
> (`listSalesQuerySchema`) y no en la pantalla: se agregan cuando alguien los pida,
> no por simetría con un wireframe.

```
┌────────────────────────────────────────────────────────────────┐
│  POS > Historial de ventas                                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   Estado: ▼ Todas                                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Folio      │ Fecha       │ Vendió │ Pago     │ Descuento│ Total  │…│ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ VTA-000003 │ 21/8, 14:30 │ María  │ Efectivo │   −$5.00 │ $60.00 │…│ │
│  │ VTA-000002 │ 21/8, 14:15 │ María  │ Tarjeta  │     —    │$145.00 │…│ │
│  │ VTA-000001 │ 21/8, 13:50 │ Pedro  │ Efectivo │     —    │ $80.00 │…│ │
│  │            │             │        │ ANULADA  │          │        │…│ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│   ← Anterior   Página 1 de 3   Siguiente →                     │
└────────────────────────────────────────────────────────────────┘
```

> **F4-DISC (2026-09-09):** la columna «Descuento» va pegada al Total, con signo; sin
> descuento, el guion (como el código de barras).

**Las anuladas se VEN, marcadas.** Esconderlas por defecto sería tentador —«ruido»— y
es lo contrario de lo que necesita quien busca una venta que no cuadra: encontrarla
justo cuando está anulada. El filtro existe para acotar, no para tapar.

**Acciones por fila:**
- **Reimprimir** — se ofrece SIEMPRE, incluso sobre una venta anulada: reimprimir es
  LEER, y quien reclama trae en la mano el ticket de la que se anuló
- **Anular** — gateado por `pos:cancel`, que NO está en el rol de mostrador. Pide un
  motivo ANTES del clic (mínimo 3 caracteres) en vez de dejar chocar con el 422, y no
  se ofrece sobre una venta ya anulada: el API contesta 409 y el botón mentiría

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

> El cierre guarda **declarado, calculado y diferencia** — la diferencia se registra,
> no se bloquea (F4-CASHBOX-02). Un turno cerrado no vende.

**Casos de uso relacionados:** [CU-POS-01](CASOS_DE_USO.md#cu-pos-01--realizar-una-venta) · [CU-POS-02](CASOS_DE_USO.md#cu-pos-02--anular-venta) · [CU-POS-03](CASOS_DE_USO.md#cu-pos-03--cierre-de-caja)

---

### 9.5 Cotización

**Ruta:** `/pos/quotes` (listado) · `/pos/quotes/new` (nueva) · **Permiso:** `pos:quote`

> **Adelantada de F9 a F4 (decisión de Carlos, 2026-08-20):** el caso que la trae es un
> **mostrador de recepción antes de la caja** — alguien arma la lista, imprime un ticket
> con folio `COT-…`, y el cliente pasa a caja donde el folio carga todo sin recapturar.
> En el futuro, el módulo de médicos de F9 genera el mismo folio desde una receta.
> Tres decisiones la definen: **(1)** permiso propio `pos:quote`, distinto de `pos:sell`
> — la recepción cotiza sin poder cobrar; **(2)** **no exige turno de caja** — no toca
> dinero ni stock, opera contra el almacén asignado del cotizador; **(3)** **no congela
> precios ni maneja vigencia** — los precios impresos son de referencia y al cargarla en
> el POS se **recalculan con el catálogo vigente**. — `topic_key: sellpoint/f4-atomizacion`

```
┌─────────────────────────────────────────────────────────────────┐
│  📋 Cotización — {Almacén Centro}              {Recepción R. ▼} │
├──────────────────────────────────────────┬──────────────────────┤
│                                          │                      │
│  📷 [   Escanear con cámara    ]         │      COTIZACIÓN      │
│                                          │                      │
│  🔍 (Buscar producto o servicio...)      │  ┌────────────────┐  │
│                                          │  │ Paracetamol    │  │
│  ─── Acceso rápido ───                   │  │ 1 × $15.00     │  │
│  (la misma maquinaria del carrito        │  │ [- 1 +]    🗑  │  │
│   de venta: presentaciones, numpad,      │  ├────────────────┤  │
│   compuestos — sin cobro)                │  │ Consulta gral. │  │
│                                          │  │ 1 × $250.00    │  │
│                                          │  └────────────────┘  │
│                                          │                      │
│                                          │  Total ref.: $265.00 │
│                                          │                      │
│                                          │  [🗑 Vaciar]         │
│                                          │  [📋 GENERAR COTIZACIÓN] │
└──────────────────────────────────────────┴──────────────────────┘
```

**Acciones:**
- «Generar cotización» → folio `COT-000001` (serie propia por tenant) + ticket 58/80 mm
  con la marca **COTIZACIÓN**, precios de referencia y la leyenda *«el precio final se
  calcula en caja»* — nunca parece un comprobante de venta
- Listado en `/pos/quotes` con búsqueda por folio y estado (`open` / `loaded` / `canceled`)
- Cancelar una cotización abierta
- **No hay botón de cobro**: cobrar es del POS. La cotización se carga allá tecleando su
  folio (§ 9.1); al cobrarse queda `loaded`, vinculada a la venta por `Sale.quote_id`, y
  no puede volver a cargarse (409)
- Una cotización **no escribe un solo `stock_movement`**: es una lista con folio, no una
  operación. Un producto cuyo único stock está **vencido** no se puede cotizar (la misma
  regla que la venta, aplicada en su consulta de disponibilidad — F4-QUOTE-01)

**Casos de uso relacionados:** [CU-POS-04](CASOS_DE_USO.md#cu-pos-04--generar-una-cotización) · [CU-POS-05](CASOS_DE_USO.md#cu-pos-05--cargar-una-cotización-en-la-venta)

---

## 10. Reportes

**Ruta:** `/reports` · **Permiso:** `reports:read`

> **Sincronía pre-F5 (2026-08-21):** el permiso decía `reports:view`, que **nunca
> existió** — el catálogo real tiene `reports:read` (en producción desde la migración
> `20260821180000`, asignado a TenantAdmin/Manager/Viewer; POS_Seller no). Manda el
> código. Y **no hay `reports:export`**: exportar es leer, el mismo criterio que
> «reimprimir es leer» del historial de F4.
>
> El hub pasa de 6 a **8 tarjetas** (entran Vencimientos y En tránsito, herencias de
> F3), con **tres comportamientos** distintos (verificado contra el código al cerrar F5,
> F5-DOCS-01):
>
> · **Pantalla propia** — Stock y Ventas: consultas con filtros que no existen en ningún
>   otro lado.
> · **Descarga directa** — Catálogo, Almacenes y Usuarios: una tabla acá duplicaría los
>   listados que ya existen en Catálogo y Sistema.
> · **Enlace a una pantalla que ya existe** — Kardex (`/catalog/products`), Vencimientos
>   (`/movements/expiring`) y En tránsito (`/movements/transfers`), donde vive el botón de
>   exportar.
>
> **Kardex enlaza y Catálogo descarga**, y no al revés como decía este documento antes de
> construirlo: el kardex necesita un producto ELEGIDO —una pantalla nueva pediría el mismo
> buscador que el catálogo ya tiene—, mientras que el catálogo completo se baja de un
> golpe y no hay nada que elegir.

```
┌────────────────────────────────────────────────────────────────┐
│  Reportes                                                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 📦 Stock por almacén│  │ 💰 Ventas           │             │
│  │ Valorizado (costo   │  │ Por período /       │             │
│  │ promedio) + alertas │  │ vendedor / método   │             │
│  └─────────────────────┘  └─────────────────────┘             │
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 📜 Kardex           │  │ ⏰ Vencimientos     │             │
│  │ → abre el catálogo  │  │ → abre la pantalla, │             │
│  │   (elige producto)  │  │   con su exportar   │             │
│  └─────────────────────┘  └─────────────────────┘             │
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 🚚 En tránsito      │  │ 📋 Catálogo         │             │
│  │ → abre traspasos,   │  │ 📤 descarga directa │             │
│  │   con su exportar   │  │   (campos dinámicos)│             │
│  └─────────────────────┘  └─────────────────────┘             │
│                                                                │
│  ┌─────────────────────┐  ┌─────────────────────┐             │
│  │ 🏬 Almacenes        │  │ 👥 Usuarios         │             │
│  │ 📤 descarga directa │  │ 📤 descarga directa │             │
│  └─────────────────────┘  └─────────────────────┘             │
└────────────────────────────────────────────────────────────────┘
```

**Patrón común de cada reporte con pantalla (stock, ventas):**

```
┌────────────────────────────────────────────────────────────────┐
│  Reportes > Stock por almacén                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ─── Filtros ───                                               │
│   Almacén: ▼ Todos          Categoría: ▼ Todas                │
│   ☑ Solo productos bajo stock mínimo                          │
│   ☐ Detalle por lote y ubicación (con caducidad)              │
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

> **Exportar Excel es SÍNCRONO con tope de filas** (~10.000): superarlo devuelve un
> mensaje que pide acotar filtros — nunca un truncado silencioso, porque un Excel
> cortado se lee como completo. El export baja con los MISMOS filtros que la tabla
> muestra. El asíncrono con cola quedó diferido (FLUJOS §8).
>
> **El detalle por lote (2026-08-24)** baja producto × almacén × lote × ubicación con
> caducidad, solo productos que controlan lotes: el almacenaje contempla la ubicación
> además del lote y la caducidad (directiva de Carlos). Misma consulta que la tab
> «Stock por almacén» del producto — no una segunda implementación.

**Casos de uso relacionados:** [CU-REP-01](CASOS_DE_USO.md) (stock valorizado),
CU-REP-02 (catálogo), CU-REP-03 (ventas), CU-REP-04 (kardex), CU-REP-05 (exports
directos: usuarios, almacenes, vencimientos, tránsito).

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
│   (las etiquetas y cuántas casillas de apellido salen del PAÍS  │
│    del negocio — F1-NAME; en EE. UU. es una sola: «Apellido»)   │
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
│  │              │   ☑ pos:quote                             │ │
│  │              │   ☑ pos:view                              │ │
│  │              │                                           │ │
│  │              │  ─── Reportes ───                         │ │
│  │              │   ☑ reports:read                          │ │
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

> **Tarjeta «Impuestos» (F4-TAX-14, 2026-09-06; solo `tenants:manage`, entre «Datos del
> negocio» y «Ticket»):** el modo («¿El precio de tus artículos ya incluye el impuesto?»,
> con advertencia si el negocio ya tiene ventas), el modo del COSTO («¿El costo de tus
> artículos lo capturas con el impuesto incluido?», F9-COSTMODE-03, 2026-09-11: su propio
> grupo de radios, con advertencia si ya hay costos capturados porque cambiarlo no
> convierte nada), la provincia o el estado si el país los
> usa, y la lista de grupos con sus componentes (código, nombre en el ticket, tasa con
> hasta 4 decimales), marcar el predeterminado, activar/desactivar, agregar y borrar (un
> grupo con artículos responde 409 «lo usan N artículos»). Modo y región se guardan al
> elegir; los grupos con «Guardar impuestos».
>
> **Tarjeta «Descuentos en caja» (F4-DISC, 2026-09-09; solo `tenants:manage`, después de
> «Impuestos»):** el estado («Sin código: los descuentos están apagados.» o «Código
> configurado el {fecha}. No se muestra: si se olvidó, define uno nuevo.»), «Código de
> autorización (4 a 8 dígitos)» —o «Nuevo código…»— y «Repite el código» (ocultos, solo
> dígitos), «Tope por ticket (opcional)» en % del subtotal (vacío = sin tope), Guardar y
> «Quitar código». El código viaja una vez, se guarda hasheado y nunca se vuelve a mostrar.
>
> **Registro fiscal por país (F1-TAXID, 2026-09-10; en «Datos del negocio»):** el campo
> «RFC» / «GST/HST No.» es **opcional** —vaciarlo lo BORRA, como el teléfono y la meta— y
> lleva el hint con el ejemplo del país. Se normaliza al salir del campo y se valida solo
> cuando CAMBIÓ: un registro viejo mal guardado no impide cambiar el teléfono. Si no cumple
> la regla, el aviso rojo sale ARRIBA con el ejemplo y **se lleva el foco**, así el navegador
> desplaza hasta él (el formulario es largo y el mensaje quedaba fuera de la pantalla —
> Carlos, 2026-09-10); lo mismo hace el 422 del servidor.

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

## 12. Consultorio Médico — Historia clínica

> F9-CLINIC-WEB (2026-09-03) y F9-CLINIC-HC (2026-09-09). Un expediente por VISITA (folio `HCL-`), un tablero de tarjetas y un formulario por tarjeta: nunca un formulario gigante. **22 tarjetas** funcionales: 19 en tres bloques clínicos (Carlos, 2026-09-08: fusionadas desde 25 para que el médico haga menos viajes), cuatro de Órdenes médicas (documentos con folio propio) y **tres de Documentos y seguimiento** (F9-CLINIC-DOC, 2026-09-09: Notas Médicas, Referencias e Interconsultas; Recetas, Estudios y Citas de Seguimiento se retiraron por duplicar Órdenes y Seguimiento, y Archivos Adjuntos se pospuso por almacenamiento). Ya no queda ninguna «Próximamente».

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Resumen del paciente                                              │
│ Historia clínica                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Paciente Prueba   HCL-000004   [Abierta]                        │ │
│ │ [Alergias: Penicilina (Grave)]           ← rojo; gris si negadas│ │
│ │ Edad 36 años · Sexo — · Nacimiento 10/05/1990 · Consulta …      │ │
│ │ ▓▓▓▓░░░░░░░░░░░░  4 de 19 secciones capturadas                  │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ Interrogatorio  (En progreso · 2 de 10)                             │
│ ┌ Datos Generales ┐ ┌ Motivo de Consulta ┐ ┌ Padecimiento Actual ┐  │
│ │ ○ Pendiente     │ │ ○ Pendiente        │ │ ○ Pendiente         │  │
│ ┌ A. Heredofamiliares ─────┐ ┌ A. Personales Patológicos ┐ …       │
│ │ ✓ Completado             │ │ ○ Pendiente               │          │
│ │ Diabetes: Madre          │ └───────────────────────────┘          │
│ │ De la consulta del 08/09/2026 · confirma o actualiza  │ ← heredada│
│ └──────────────────────────┘                                        │
│ Exploración  (0 de 4)     Somatometría · Signos Vitales ·           │
│                           Exploración Física · Resultados de Estudios│
│ Evaluación y plan (0 de 5) Impresión Diagnóstica · Diagnósticos ·   │
│                           Tratamiento · Plan de Manejo y Pronóstico ·│
│                           Seguimiento y Recomendaciones              │
│ Órdenes médicas           Receta · Orden de Laboratorio ·           │
│                           Estudios Diagnósticos · Órdenes Emitidas   │
│ Documentos y seguimiento · 4 documentos    Notas Médicas ·           │
│                            Referencias · Interconsultas              │
│                                                  [Cerrar consulta]   │
└─────────────────────────────────────────────────────────────────────┘
```

**Las leyes del tablero.** Guardar una tarjeta es Completado aunque falten campos; guardar sin nada es Pendiente (borra la fila). El estado de cada tarjeta se deriva de que exista su fila; «En progreso» vive en el grupo. Los **antecedentes son del paciente**: al abrir una consulta nueva, Datos Generales, AHF, APP, APNP, AGO, Alergias y Medicamentos Actuales llegan copiados de la anterior con la leyenda «De la consulta del {fecha} · confirma o actualiza», y el primer Guardar la quita; signos, exploración y diagnósticos NO se heredan (son del día). **El sexo decide qué se PIDE y el dato qué se MUESTRA**: la tarjeta de Antecedentes Gineco-Obstétricos no se dibuja para un paciente `M`, salvo que ya tenga datos, y el progreso cuenta solo lo visible. Las alergias capturadas suben al encabezado en rojo. **La barra del encabezado mide la historia clínica** (los tres bloques clínicos: «N de 19»); Documentos cuenta lo que hay («Sin documentos», «4 documentos») y nunca dice «Pendiente»: una consulta sin referencias está completa. La próxima cita de Seguimiento sube al **resumen del paciente**, con «No vino a la cita del …» derivado cuando la fecha pasó sin consulta posterior.

**Los formularios, y cómo van rápido.** Cada tarjeta abre una ruta propia (Atrás es Cancelar) con el título, «Paciente · folio», la leyenda de heredada si aplica, el aviso de solo lectura si la consulta está cerrada o es de otro día, y Guardar/Cancelar al pie. Patrones que se repiten:

| Patrón | Dónde | Qué hace |
|---|---|---|
| **«Negados» en un clic** (`NegatedToggle`) | AHF, APP, Alergias («Negadas»), Medicamentos («No toma medicamentos») | Marca una casilla, deshabilita el resto y guarda explícito (`{negated: true}`): «AHF negados» no es «sin AHF». |
| **Checklist de hallazgos** (`FindingsChecklist`) | Aparatos y Sistemas (11 sistemas con sus síntomas cardinales), Exploración Física (12 regiones + habitus) | Botón «Todos negados» / «Todo sin alteraciones» pone cada ítem en normal POR ÍTEM; solo se escribe el hallazgo. |
| **Lista de filas** (`RowList`) | Alergias, Medicamentos, Cirugías/Traumatismos/Hospitalizaciones, Resultados de estudios, Diagnósticos | «+ Agregar …» con el foco en la fila nueva, «Quitar» por fila; la fila sin su dato principal no viaja. |
| **Número con unidad** (`NumberField`) | Somatometría (kg, cm), Signos Vitales (mmHg, lpm, rpm, °C, %, mg/dL), años, G/P/A/C | Letras fuera; coma y punto de más entran y el error lo explica; rango mínimo/máximo con su mensaje. |
| **Lo derivado se pinta, no se guarda** | IMC + categoría OMS (Somatometría), índice tabáquico (APNP), FPP desde la FUM (AGO), semáforo Alto/Bajo/alarma (Signos Vitales) | La aritmética vive en `packages/shared/src/medical-measures.ts`; en el JSON viajan solo los datos medidos. |
| **Catálogo CIE-10** (`Icd10Picker`) | Diagnósticos (una lista: principal, secundarios, diferencial; a lo más un principal) | Se teclea código («j06») o texto sin acentos («faringitis»); elegir llena código y descripción vacía; la captura a mano sigue permitida. El principal precarga «Diagnóstico relacionado» en las órdenes. |
| **Fecha contra la consulta** | Seguimiento y Recomendaciones | La próxima cita no es anterior a la fecha de consulta (no a «hoy»: una consulta vencida se lee, no se captura). |
| **Línea de tiempo** (`RowList` con hora) | Notas Médicas | Hora, tipo (evolución con guía SOAP, procedimiento, observación, contacto telefónico, respuesta de especialista) y texto; sin fecha ni autor por nota: el expediente es de un día y firma el médico. La respuesta del especialista se registra aquí el día que llega. |
| **Carta imprimible** (`LetterSectionForm`) | Referencias, Interconsultas | Misma forma (NOM-004 6.4 y 6.3: prioridad, unidad receptora —obligatoria en la referencia—, servicio, médico, motivo, resumen clínico, impresión diagnóstica con CIE-10, terapéutica); «Traer del expediente» llena solo lo vacío; al guardar la ruta se QUEDA y aparece «Imprimir referencia N» por carta persistida; el PDF (por índice, folio del expediente + número, sin serie propia) se lee e imprime aunque la consulta esté vencida. |

**Lo que la NOM-004-SSA3-2012 pide y dónde vive.** 6.1.1 interrogatorio (ficha de identificación con grupo étnico y religión en Datos Generales; AHF; APP; APNP con tabaquismo, alcoholismo y toxicomanías; padecimiento actual; aparatos y sistemas); 6.1.2 exploración (habitus exterior, signos vitales, peso y talla, regiones); 6.1.3 resultados de estudios; 6.1.4 diagnósticos; 6.1.5 pronóstico (dentro de Plan de Manejo); 6.1.6 indicación terapéutica (Tratamiento; la receta con folio y cobro es una Orden médica).

## 13. Proveedores

> **F9-SUPPCAT (2026-09-12):** Proveedores es un catálogo de primera clase. Vive en el grupo **Catálogos** del menú (Almacenes, Productos, Servicios, Proveedores; Campos y Subcatálogos van aparte en «Catálogos personalizados»), tiene **código** (`PROV-NNN` si el alta no lo trae; único, en MAYÚSCULAS, primero en la ficha y en la tabla, buscable, visible en el selector de compras/órdenes/gastos) y **campos propios** como Almacenes: el catálogo de sistema `suppliers` aparece en «Campos del catálogo» con sus siete estándar (código, nombre, registro fiscal, persona de contacto, teléfono, email, dirección) y lo que se defina ahí se pinta en la ficha con `DynamicForm` y viaja en `attributes`.
>
> F9-SUPPL (2026-09-10). El catálogo de proveedores es **core**: lo comparten Compras y Gastos. *(Hasta el 2026-09-12 el enlace del menú aparecía bajo el primero de los dos grupos que el negocio tuviera (`useModuleNav` deduplica por ruta). Se lee con `suppliers:read`; alta, edición y baja con `suppliers:manage`. No hay candado de módulo: sin Compras ni Gastos no hay enlace, pero la ruta `/suppliers` responde.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Proveedores                                              [ Nuevo ]  │
│ Buscar proveedor [ Código, nombre, registro fiscal, contacto… ]     │
│ ┌──────────┬──────────────────┬──────────────┬────────────┬───────┐ │
│ │ Código   │ Proveedor        │ Registro f.  │ Contacto   │ Estado│ │
│ ├──────────┼──────────────────┼──────────────┼────────────┼───────┤ │
│ │ PROV-002 │ Abarrotes Centro │ —            │ Luis Gómez │Inactivo│ Editar · Eliminar
│ │ PROV-001 │ Distribuidora N. │ DNO900101AB1 │ Rosa Luna  │ Activo│ Editar · Eliminar
│ └──────────┴──────────────────┴──────────────┴────────────┴───────┘ │
│ ⚠ Este proveedor tiene compras o gastos registrados… [Desactivar]   │  ← el 409 al borrar
└─────────────────────────────────────────────────────────────────────┘
```

| Pieza | Qué hace | Regla |
|---|---|---|
| **Listado** (`suppliers-list.tsx`, componente `Table`) | Alfabético, buscador por nombre / registro fiscal / contacto / teléfono / correo, paginado del API, `Badge` Activo/Inactivo. | «Eliminar» pide confirmación; un 409 (tiene compras o gastos) se pinta con el mensaje del API y ofrece **Desactivar** ahí mismo. |
| **Formulario** (`supplier-form.tsx`, skill `sellpoint-forms`) | Tarjeta con rejilla de dos columnas: Nombre o razón social, Registro fiscal, Persona de contacto, Teléfono (`PhonePartsField`), Correo, Dirección, Notas; «Proveedor activo» solo al editar. | La etiqueta y el ejemplo del registro fiscal los decide el país del negocio (`taxIdLabel`/`taxIdExample`); al salir del campo se normaliza y, si ya existe otro con ese registro, **avisa sin bloquear** (`DuplicateSupplierCard`). La edición manda al PATCH solo lo que cambió. |
| **`SupplierPicker`** | UN buscador para Compras y Gastos: busca solo activos con debounce; un clic elige; «Quitar» suelta. Con solo el id trae el nombre por su cuenta. | Es la pieza que F9-EXP-14 y F9-PURCH-11 montan en sus formularios. |

## 14. Gastos

> F9-EXP (2026-09-10). Módulo incluido desde **Basic**. Un gasto es un egreso que no toca inventario: fecha, categoría (18 de fábrica + las del negocio), a quién se le pagó (proveedor del catálogo O beneficiario libre), monto, descuento e impuesto con la aritmética de la venta, y cómo se pagó. **Decisión de Carlos:** un gasto pagado en efectivo del cajón de un turno abierto resta del efectivo esperado al cerrar ese turno.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Gastos                                    [Exportar] [Registrar gasto]│
│ Buscar [ … ]  Estado [Todos▾]  Pago [Todos▾]  Categoría [Todas▾]     │
│ Desde [        ]  Hasta [        ]                                    │
│ ┌ 3 gastos · $1,232.00 │ Impuesto $170 │ Pendiente $116 │ Pagado … ┐│
│ ┌────────────┬──────────┬──────────┬───────────┬────────┬─────────┐ │
│ │ Folio      │ Fecha    │ Categoría│ Proveedor │  Total │ Pago    │ │
│ │ GAS-000003 │ 10/09/26 │ Internet │ Telmex    │ 116.00 │ Pagado  │ Ver
│ │ GAS-000002 │ 10/09/26 │ Renta    │ Don Pepe  │ 116.00 │ Pendiente│ Ver
│ │ GAS-000001 │ 09/09/26 │ Luz      │ CFE       │ ~~58~~ │ Anulado │ Ver
│ └────────────┴──────────┴──────────┴───────────┴────────┴─────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

| Pieza | Qué hace | Regla |
|---|---|---|
| **Listado** (`expenses-list.tsx`, tabla cruda con `TABLE_HEAD_ROW`/`TABLE_ROW_HOVER`) | Buscador con debounce, estado, estado de pago, categoría y rango de fechas del negocio; paginado; los anulados tachados. | El resumen del filtro (`expenses-summary-bar.tsx`) va en SU consulta: no cambia al paginar y no cuenta anulados. |
| **Ficha** (`expense-detail.tsx`) | Todos los datos; «Marcar como pagado» (método, cuenta y —con efectivo— la caja de origen con el turno propio preseleccionado) y «Anular» con motivo. | Pagar es entero y una vez; sin `expenses:cancel` no hay «Anular»; un gasto ligado a un turno cerrado no se anula (409, libro cerrado). «Editar» abre el formulario en su lugar. |
| **Formulario** (`expense-form.tsx`, skill `sellpoint-forms`) | Fecha (`DateField`), categoría, proveedor (`SupplierPicker`) o beneficiario (excluyentes), monto y descuento (`MoneyField`), impuesto (`TaxGroupSelect`), pago («Pendiente» ⇒ vencimiento; método ⇒ cuenta con `<datalist>`; «Efectivo» ⇒ caja de origen), referencia, descripción y notas. | Al editar el pago no se toca (se paga desde la ficha); pagado ⇒ monto, descuento e impuesto deshabilitados. |
| **Categorías** (`/expenses/categories`) | Las 18 de fábrica más las propias, con formulario inline. | Desactivar la esconde del selector; borrar una en uso rebota (409). |
| **Cierre de turno** (`close-session.tsx`) | Renglón «Gastos en efectivo −X (n)» y «Efectivo esperado»; la diferencia se calcula contra el esperado. | La columna «Efectivo» sigue siendo ventas: la resta es un renglón aparte. El reporte de cierres y su XLSX ganan la columna. |
| **Dashboard** (`kpi-row.tsx`) | Tarjeta «Utilidad neta del mes» = bruta − gastos activos del mes en el alcance. | Solo con el módulo; `null` (sin datos de costo) nunca es cero. |

## 15. Compras

> F9-PURCH (2026-09-10). Módulo incluido desde **Pro**. Una compra es la factura del proveedor capturada tal como llegó; la mercancía entra después, por una entrada de inventario que nace de ella. **Decisión de Carlos:** si el total que dice el papel no cuadra con la suma de las líneas, la pantalla avisa y la compra se confirma igual.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Compras                                              [Nueva compra] │
│ Folio [COM-…]  Estado [Todas▾]  Proveedor [ … ▾]                    │
│ Desde [        ]  Hasta [        ]                                   │
│ 2 compras   Total del rango: $2,320.00   1 no cuadra con la factura  │
│ ┌────────────┬──────────┬───────────────┬─────────┬───────┬────────┐│
│ │ Folio      │ Fecha    │ Proveedor     │ Factura │ Total │ Estado ││
│ │ COM-000002 │ 11/09/26 │ Distr. Norte  │ A-4472  │ 1,200 │Borrador││ Ver
│ │            │          │ ⚠ No cuadra con la factura: $40.00       ││
│ │ COM-000001 │ 11/09/26 │ Distr. Norte  │ A-4471  │ 1,160 │Confirm.││ Ver
│ └────────────┴──────────┴───────────────┴─────────┴───────┴────────┘│
└─────────────────────────────────────────────────────────────────────┘

┌─ Compra COM-000001 ────────────────────── [Imprimir] [Ingresar al inventario] ┐
│ ┌ Proveedor ─────────────────────────────────────────────────────────────┐ │
│ │ Proveedor [Distribuidora Norte ▾]     Entra a  Central                 │ │
│ │ Fecha de la factura [11/09/2026]      Fecha de recepción [          ]   │ │
│ │ Factura del proveedor [A-4471]        Los costos [NO incluyen impuesto▾]│ │
│ │ Total que dice la factura [1,160.00]  Notas [                        ]  │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ Productos de la factura                                 [Guardar líneas]   │
│ │ Guantes de nitrilo │ Caja ×12 │ 2 │ 500.00 │ 0 │ Lote │ Cad. │ 1,000.00 │ │
│ Cargos adicionales (flete, maniobras)                    [Guardar cargos]  │
│                                             Subtotal        1,000.00       │
│                                             IVA 16% (16%)     160.00       │
│                                             Total          1,160.00        │
│                                             Declarado      1,160.00        │
└────────────────────────────────────────────────────────────────────────────┘
```

| Pieza | Qué hace | Regla |
|---|---|---|
| **Listado** (`purchase-list.tsx`, tabla cruda con `TABLE_HEAD_ROW`/`TABLE_ROW_HOVER`) | Folio con debounce, chips de estado, proveedor y rango sobre la fecha DEL PAPEL; paginado; bandera de descuadre por fila. | El resumen es del **rango filtrado**, no de la página, y excluye anuladas; el descuadre solo se pinta cuando hay. |
| **Nueva compra** (`/purchases/new`) | Proveedor y fecha de la factura; crea el borrador y entra a su ficha. | El folio `COM-…` se acuña al crear el borrador; confirmar no vuelve a pedir folio. |
| **Cabecera** (`purchase-detail.tsx`, `<Card>` con rejilla) | Proveedor, almacén, fechas (`DateField` con tope en el hoy del negocio: ni la factura ni la recepción son de mañana), factura, modo de impuesto, total declarado (`MoneyField`) y notas, con autoguardado a 400 ms. | En una compra **confirmada** solo siguen vivos recepción, factura y notas: lo demás se selló y su papel se imprimió. |
| **Líneas** (`purchase-lines-table.tsx`) | Buscador de producto, presentación, cantidad, costo y descuento (`MoneyInput`), lote y caducidad. Se guardan **en bloque**. | Cada guardado recompone los impuestos de la compra, por eso no hay autoguardado por celda. Lote y caducidad **solo aparecen si el producto se controla por lote** (si no, la entrada rechazaría el lote); el código va a MAYÚSCULAS al teclear y, si el lote ya existe en el **registro** (tenga o no existencias), su caducidad se pone sola y otra distinta rebota — las mismas reglas que Entradas, que ahora también leen el registro y no el stock. Un producto con control y sin lote avisa y **no** bloquea: la entrada lo exigirá. |
| **Cargos** (`purchase-charges.tsx`) | Flete, maniobras, seguro: concepto e importe, en bloque. | Suman al total de la factura y **no** cambian el costo de los productos (landed cost pospuesto). |
| **Totales** | Subtotal, descuento, impuesto por componente, cargos, total y lo declarado. | El descuadre va en `role="alert"` y **no** deshabilita «Confirmar compra». |
| **Acciones** | «Confirmar compra» y «Anular compra» (motivo obligatorio) con `ConfirmDialog`, «Imprimir» el PDF, «Ingresar al inventario». | «Ingresar al inventario» solo sobre una confirmada y con `purchases:manage` **y** `inventory:movement`; si la entrada ya existe dice «Continuar ENT-…», y si ya se confirmó deja constancia en vez de botón. |
| **La entrada que nace** (`document-header-form.tsx`) | Aviso «Esta entrada nació de la compra COM-…» con el motivo bloqueado. | El motivo y el almacén los fija la compra (el API responde 409 `inventory.source_header_locked`); el lote, la caducidad y la ubicación se completan ahí antes de confirmar. |

## 16. Órdenes de compra

> F9-PO (2026-09-11). **Ajuste del negocio**, no plan: se enciende en Mi perfil («Usar órdenes de compra») y solo tiene sentido con el módulo Compras. Apagado, nada cambia (la compra es la factura); encendido, aparece «Órdenes de compra» en el grupo Compras y la compra puede nacer de lo recibido. **Decisión de Carlos:** la recepción es el papel del andén y NO mueve existencias — la mercancía entra por la entrada de la compra que se registra sobre lo recibido, como siempre.
>
> **Ajustes de la prueba en producción (Carlos, 2026-09-12; 1.0.1):** el listado ordena por fecha y folio desc, gana la columna «Recibido» (% de lo pedido, con su barra) y el estado de vista «Facturada» (todo lo recibido ya tiene compra; una compra anulada la devuelve a «Recibida»); en Compras, el estado de vista «En inventario» (la entrada ya se confirmó) y el filtro «Confirmada» pasa a ser «aún sin ingresar». Al agregar un producto a la orden o a la compra se precarga el último costo pagado a ESE proveedor (misma presentación y misma base) y se dice de qué compra viene. Emitir la orden, confirmar la recepción y confirmar la compra muestran el aviso verde que se trae a la vista; anular, el rojo. Confirmar la recepción guarda antes las líneas tecleadas (el lote viajaba vacío a la compra). Los rebotes de recibir de más dicen «Línea N: …». «Cerrar corta» → «Cerrar con faltante».

```
┌ Órdenes de compra ──────────────────────────────── [Nueva orden] ┐
│ Folio [OCO-…]  Estado [Con pendiente ▾]  Proveedor [ … ▾]  Desde/Hasta │
│ 3 órdenes   Total esperado del rango: $41,760.00   2 esperan mercancía │
│ │ OCO-000002 │ 10/09 │ 05/09 (Vencida) │ Distr. Norte │ 13,920 │ Emitida │ Ver
│ │ OCO-000001 │ 10/09 │ 25/09           │ Distr. Norte │ 13,920 │ Parcial │ Ver
└───────────────────────────────────────────────────────────────────┘

┌ Orden OCO-000001  [Parcialmente recibida] ── [Imprimir] [Registrar recepción] [Registrar compra de lo recibido] [Cerrar orden] ┐
│ ┌ Proveedor ── Entregar en: Central ── Fecha del pedido ── Entrega esperada (sin tope) ── Referencia ── Condiciones ── Notas ┐ │
│ Productos del pedido                                                                                                         │
│ │ Guantes de nitrilo │ Caja ×12 │ 100 │ 120.00 │ — │ 13,920.00 │ 60 de 100 ▓▓▓▓▓▓░░░░ │ [Cerrar corta] │                    │
│ Recepciones: RCP-000001 · 11/09 · REM-889 · Confirmada · Sin factura      Compras de esta orden: —                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Pieza | Qué hace | Regla |
|---|---|---|
| **Listado** (`purchase-order-list.tsx`, tabla cruda con `TABLE_HEAD_ROW`/`TABLE_ROW_HOVER`) | Folio con debounce, chips de estado más dos VISTAS («Con pendiente», «Recibidas sin factura»), proveedor, rango sobre la fecha del pedido, resumen del rango. | La fecha esperada va en rojo con «(Vencida)» solo si ya pasó Y la orden sigue esperando; cerrada o recibida no está vencida. |
| **Enlace del menú** (`nav.ts` con `when`) | «Órdenes de compra» en el grupo Compras. | Existe solo con módulo + permiso + **el ajuste encendido** (`useModuleNav` aplica el predicado); la pantalla sigue accesible por URL — leer nunca se apaga. |
| **Nueva orden** (`/purchase-orders/new`) | Proveedor, fecha del pedido (tope hoy) y fecha esperada. | La fecha esperada es la ÚNICA sin tope: es la promesa del proveedor. |
| **Cabecera** (`purchase-order-detail.tsx`, `<Card>`) | Autoguardado ACUMULADO con `useAutosave` (un PATCH por pausa, extraído de la compra). | En borrador se edita todo; emitida, solo fecha esperada, referencia, condiciones y notas; cerrada o anulada, nada. |
| **Líneas** (`purchase-order-lines-table.tsx`) | En borrador: buscador (`ProductSearch`, compartido con la compra), presentación, cantidad, costo acordado, descuento, en bloque. Emitida: «60 de 100» con barra de progreso y «Cerrar corta» por línea con pendiente. | Sin lote ni caducidad: eso es de la recepción. Comparte con la compra el buscador y nada más: las dos tablas dicen cosas distintas. |
| **Acciones** | «Emitir orden» (exige costo acordado), «Cerrar orden» (dice cuántas líneas quedan cortas), «Anular» (solo borrador o emitida sin mercancía), «Imprimir». | «Registrar recepción» solo con pendiente; «Registrar compra de lo recibido» solo con recepciones confirmadas sin factura: abre un selector con esas recepciones marcadas, crea la compra y navega a ella. |
| **Recepción** (`purchase-receipt-detail.tsx`) | Nace prellenada con lo pendiente; fecha (tope hoy), remisión / *packing slip*, notas; por línea pedido, recibido antes, pendiente, «Llegó», lote y caducidad con `LotCells` (las MISMAS celdas de la compra). | Confirmar suma a la orden y avisa que la mercancía entra al inventario con la compra y su entrada; el 422 por recibir de más se pinta junto a la tabla; facturada no se anula. |
| **La compra que nace** (`purchase-detail.tsx`) | «Nació de la orden OCO-… · Recepciones RCP-…» con enlaces; por línea «Acordado: $120.00 · +$5.00» en ámbar si difiere; aviso en `role="alert"` si factura más de lo recibido. | Las variaciones **avisan y no bloquean**: Confirmar sigue habilitado. |

## Apéndice — Documentos Relacionados

- [ARQUITECTURA.md](ARQUITECTURA.md) — Stack, multi-tenancy, seguridad, roadmap
- [CASOS_DE_USO.md](CASOS_DE_USO.md) — Casos de uso detallados con flujos alternativos
- [FLUJOS.md](FLUJOS.md) — Diagramas Mermaid de los flujos críticos
- [ControlDeInventario.md](ControlDeInventario.md) — Requerimientos originales del cliente
- [PuntoDeVenta.md](PuntoDeVenta.md) — Requerimientos originales del POS

---

*Documento de vistas y acciones de SellPoint. Los wireframes son ilustrativos; el diseño final será definido durante la Fase 0 con un sistema de diseño basado en shadcn/ui + Tailwind.*
