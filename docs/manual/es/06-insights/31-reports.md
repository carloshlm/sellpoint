---
title: Reportes y exportarlos a Excel
who: dueño
plan: Desde Basic
---

Los reportes responden las preguntas que el panel no alcanza: qué se vendió
cada día, qué te deja más utilidad, cómo cerró cada turno, cuánto impuesto
cobraste. Todos se pueden
bajar a Excel para guardarlos, enviarlos a tu contador o trabajarlos a tu modo.

Entra desde el menú de la izquierda, en **Reportes** › **Reportes generales**.
Los ve quien tiene el permiso **Ver reportes**; de fábrica, los roles
**Administrador**, **Encargado** y **Consulta** (apéndice B).

![Reportes generales](screen:reports-hub)

## Qué hay en cada sección

Las tarjetas están agrupadas en cinco secciones, cada una con su título y una
línea que dice qué encuentras en ella. Cada tarjeta hace una de tres cosas: abre
un reporte con sus filtros, baja un Excel en ese momento o te lleva a la
pantalla donde ya vive esa información. Si tu rol no puede ver ninguna tarjeta
de una sección, esa sección no aparece.

### Ventas

| Tarjeta | Qué hace |
|---|---|
| **Ventas** | Abre el reporte de ventas del periodo. |
| **Ventas por producto** | Abre cada producto vendido, ticket por ticket. |
| **Ventas por servicio** | Abre cada servicio vendido, ticket por ticket. |
| **Más vendidos** | Abre los productos y servicios que más vendiste. |

### Utilidad

| Tarjeta | Qué hace |
|---|---|
| **Mayor utilidad** | Abre los productos y servicios que más te dejan. |
| **Vendidos bajo su costo** | Abre lo que vendiste por menos de lo que te costó. |

### Caja e impuestos

| Tarjeta | Qué hace |
|---|---|
| **Cierres de turno** | Abre cada turno con su arqueo. |
| **Impuestos cobrados** | Abre lo cobrado por cada impuesto y tasa. |

### Inventario

| Tarjeta | Qué hace |
|---|---|
| **Stock por sucursal** | Abre el reporte de existencias, con sus costos, su precio y su valor a precio de venta. |
| **Kardex** | Te lleva a **Productos**: abre un producto y su pestaña de kardex, que tiene su propio botón de Excel (capítulo 22). Desde Pro. |
| **Vencimientos** | Te lleva a **Próximos a vencer** (capítulo 26). En Plus. |
| **En tránsito** | Te lleva a **Traspasos** (capítulo 24). Desde Pro. |

### Catálogos para descargar

| Tarjeta | Qué hace |
|---|---|
| **Catálogo** | Baja en ese momento un Excel con todos tus productos y sus campos propios. |
| **Usuarios** | Baja un Excel con quién tiene acceso, con qué rol y a qué sucursales. |
| **Sucursales** | Baja un Excel con tus sucursales y cuántos productos guarda cada una. |

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
  **Hasta** vacío: al entrar ves lo que se vendió hoy. **Más vendidos**,
  **Mayor utilidad** y **Vendidos bajo su costo** abren con el mes en curso,
  del día 1 a hoy. **Limpiar fechas** borra las dos fechas y la tabla muestra
  todas las fechas; para ver otro día o un periodo, elige sus fechas.

La tabla muestra 20 renglones por página; usa **Anterior** y **Siguiente** para
moverte.

## Ventas

![El reporte de ventas](screen:reports-sales)

Una venta por renglón: su **Folio**, la **Fecha**, quién la cobró (**Vendió**),
la **Sucursal**, el **Estado**, la forma de **Pago**, el **Descuento**, el
**Total** y el **Motivo**. Con **Estado** puedes ver **Todas**, solo las
**Cobrada** o solo las **Cancelada**.

El **Descuento** es todo lo que se descontó en esa venta: lo de cada producto y
lo del ticket completo. Si la venta no tuvo descuento, la celda queda vacía. El
**Motivo** dice el porqué: en una venta cobrada, el motivo del descuento que
escribió el cajero; en una cancelada, el motivo de la cancelación. Para ver solo
las ventas que llevaron descuento, marca **Solo con descuento**.

Al pie aparece cuánto entró por cada forma de pago y, al lado, los
**Descuentos**: cuánto se descontó. Esos totales son de **todo el periodo
filtrado**, no solo de la página que estás viendo, y solo suman las ventas
cobradas: si filtras solo las **Cancelada**, el pie no aparece, porque de una
venta cancelada no entró dinero.

