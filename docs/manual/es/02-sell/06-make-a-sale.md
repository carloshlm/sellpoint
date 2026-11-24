---
title: Hacer una venta
who: cajero
---

Con tu turno abierto (capítulo 5), entra a **Venta**. La pantalla tiene dos
lados: a la izquierda buscas lo que el cliente se lleva; a la derecha se arma el
**carrito**, con el total a la vista y el botón **Cobrar**.

![La pantalla de venta: la búsqueda a la izquierda y el carrito a la derecha](screen:sale-screen)

## Agregar lo que se lleva

Todo entra por un solo campo, el que dice **Escanea, teclea el código, el
nombre o un folio COT-…** (si no cabe completo, como en un celular, dice
**Código, nombre o folio COT-…**):

- **Con el lector de código de barras.** Haz clic en el campo y escanea. El
  campo queda limpio al instante, así que puedes escanear uno tras otro sin
  esperar: cada producto entra solo al carrito, en el orden en que lo
  escaneaste. Mientras alguno se está agregando, abajo del campo dice
  **Agregando al carrito…** y **Cobrar** espera a que termine. Escanear otra
  vez el mismo código suma uno a la cantidad.
- **Un código que no entra solo** (no existe o coincide con varias cosas) se
  queda en el campo, seleccionado, con lo que se encontró para que elijas; si
  no hay nada, lo dice. Escanear el siguiente lo reemplaza. Si para entonces ya
  estabas escaneando el siguiente, el campo no se toca: aparece un aviso, por
  ejemplo **No se agregó: 7501234567890**, para que lo busques después. La
  **×** lo cierra.
- **Con el código o el nombre.** El código interno completo (por ejemplo,
  AGUA-1L) también entra solo, al dejar de escribir o al presionar Enter. Con
  parte del nombre, de dos letras en adelante, aparece una lista: presiona lo
  que se lleva. Cada resultado dice su precio y, en los productos, cuántos hay
  en tu sucursal.
- **Servicios**, como el envío a domicilio o la recarga de garrafón, se buscan
  igual. Solo salen los que se ofrecen en tu sucursal.
- **Una cotización** que el cliente trae impresa se carga con su folio
  (capítulo 9).

En un celular o una tableta aparece además **Escanear con la cámara**: coloca
el código horizontal, sobre la línea roja.

## Cantidades y presentaciones

Cada renglón del carrito muestra el producto, la cantidad, el importe y una
**×** para quitarlo.

- **Presentación.** Si un producto se vende de varias formas, como el agua por
  pieza o en **Caja con 12**, su renglón trae una lista para elegirla, y el
  precio cambia con ella. Si la caja tiene su propio código de barras o código
  interno, al escanearla o teclearlo entra ya como caja.
- **Cambiar la cantidad.** Toca el renglón y se abre un teclado en la pantalla.
  Los números se agregan a la derecha: para cambiar 1 por 3, primero borra el 1
  con **⌫** (en los productos por pieza, **C** borra todo). También puedes
  usar el teclado de tu computadora. Si escaneas otro producto con el teclado
  abierto, el teclado pasa a ese producto: lo que escribas cambia su cantidad.
  Para cerrarlo, presiona **Ocultar teclado**.
- **Venta por peso.** En lo que se vende por kilo, como el queso o el frijol a
  granel, el teclado trae punto decimal: escribe **1.5** para kilo y medio o
  **0.350** para 350 gramos. En lo que se vende por pieza, y en los servicios,
  solo van números enteros.
- **Vaciar el carrito.** **Vaciar carrito** quita todos los productos de una
  vez. Te pide confirmarlo antes de quitarlos.

![Kilo y medio de frijol, tecleado en la pantalla](screen:sale-weight)

El carrito se guarda en tu navegador mientras tu turno está abierto. Si recargas
la página o se cierra la pestaña, al volver a **Venta** los productos siguen
ahí. Se vacía al cobrar, al presionar **Vaciar carrito** o al cerrar el turno.
Si otra persona entra con su cuenta en la misma computadora, no ve tu carrito.

## Si no hay existencias

- Un producto sin existencias en tu sucursal **no aparece** al buscarlo: dice
  **No encontramos nada que se pueda vender desde esta sucursal.**
