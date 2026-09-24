---
title: Qué puede hacer cada rol
who: todos
---

Estos son los permisos con los que nacen los cuatro roles de fábrica (capítulo
33). En la pantalla **Roles** cada permiso aparece con el código de la primera
columna.

## Vender y el catálogo

| Permiso | Qué permite | Admin | Manager | Seller | Viewer |
|---|---|:---:|:---:|:---:|:---:|
| `pos:sell` | Operar el punto de venta: abrir turno y cobrar | ✓ | ✓ | ✓ | — |
| `pos:quote` | Hacer cotizaciones | ✓ | ✓ | ✓ | — |
| `pos:view` | Ver el historial de ventas y reimprimir tickets | ✓ | ✓ | ✓ | ✓ |
| `pos:cancel` | Anular una venta ya cobrada | ✓ | ✓ | — | — |
| `products:read` | Ver los productos | ✓ | ✓ | ✓ | ✓ |
| `products:manage` | Crear y editar productos, presentaciones y composición | ✓ | ✓ | — | — |
| `services:read` | Ver los servicios | ✓ | ✓ | ✓ | ✓ |
| `services:manage` | Crear, editar, desactivar y eliminar servicios | ✓ | ✓ | — | — |
| `suppliers:read` | Ver los proveedores | ✓ | ✓ | — | ✓ |
| `suppliers:manage` | Dar de alta, editar y retirar proveedores | ✓ | ✓ | — | — |
| `catalogs:read` | Ver los subcatálogos y sus registros | ✓ | ✓ | — | ✓ |
| `catalogs:write` | Crear y editar registros de los subcatálogos | ✓ | ✓ | — | — |
| `catalogs:manage` | Diseñar la estructura: subcatálogos y campos propios | ✓ | — | — | — |
| `warehouses:read` | Ver las sucursales | ✓ | ✓ | — | ✓ |
| `warehouses:manage` | Crear, editar y desactivar sucursales | ✓ | ✓ | — | — |

## Inventario, compras, gastos y administración

| Permiso | Qué permite | Admin | Manager | Seller | Viewer |
|---|---|:---:|:---:|:---:|:---:|
| `inventory:read` | Ver existencias, kardex, traspasos y documentos de inventario | ✓ | ✓ | — | ✓ |
| `inventory:movement` | Registrar y confirmar entradas, salidas y traspasos | ✓ | ✓ | — | — |
| `inventory:manage` | Cancelar traspasos y aprobar inventarios físicos | ✓ | — | — | — |
| `purchases:read` | Ver las compras a proveedores | ✓ | ✓ | — | ✓ |
| `purchases:manage` | Registrar, editar y confirmar compras | ✓ | ✓ | — | — |
| `purchases:cancel` | Anular compras | ✓ | ✓ | — | — |
| `expenses:read` | Ver los gastos | ✓ | ✓ | — | ✓ |
| `expenses:manage` | Registrar, editar y pagar gastos, y administrar sus categorías | ✓ | ✓ | — | — |
| `expenses:cancel` | Anular gastos | ✓ | ✓ | — | — |
| `reports:read` | Ver los reportes y los números del panel | ✓ | ✓ | — | ✓ |
| `users:read` | Ver los usuarios | ✓ | ✓ | — | ✓ |
| `users:manage` | Crear, editar y suspender usuarios | ✓ | — | — | — |
| `roles:read` | Ver los roles y sus permisos | ✓ | ✓ | — | ✓ |
| `roles:manage` | Crear y editar roles | ✓ | — | — | — |
| `tenants:manage` | Cambiar los datos del negocio y ver **Mi plan** | ✓ | — | — | — |

## Para leer las tablas

- La primera parte del código dice sobre qué es el permiso: `pos` es el punto
  de venta, `inventory` el inventario, `tenants` tu negocio. La segunda dice qué
  deja hacer: `read` consultar, `manage` administrar, `cancel` anular.
- Tener un permiso no basta si tu plan no incluye la función: `purchases:manage`
  no sirve en Basic, que no trae Compras (apéndice A).
- Quien tiene **`users:manage` y `roles:manage`**, como el Admin, ve todas las
  sucursales aunque tenga un alcance marcado (capítulo 32).
- La lista también muestra permisos de **`reception`** y **`medical_clinic`**:
  son de módulos hechos a la medida para algunos negocios y no los cubre este
  manual.