El Excel trae, después de las columnas de siempre, cinco más: **Descuento**,
**Motivo del descuento**, **Canceló** (quién canceló la venta), **Fecha de
cancelación** y **Motivo de la cancelación**. Las columnas de siempre no
cambian de lugar, así que lo que ya armaste sobre el archivo sigue funcionando.

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

### Las ventas de un solo producto o servicio

Si llegas desde el aviso de un producto que creció, en el panel (capítulo 30),
el reporte abre con las ventas de **ese producto** (o de ese servicio) y con las
fechas del mes. Arriba de la tabla verás de cuál es, por ejemplo **Solo las
ventas de Agua mineral**. La tabla, el pie y el Excel traen solo sus ventas, y
puedes cambiar la **Sucursal** y las fechas como siempre.

Para volver a ver todos, presiona **Quitar filtro**: la tabla muestra otra vez
todos los productos (o todos los servicios), con las mismas fechas.

## Más vendidos y mayor utilidad

![El reporte de los más vendidos](screen:reports-top-sold)

**Más vendidos** pone en orden tus productos y servicios por lo que vendieron,
de la venta más alta a la más baja. **Mayor utilidad** deja solo los que te
dejaron ganancia, de la utilidad más alta a la más baja. Para las mismas fechas,
sus números son los mismos que los de **Más vendidos** y **Mayor utilidad** en
el panel (capítulo 30).

![El reporte de mayor utilidad](screen:reports-top-profit)

Cada renglón es un artículo, con estas columnas:

- **Artículo**: su nombre, con un ícono que dice si es un producto, un servicio
  o un concepto (un texto libre de una cotización).
- **Cantidad**: cuánto se vendió, en su unidad base, por ejemplo «2.500
  kilogramos» o «24 piezas». Un servicio se cuenta: «3».
- **Venta sin impuesto**: lo que cobraste por él, ya con sus descuentos y sin
  impuestos.
- **Costo**: el costo que tenía el artículo en cada venta (capítulo 30).
- **Utilidad**: la venta sin impuesto menos el costo.
- **Margen**: de lo que vendiste sin impuestos, qué parte te quedó.

Si alguna venta del artículo no tenía costo, el **Costo**, la **Utilidad** y el
**Margen** quedan vacíos: sin el costo no se puede saber cuánto te dejó. Para
que cuente, captura el costo del producto o del servicio.

Sus filtros son **Sucursal**, **Desde**, **Hasta** y **Tipo**: **Todos**,
**Productos** o **Servicios**. Los conceptos salen con los **Productos**. Al pie
verás la **Venta sin impuesto**, el **Costo**, la **Utilidad** y el **Margen** de
todo el periodo filtrado; si a algún artículo le falta su costo, el costo, la
utilidad y el margen del pie dicen «—».

Presiona el nombre de un artículo para ver sus tickets: un producto abre
**Ventas por producto** y un servicio, **Ventas por servicio**, con las ventas de
ese artículo, la misma sucursal y las mismas fechas. Un concepto abre **Ventas
por producto** con todas las ventas de esas fechas.

El Excel trae los mismos artículos y, además de las columnas de la pantalla, el
**Tipo** y el **Código** de cada uno. La cantidad va como número y su unidad en
su propia columna, **Unidad**, para que puedas sumarla.

## Vendidos bajo su costo

![El reporte de lo vendido bajo su costo](screen:reports-below-cost)

Deja solo lo que vendiste por menos de lo que te costó, de la pérdida más
grande a la más pequeña. La **Utilidad** sale en rojo: es lo que perdiste. Tiene
las mismas columnas, filtros, pie y Excel que **Más vendidos**, y el nombre de
cada artículo también abre sus tickets.

Arriba verás el aviso **Solo aparecen los artículos con costo capturado: sin su
costo no se puede saber si se vendieron por debajo de él.** Un artículo sin
costo no sale aquí aunque lo hayas vendido muy barato; para que salga, captura
su costo.

## Cierres de turno

![El reporte de cierres de turno](screen:reports-shifts)

Cada turno cerrado con su **Folio**, la **Apertura** y el **Cierre** (la fecha y
la hora en que se abrió y se cerró) y su arqueo: el **Fondo inicial** con que
abrió el cajón, los **Gastos en efectivo** que salieron de él, las **Entradas**
y los **Retiros** de efectivo que el cajero registró sin una venta (capítulo 5),
lo **Calculado** (lo que debía haber en el cajón: el fondo, más lo vendido en
efectivo, más las entradas, menos los retiros y esos gastos), lo **Contado** (lo
que declaró el cajero), la **Diferencia** y la **Nota** del cierre. Un turno que
abrió sin fondo, o que no tuvo gastos, entradas o retiros, dice «—» en esa
columna. Una diferencia sale en rojo cuando faltó dinero y en verde cuando
sobró; si todo coincide, dice **Cuadró**. Un retiro registrado, por ejemplo el
efectivo que se llevó a la caja fuerte, ya está restado de lo calculado: no
aparece como faltante.

