---
title: Reportes y exportarlos a Excel
who: dueño
plan: Desde Basic
---

Los reportes responden las preguntas que el panel no alcanza: qué se vendió
cada día, cómo cerró cada turno, cuánto impuesto cobraste. Todos se pueden
bajar a Excel para guardarlos, enviarlos a tu contador o trabajarlos a tu modo.

Entra desde el menú de la izquierda, en **Reportes** › **Reportes generales**.
Los ve quien tiene el permiso **Ver reportes**; de fábrica, los roles
**Administrador**, **Encargado** y **Consulta** (apéndice B).

![Reportes generales](screen:reports-hub)

## Qué hay en cada tarjeta

Las tarjetas hacen una de tres cosas: abren un reporte con sus filtros, bajan un
Excel en ese momento o te llevan a la pantalla donde ya vive esa información.

| Tarjeta | Qué hace |
|---|---|
| **Stock por sucursal** | Abre el reporte de existencias, con su costo promedio y su valor sin impuesto. |
| **Ventas** | Abre el reporte de ventas del periodo. |
| **Ventas por producto** | Abre cada producto vendido, ticket por ticket. |
| **Ventas por servicio** | Abre cada servicio vendido, ticket por ticket. |
| **Cierres de turno** | Abre cada turno con su arqueo. |
| **Impuestos cobrados** | Abre lo cobrado por cada impuesto y tasa. |
| **Kardex** | Te lleva a **Productos**: abre un producto y su pestaña de kardex, que tiene su propio botón de Excel (capítulo 22). Desde Pro. |
| **Catálogo** | Baja en ese momento un Excel con todos tus productos y sus campos propios. |
| **Usuarios** | Baja un Excel con quién tiene acceso, con qué rol y a qué sucursales. |
| **Sucursales** | Baja un Excel con tus sucursales y cuántos productos guarda cada una. |
| **Vencimientos** | Te lleva a **Próximos a vencer** (capítulo 26). En Plus. |
| **En tránsito** | Te lleva a **Traspasos** (capítulo 24). Desde Pro. |

Cada reporte que abre una tarjeta tiene, junto a su título, el botón **Volver a
Reportes** para regresar a esta lista.

## Los filtros

Cada reporte tiene arriba sus filtros, y la tabla cambia en cuanto eliges uno:

- **Sucursal**. Abre en **Todas las sucursales**, aunque tengas una
  **Sucursal asignada** (capítulo 32): así puedes ver el negocio completo.
  Para ver solo una, elígela en la lista; **Todas las sucursales** se queda
  como opción para volver a ella.
- **Desde** y **Hasta**, para el rango de fechas. **Ventas**, **Ventas por
  producto** y **Ventas por servicio** abren con **Desde** en el día de hoy y
  **Hasta** vacío: al entrar ves lo que se vendió hoy. **Limpiar fechas** borra
  las dos fechas y la tabla muestra todas las fechas; para ver otro día o un
  periodo, elige sus fechas.

La tabla muestra 20 renglones por página; usa **Anterior** y **Siguiente** para
moverte.

## Ventas

![El reporte de ventas](screen:reports-sales)

Una venta por renglón: su **Folio**, la **Fecha**, quién la cobró (**Vendió**),
la **Sucursal**, el **Estado** y la forma de **Pago**. Con **Estado** puedes ver
**Todas**, solo las **Cobrada** o solo las **Cancelada**.

Al pie aparece cuánto entró por cada forma de pago. Esos totales son de **todo
el periodo filtrado**, no solo de la página que estás viendo.

## Ventas por producto y por servicio

![El reporte de ventas por producto](screen:reports-sales-by-product)

**Ventas por producto** muestra cada línea de cada ticket: la **Fecha**, el
**Folio**, quién la cobró (**Vendió**), la **Sucursal**, el **Código interno** y
el **Código de barras** del producto, el **Producto**, la **Cantidad**, el
**Precio unitario**, el **Impuesto** y el **Total** de esa línea. Si el producto
no tiene código de barras, esa columna queda vacía. La **Cantidad** se lee como
en el ticket: si se vendió en caja, dice cuántas cajas y cuántas piezas trae.

