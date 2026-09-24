---
title: Órdenes de compra y recepciones
who: dueño
plan: En Plus
---

Una **orden de compra** es el pedido que le haces a tu proveedor antes de que
llegue la factura: qué le pides, cuánto y a qué costo acordado. Sirve cuando el
proveedor surte por partes. Anotas cada entrega que llega (una **recepción**), la
orden lleva la cuenta de lo que falta y, cuando llega la factura, la compra nace
de lo que de verdad recibiste.

## Encenderlas

Las órdenes de compra son del plan Plus y cada negocio decide si las usa. Se
encienden en **Mi perfil › Datos del negocio** con el interruptor **Usar órdenes
de compra** (capítulo 12, «Datos del negocio y el ticket»). Al encenderlo
aparece **Órdenes de compra** en el menú **Compras**. Apagado, una compra es solo
la factura (capítulo 28, «Compras con la factura del proveedor»).

## Hacer el pedido

1. En **Compras › Órdenes de compra**, presiona **Nueva orden**.
2. Elige el **Proveedor**, la **Sucursal** donde se va a recibir, la **Fecha del
   pedido** y, si la sabes, la **Entrega esperada**. Presiona **Crear borrador**.
3. En **Productos del pedido**, agrega cada producto con su **Presentación**, la
   **Cantidad** y el **Costo acordado**. Si quieres, anota la **Referencia del
   proveedor**, las **Condiciones de pago** y **Notas**.
4. Presiona **Emitir orden** y confirma.

Al emitirla, los productos y los costos acordados quedan fijos. Cada orden lleva
su folio (`OCO-000001`), y con **Imprimir** bajas el PDF para mandárselo al
proveedor.
La entrega esperada, la referencia, las condiciones y las notas se pueden seguir
cambiando.

En el listado, la columna **Recibido** muestra cuánto de cada orden ya llegó, y
una orden cuya entrega esperada ya pasó se marca **Vencida**.

![El listado de órdenes de compra](screen:purchase-orders-list)

## Registrar lo que llega

Cada vez que llega mercancía de la orden:

1. Abre la orden y presiona **Registrar recepción**.
2. La recepción nace con lo que falta de cada producto. Deja en **Llegó** lo que
   de verdad llegó: ajusta lo incompleto y quita lo que no vino. Si el producto
   se controla por lote, escribe el **Lote** y la **Caducidad**.
3. Si la mercancía trae **Remisión o packing slip**, anota su número para
   cotejarlo después con la factura.
4. Presiona **Confirmar recepción**.

![Una recepción: lo que llegó de la orden](screen:purchase-receipt)

La recepción toma su folio (`RCP-000001`) y lo recibido se suma a la orden, que
pasa a **Parcialmente recibida** o a **Recibida**. No se puede recibir más de lo
que falta: si el proveedor mandó de más, recibe lo pendiente y anota el resto en
las notas.

![Lo pedido contra lo recibido](screen:purchase-order-received)

> **La recepción todavía no mete la mercancía al inventario.** Entra cuando
> registras la compra de lo recibido y confirmas su entrada, en la siguiente
> sección.

## Cuando llega la factura

1. En la orden, presiona **Registrar compra de lo recibido**.
2. Marca las recepciones que cubre la factura y presiona **Crear la compra**.
3. Se abre una compra en borrador con las cantidades recibidas y el costo
   acordado. Encima captura lo que dice la factura: su número, los costos si
   cambiaron, y confírmala.
4. Presiona **Ingresar al inventario** y confirma la entrada, igual que en el
   capítulo 28, «Compras con la factura del proveedor».

![Elegir las recepciones que cubre la factura](screen:purchase-order-invoice)

Si la factura cobra más de lo que se recibió, la compra te avisa; se puede
confirmar igual. En la orden, cada recepción dice si ya está **Facturada** y en
qué compra, o si sigue **Sin factura**, y abajo se listan las compras de esa
orden.

## Cerrar o anular una orden

- **Cerrar con faltante**, en una línea, dice que el proveedor ya no va a surtir
  lo que falta de ese producto.
- **Cerrar orden** hace lo mismo con todas las líneas que tengan pendiente. Una
  orden con una recepción en borrador no se cierra: termínala o anúlala antes.
- **Anular orden** solo se puede mientras no haya llegado nada. Con mercancía
  recibida, la orden se cierra, no se anula.

Una recepción confirmada se puede **Anular** mientras no esté facturada: lo que
había llegado vuelve a quedar pendiente en la orden.