Presiona **Ver** para abrir las ventas de ese turno y, debajo, sus **Entradas y
retiros de efectivo**, si tuvo alguno: la **Hora**, el **Tipo**, el **Motivo**,
la **Nota**, quién lo **Registró** y el **Importe**. Uno anulado sale tachado y
marcado **Anulado**, con quién lo anuló y por qué. Un retiro que pasó sin el
código de autorización del negocio lleva la marca **Sin código**; si tu negocio
no tiene código (capítulo 14), todos los retiros la llevan. Las entradas nunca
piden código.

Presiona **PDF** para descargar el cierre del turno en tamaño carta: arriba
el arqueo y abajo las ventas, los gastos del cajón y las entradas y retiros de
efectivo, con los anulados tachados y los retiros **Sin código** marcados. El
Excel trae las mismas columnas y, además, quién abrió el turno y lo vendido con
cada forma de pago; las **Entradas de efectivo** y los **Retiros de efectivo**
van al final.

El reporte abre con los turnos **Cerrados** de hoy. Cambia las fechas para ver
días anteriores, elige un **Empleado** para ver solo los suyos o elige
**Abiertos** en **Turnos** para ver los que siguen en curso. Si tienes el folio
de un turno, escríbelo en **Buscar folio**: lo busca en todas las fechas,
abiertos y cerrados. El cierre de turno se explica en el capítulo 5.

Para encontrar los turnos que no cuadraron, usa **Diferencia**: **Con
faltante** deja los que cerraron con menos dinero del calculado, **Con
sobrante** los que cerraron con más y **Cuadró** los que coincidieron. Con
**Abiertos** no aplica, porque un turno abierto todavía no tiene arqueo. Al pie
verás cuánto faltó y cuánto sobró en todo el periodo filtrado, cada cosa por su
lado (por ejemplo, «Faltó $150.00 · Sobró $20.00»): un sobrante no compensa un
faltante. El Excel trae solo los turnos que deja el filtro.

## Impuestos cobrados

![El reporte de impuestos cobrados](screen:reports-taxes)

Lo cobrado por cada impuesto y tasa: la **Base** sobre la que se calculó, lo
**Cobrado** y en cuántos **Tickets**. Abre con el mes en curso, del día 1 a hoy.
Abajo tienes los totales del periodo: **Ventas brutas**, **Neto**, **Impuesto**
y **Tickets**. Es el número que necesitas para tu declaración.

## Stock por sucursal

Cuánto hay de cada producto en cada sucursal, con su **Mínimo** y cuatro
importes:

- **Costo promedio**: lo que te ha costado en promedio, según tus compras.
- **Costo de catálogo** y **Precio de venta**: los que tiene hoy la ficha del
  producto, por unidad base. Si un producto solo tiene precio por caja, aquí
  verás lo que le toca a cada pieza.
- **Valor a precio de venta**: el precio de venta por la cantidad que hay en esa
  sucursal.

La **Cantidad** y el **Mínimo** dicen su unidad, como «2.500 kilogramos» o
«12 piezas». En el Excel, la cantidad va como número, para que puedas sumarla, y
la unidad va en su propia columna, **Unidad**.

Para encontrar un producto, escribe su nombre o su SKU en **Buscar producto**.
Tres casillas cambian el reporte:

- **Solo bajo mínimo** deja los productos que hay que resurtir. El mínimo se
  compara contra lo que hay **sumando todas las sucursales**.
- **Agotados** deja los productos que tienen un stock mínimo y ya no tienen
  nada en tus sucursales: la suma está en cero. Es la misma regla de
  **Agotados** en el panel. Un producto que nunca ha tenido existencias en tus
  sucursales no tiene renglón en este reporte, así que el panel lo cuenta pero
  aquí no aparece.
- **Detalle por lote y ubicación** separa cada producto por lote, caducidad y
  ubicación. Lo que un producto con lote tiene sin lote en una sucursal sale en
  su propio renglón, con **Sin lote** en la columna del lote y la caducidad
  vacía. Los lotes que ya se agotaron no aparecen.

Si a un producto le falta un costo o el precio, esa celda queda vacía en lugar
de contar como cero. Sin precio tampoco hay valor.

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
