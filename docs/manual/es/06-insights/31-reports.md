---
title: Reportes y exportarlos a Excel
who: dueño
plan: Desde Basic
---

Los reportes responden las preguntas que el panel no alcanza: qué se vendió
cada día, cómo cerró cada turno, cuánto impuesto cobraste. Todos se pueden
bajar a Excel para guardarlos, enviarlos a tu contador o trabajarlos a tu modo.

Entra desde el menú de la izquierda, en **Reportes** › **Reportes generales**.
Los ve quien tiene el permiso de consultar reportes (`reports:read`); con los
roles de fábrica, **Admin**, **Manager** y **Viewer** (apéndice B).

![Reportes generales](screen:reports-hub)

## Qué hay en cada tarjeta

Las tarjetas hacen una de tres cosas: abren un reporte con sus filtros, bajan un
Excel en ese momento o te llevan a la pantalla donde ya vive esa información.

| Tarjeta | Qué hace |
|---|---|
| **Stock por sucursal** | Abre el reporte de existencias, con su costo promedio y su valor sin impuesto. |
| **Ventas** | Abre el reporte de ventas del periodo. |
| **Cierres de turno** | Abre cada turno con su arqueo. |
| **Impuestos cobrados** | Abre lo cobrado por cada impuesto y tasa. |
| **Kardex** | Te lleva a **Productos**: abre un producto y su pestaña de kardex, que tiene su propio botón de Excel (capítulo 22). Desde Pro. |
| **Catálogo** | Baja en ese momento un Excel con todos tus productos y sus campos propios. |
| **Usuarios** | Baja un Excel con quién tiene acceso, con qué rol y a qué sucursales. |
| **Sucursales** | Baja un Excel con tus sucursales y cuántos productos guarda cada una. |
| **Vencimientos** | Te lleva a **Próximos a vencer** (capítulo 26). En Plus. |
| **En tránsito** | Te lleva a **Traspasos** (capítulo 24). Desde Pro. |

## Los filtros

Cada reporte tiene arriba sus filtros, y la tabla cambia en cuanto eliges uno:

- **Sucursal**. Si tienes una sucursal asignada, el reporte abre con ella; para
  ver otra, elígela en la lista.
- **Desde** y **Hasta**, para el rango de fechas. **Limpiar fechas** las borra.

La tabla muestra 20 renglones por página; usa **Anterior** y **Siguiente** para
moverte.

## Ventas

![El reporte de ventas](screen:reports-sales)

Una venta por renglón: su **Folio**, la **Fecha**, quién la cobró (**Vendió**),
la **Sucursal**, el **Estado** y la forma de **Pago**. Con **Estado** puedes ver
**Todas**, solo las **Cobrada** o solo las **Cancelada**.

Al pie aparece cuánto entró por cada forma de pago. Esos totales son de **todo
el periodo filtrado**, no solo de la página que estás viendo.

## Cierres de turno

![El reporte de cierres de turno](screen:reports-shifts)

Cada turno cerrado con su arqueo: lo **Calculado** (lo que debía haber en el
cajón), lo **Contado** (lo que declaró el cajero), la **Diferencia** y la
**Nota** del cierre. Una diferencia sale en rojo cuando faltó dinero y en verde
cuando sobró; si todo coincide, dice **Cuadró**. Presiona **Ver** para abrir las
ventas de ese turno.

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
promedio** y su **Valor (sin impuesto)**. Dos casillas lo cambian:

- **Solo bajo mínimo** deja los productos que hay que resurtir. El mínimo se
  compara contra lo que hay **sumando todas las sucursales**.
- **Detalle por lote y ubicación** separa cada producto por lote, caducidad y
  ubicación.

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