El **Total** es lo que cobró esa línea, ya con su descuento y con la parte que
le tocó del descuento del ticket. Por eso los productos y los servicios de un
ticket, juntos, suman lo que se cobró en él.

![El reporte de ventas por servicio](screen:reports-sales-by-service)

**Ventas por servicio** es el mismo reporte para los servicios: lleva el
**Código** del servicio y la columna **Servicio** en lugar de los dos códigos y
del **Producto**.

Los dos muestran **solo las ventas cobradas**: una venta cancelada no aparece.
Por eso no tienen el filtro de **Estado**; sus filtros son **Sucursal**,
**Desde** y **Hasta**, y abren con lo vendido hoy. Al pie verás el **Impuesto** y
el **Total** de todo el periodo filtrado. El Excel trae las mismas columnas que
la pantalla, sin columna de estado.

## Cierres de turno

![El reporte de cierres de turno](screen:reports-shifts)

Cada turno cerrado con su arqueo: el **Fondo inicial** con que abrió el cajón,
los **Gastos en efectivo** que salieron de él, lo **Calculado** (lo que debía
haber en el cajón: el fondo, más lo vendido en efectivo, menos esos gastos), lo
**Contado** (lo que declaró el cajero), la **Diferencia** y la **Nota** del
cierre. Un turno que abrió sin fondo o que no tuvo gastos dice «—» en esa
columna. Una diferencia sale en rojo cuando faltó dinero y en verde cuando
sobró; si todo coincide, dice **Cuadró**. Presiona **Ver** para abrir las
ventas de ese turno. El Excel trae las mismas columnas y, además, cuándo abrió
el turno, quién lo abrió y lo vendido con cada forma de pago.

El reporte abre con los turnos **Cerrados** de hoy. Cambia las fechas para ver
días anteriores, elige un **Empleado** para ver solo los suyos o elige
**Abiertos** en **Turnos** para ver los que siguen en curso. El cierre de turno
se explica en el capítulo 5.

## Impuestos cobrados

![El reporte de impuestos cobrados](screen:reports-taxes)

Lo cobrado por cada impuesto y tasa: la **Base** sobre la que se calculó, lo
**Cobrado** y en cuántos **Tickets**. Abre con el mes en curso, del día 1 a hoy.
Abajo tienes los totales del periodo: **Ventas brutas**, **Neto**, **Impuesto**
y **Tickets**. Es el número que necesitas para tu declaración.

## Stock por sucursal

Cuánto hay de cada producto en cada sucursal, con su **Mínimo**, su **Costo
promedio** y su **Valor (sin impuesto)**. Para encontrar uno, escribe su nombre
o su SKU en **Buscar producto**. Dos casillas lo cambian:

- **Solo bajo mínimo** deja los productos que hay que resurtir. El mínimo se
  compara contra lo que hay **sumando todas las sucursales**.
- **Detalle por lote y ubicación** separa cada producto por lote, caducidad y
  ubicación. Lo que un producto con lote tiene sin lote en una sucursal sale en
  su propio renglón, con **Sin lote** en la columna del lote y la caducidad
  vacía. Los lotes que ya se agotaron no aparecen.

Si un producto no tiene costo, su valor queda vacío en lugar de contar como
cero.

## Bajar a Excel

1. Abre el reporte y deja los filtros como los quieres.
2. Presiona **Exportar Excel**.

El archivo lleva **exactamente lo que filtraste**, todas las páginas, no solo la
que estás viendo. Un archivo puede tener hasta **10,000 renglones**; si tu
reporte tiene más, SellPointy no lo corta a la mitad: te avisa cuántos tiene y
te pide acotar los filtros, por ejemplo con un rango de fechas más corto o una
sola sucursal.

Si la descarga falla, verás **No pudimos generar el archivo. Vuelve a
intentarlo.**
