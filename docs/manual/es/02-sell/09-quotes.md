---
title: Cotizaciones
who: cajero
plan: Desde Pro
---

Una **cotización** contesta «¿cuánto me sale?» sin cobrar: es una lista con
folio, como COT-000002, que el cliente se lleva impresa y con la que regresa a
comprar. No descuenta inventario, no aparta mercancía y no necesita un turno
abierto.

Las cotizaciones vienen desde el plan Pro. En el plan Basic, **Cotización**
aparece en el menú con un candado.

## Hacer una cotización

1. En el menú, entra a **Cotización** y presiona **Nueva cotización**.
2. Revisa la **Sucursal**: los precios y la disponibilidad se calculan desde
   ahí. La que tienes asignada ya viene elegida. Si no te aparece ninguna, pide
   a quien administra el negocio que te dé acceso a una.
3. Agrega los productos y servicios igual que en una venta: con el lector, el
   código o el nombre, con sus cantidades y presentaciones (capítulo 6).
4. Si quieres, escribe una **Nota (opcional)** que saldrá en el papel, como
   «Para la fiesta del sábado. Llamar antes de enviar.».
5. Presiona **Generar cotización**.

![Una cotización antes de generarla: dos cajas de agua y el envío](screen:quote-new)

Aparece **Cotización COT-000003 generada.** y el papel se imprime solo, igual
que el ticket; el botón **Imprimir ticket** lo repite.

## El papel de la cotización

Se parece a un ticket, pero arriba dice **COTIZACIÓN**, lleva tu nota y abajo
aclara **Precios de referencia. El precio final se calcula en caja al momento
de la compra.** Su código de barras es el del folio: al escanearlo en la caja,
la cotización se abre para cobrarla (lo ves más abajo).

![El papel de la cotización COT-000002](screen:quote-paper)

## Las cotizaciones del negocio

En **Cotización** ves todas las cotizaciones del negocio, de la más reciente a
la más antigua, con quién la hizo (**Cotizó**) y su total cuando se cotizó
(**Referencia**).

![Las cotizaciones: una vigente y una que ya se cobró](screen:quotes-list)

| Estado | Qué significa |
|---|---|
| **Vigente** | Todavía se puede cobrar. No vence: sigue vigente hasta que se cobra o se cancela. |
| **Ya cargada en una venta** | Ya se cobró. No se puede usar otra vez. |
| **Cancelada** | Se dio de baja. |

- Para buscar una, escribe su **Folio** o solo una parte, o filtra por
  **Estado** y por fechas (**Desde**, **Hasta**).
- **Reimprimir** saca otra vez el papel, en cualquier estado.
- **Cancelar** da de baja una cotización **Vigente**. Cuidado: **no pide
  confirmación**, se cancela en cuanto lo presionas.

## Cobrar una cotización

Cuando el cliente regresa con su papel:

1. Con tu turno abierto, entra a **Venta**.
2. Escanea el código de barras del papel, o escribe el folio completo
   (COT-000002) en el campo de búsqueda.
3. Se abre **Cargar la cotización COT-000002** con sus renglones. Revísalos con
   el cliente.
4. Presiona **Cargar al carrito** y cobra como cualquier venta (capítulo 6).

![La cotización lista para pasar al carrito](screen:quote-load)

Al cobrarla, la cotización queda como **Ya cargada en una venta**. Antes de
cobrar puedes cambiar cantidades, quitar renglones o agregar otras cosas.

- **Se cobra el precio de hoy.** La cotización no congela precios: si uno
  cambió, verás el del papel tachado y **precio actualizado** junto al nuevo.
- **La disponibilidad es la de tu sucursal**, que puede no ser donde se cotizó.
  Un renglón que ya no se vende en tu sucursal dice **Ya no se vende desde esta
  sucursal** y no pasa al carrito; si no alcanza el inventario, el renglón dice
  cuánto falta.
- Si el folio ya se cobró o se canceló, aparece **Esa cotización ya se usó o se
  canceló.**
