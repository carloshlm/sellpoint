---
title: Importar y exportar con Excel
who: dueño
---

Si ya tienes tu catálogo en una hoja de cálculo, no lo captures uno por uno:
súbelo con una **plantilla de Excel**. La misma plantilla sirve para corregir
muchos registros de una vez, por ejemplo para subir todos tus precios.

Se puede importar en cinco pantallas:

| Pantalla | Botón |
|---|---|
| Productos (capítulo 16) | **Importar** |
| Servicios (capítulo 18) | **Importar servicios** |
| Sucursales (capítulo 15) | **Importar sucursales** |
| Proveedores (capítulo 19) | **Importar proveedores** |
| Subcatálogos (capítulo 21) | **Importar** |

## Paso a paso

1. En la pantalla que quieras, presiona el botón de importar.
2. Presiona **Plantilla Excel**. La plantilla **ya trae lo que tienes dado de
   alta**, un renglón por registro, con las columnas de tu catálogo.
3. Ábrela en Excel, agrega renglones o corrige los que ya están, y guárdala como
   Excel (.xlsx).
4. Regresa a SellPointy y presiona **Elegir archivo** para subirla.
5. Antes de guardar nada, SellPointy revisa el archivo y te dice cuántas filas
   son válidas, cuántas son **para dar de alta** y cuántas **para actualizar**.
6. Si todo está bien, presiona **Importar**.

![El resumen antes de importar productos: la plantilla sin cambios solo actualiza](screen:import-products)

## El código manda

Cada renglón se reconoce por su **código** (en productos, la columna `sku`, que
es el **Código interno**):

- Si el código **ya existe**, el renglón **actualiza** ese registro. Por eso
  puedes bajar la plantilla, cambiar precios y volver a subirla sin duplicar
  nada.
- Si el código **es nuevo**, el renglón **da de alta** un registro.
- Mayúsculas y minúsculas dan igual: «agua-1l» es el mismo código que «AGUA-1L».
- Un código **repetido dentro del mismo archivo** es un error: dos renglones no
  pueden describir el mismo registro.

En proveedores el código puede ir vacío: el renglón da de alta uno nuevo con el
siguiente PROV-… .

## Las columnas de productos

| Columna | Qué va |
|---|---|
| `codigo_de_barras` | El código impreso en el empaque. Opcional. |
| `sku` | El código interno. **Obligatorio.** |
| `nombre` | El nombre. **Obligatorio.** |
| `unidad_base` | `unit` para pieza, `kg`, `gr`, `l`, `ml`… |
| `costo` | Con o sin impuesto, según tu ajuste de impuestos: el diálogo te lo recuerda. |
| `precio` | El precio de venta. |
| `stock_minimo` | La cantidad para el aviso de «bajo mínimo». |
| `ubicacion` | Dónde está en la sucursal. |
| `controla_lotes`, `es_compuesto` | SI o NO. |
| `impuesto` | El código de un grupo de impuesto, como `VAT16`. Vacío, usa el predeterminado (capítulo 13). |

Después vienen tus **campos propios**, con el nombre que les pusiste
(capítulo 21). En un campo que es lista de otro catálogo se escribe el
**código** del registro, como «P1».

La plantilla **no carga existencias**: para decir cuánto tienes de cada
producto, registra una entrada (capítulo 23, «Entradas y salidas»).

## Si hay errores

El resumen lista cada problema con su fila y, si la tiene, su código: por
ejemplo, «Fila 7 (AGUA-1L), columna «precio»: …». Tienes dos caminos:

- Corrige el archivo y vuelve a subirlo.
- Marca la casilla para **importar solo las filas válidas** y saltar las que
  tienen error.

Sin esa casilla, la importación es **todo o nada**: si alguna fila tiene error,
no se importa ninguna.

El archivo puede pesar hasta 5 MB en productos y hasta 2 MB en las demás
pantallas.

## Exportar

La plantilla de cada pantalla ya es una copia de lo que tienes. Además, en
**Reportes generales** el reporte **Catálogo** descarga todos tus productos con
sus campos propios (capítulo 31, «Reportes y exportarlos a Excel»).