- Si pides más de lo que hay, el renglón se marca con **Más de lo que hay en
  esta sucursal**. Puedes seguir: quien decide es el cobro.
- Al cobrar, si el inventario no alcanza, la venta no se cobra: aparece **No
  hay suficiente existencia de…**, con el código del producto y cuánto hay, y
  su renglón dice **El servidor rechazó esta línea**. Corrige la cantidad o
  quita el renglón, y cobra de nuevo.

![Diez frascos de café cuando en la sucursal hay seis](screen:sale-no-stock)

Nada de esto frena la venta si el negocio encendió **Vender sin existencias**,
ni en el plan Basic, que no lleva control de inventario (capítulo 12). Y si no
ves cuántos hay, es que el negocio apagó **Mostrar existencias en el punto de
venta**: la regla para cobrar es la misma.

## Si un producto no tiene precio

Lo que no tiene precio de venta no se cobra: cobrarlo en $0.00 sería regalarlo.
Lo ves desde que lo buscas: en la lista y en su renglón del carrito dice **Sin
precio** en lugar del importe. Si aun así presionas **Cobrar**, aparece, por
ejemplo, **«Bistec» (Bolsa 10 kg) no tiene precio de venta. Ponle precio en
Productos para venderlo.**, y su renglón dice **El servidor rechazó esta
línea**. Quita el renglón o pide a quien administra el catálogo que le ponga
precio (capítulo 16), y cobra de nuevo. Una cotización tampoco lo acepta.

## Cobrar

1. Presiona **Cobrar**. El cobro ocupa el lado izquierdo y el carrito sigue a la
   vista a la derecha. Bajo el título, en letra chica, dice cuántas filas,
   unidades y servicios lleva la venta, por ejemplo **Filas: 4 · Unidades: 6 ·
   Servicios: 2**: cada pieza o caja cuenta una, lo que se vende a granel
   cuenta una por renglón, y los servicios van aparte (capítulo 12).
2. Si hay descuento, aplícalo (siguiente sección).
3. En **Cómo paga**, elige **Efectivo**, **Tarjeta** o **Transferencia**.
4. Con **Efectivo**, escribe en **Con cuánto paga** el dinero que te dio el
   cliente y SellPointy calcula el **Cambio**; mientras no alcance, dice cuánto
   falta y no deja cobrar. Lo que escribas se guarda con la venta: el ticket
   lo imprime como **Recibido**, junto con el **Cambio**, también cuando lo
   reimprimes (capítulo 7). Con **Tarjeta** o **Transferencia** no pide nada
   más: se cobra el total exacto.
5. Presiona **Cobrar**.

Aparece en verde **Venta VTA-000483 cobrada.**, el ticket sale a imprimir
(capítulo 7) y el carrito queda vacío. Si presionaste **Cobrar** dos veces sin
querer, la venta se cobra una sola vez. **Cancelar** te regresa a la búsqueda
sin perder el carrito. Sin internet no se puede cobrar: un aviso arriba de la
pantalla lo dice, y hay que esperar a que vuelva la conexión.

![El cobro de $243.50 con un descuento autorizado: paga con $300](screen:sale-checkout)

## Descuentos

**Aplicar descuento** aparece en el cobro solo si el negocio definió un código
de autorización (capítulo 14).

1. Presiona **Aplicar descuento**.
2. En **Descuento**, escribe cuánto dinero se descuenta del ticket completo (es
   un importe, no un porcentaje).
3. Escribe el **Código de autorización**, o pide que lo escriba quien lo
   conoce. Se ve con puntos.
4. Si quieres, anota el **Motivo (opcional)**, por ejemplo «Cliente frecuente».

El cobro muestra el **Subtotal**, el **Descuento** y el **Total** nuevo. Si el
negocio fijó un tope, debajo lo dice (por ejemplo, **Tope del negocio: 15 % del
subtotal**) y no acepta más.
**Quitar descuento** lo deshace. El código se revisa al cobrar: si no es el
correcto, dice **El código de autorización no es correcto.**, y después de
cinco intentos fallidos los descuentos se te bloquean 15 minutos.
