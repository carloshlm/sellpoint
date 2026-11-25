---
title: Compras con la factura del proveedor
who: dueño
plan: Desde Pro
---

Una **compra** es la factura de tu proveedor capturada en SellPointy: qué te
vendió, a qué costo y cuánto le debes. Registrarla te deja saber cuánto
compras, a quién y a qué precio, y cuando la mercancía llega a la sucursal, la
misma compra la mete al inventario sin volver a teclear nada.

Están en el menú **Compras › Compras**. Cada compra lleva su folio (`COM-000001`).

![El listado de compras](screen:purchases-list)

Arriba se filtran por folio, **Estado**, **Proveedor** y fechas, y se ve cuántas
compras hay y el total del rango. Los estados son:

| Estado | Qué significa |
|---|---|
| **Borrador** | La estás capturando. Todavía se puede cambiar todo. |
| **Confirmada** | La factura quedó sellada, pero la mercancía todavía no entra al inventario. |
| **En inventario** | La mercancía ya entró a la sucursal. |
| **Anulada** | Ya no cuenta. |

## Capturar la factura

1. Presiona **Nueva compra**.
2. Elige el **Proveedor**, la **Sucursal** a la que entra la mercancía y la
   **Fecha de la factura**. Presiona **Crear borrador**.
3. Anota la **Factura del proveedor** (su número) y, si ya la tienes, la
   **Fecha de recepción**.
4. En **Los costos de la factura**, di si los costos que vas a capturar **YA
   incluyen impuesto** o **NO incluyen impuesto**, como vengan en el papel. De
   entrada queda el ajuste de tu negocio.
5. En **Productos de la factura**, busca cada producto y escribe la
   **Presentación** (si lo buscaste por el código de una presentación que se
   compra, la línea ya trae esa), la **Cantidad**, el **Costo unitario** y, si hubo, el
   **Descuento**. Si el producto se controla por lote, escribe también el
   **Lote** y la **Caducidad**; la caducidad lleva el año completo, entre 2000
   y 2099, y no puede ser de antes de hoy, porque no se compra mercancía
   caducada. Cada línea lleva el impuesto de su producto,
   el mismo con el que se vende: una medicina al IVA 0% no suma IVA. Si el
   producto no tiene uno, lleva el predeterminado del negocio.
6. Si la factura trae flete, maniobras o seguro, agrégalos en **Cargos
   adicionales**. Suman al total, pero no cambian el costo de los productos.
7. Si quieres, escribe el **Total que dice la factura**.
8. Presiona **Confirmar compra** y confirma en el aviso.

![Una compra nueva](screen:purchase-new)

**Comprar a granel en kilos o en gramos.** Si la línea va en la presentación
base del producto (el queso en **Kilogramo**, la que se creó con él), junto a la
**Cantidad** hay dos botones: **kg** y **g**. Con **kg** escribes kilos (**2.5**);
con **g** escribes gramos (**600**), y la compra los guarda en kilos: 0.6. Si ya
había una cantidad y tocas el otro botón, la cantidad no cambia: se vuelve a
escribir en la unidad nueva, y 5 kg se ven como 5000 g. Si no se puede escribir
en la otra unidad, el campo queda vacío y en gris dice la cantidad, que sigue
igual. SellPointy recuerda en esa computadora la unidad que elegiste. Igual con
litros y mililitros (**L** y **ml**), metros y centímetros (**m** y **cm**) o
libras y onzas (**lb** y **oz**). En gramos, la cantidad mínima es 0.1 g. En un
empaque, como **Bolsa 10 Kg**, no hay botones: la cantidad son bolsas. Tampoco en
una **Bolsa 1 Kg** que diste de alta aparte: aunque vale un kilo, es un empaque.

Bajo el costo, cada línea dice de qué unidad es: **Costo por kilogramo** en la
unidad base, o **Costo por Bolsa 10 Kg** si compraste el empaque. Así 600 g con
un costo por kilo no se confunden: el costo sigue siendo el de un kilo.

Al agregar un producto, SellPointy te recuerda el último costo al que se lo
compraste a ese proveedor. Si escribiste el **Total que dice la factura** y no
cuadra con la suma de las líneas, te avisa con la diferencia; la compra se puede
confirmar igual, para que registres el papel tal como es.

Al confirmar, las líneas y los importes quedan sellados. Después solo se pueden
anotar la fecha de recepción, el número de factura y las notas.

## Meter la mercancía al inventario

**Confirmar la compra no mete la mercancía al inventario.** La factura puede
llegar antes que la mercancía, o la mercancía antes que la factura. Por eso la
entrada al inventario es un paso aparte, que das cuando la mercancía ya está en
la sucursal:

1. Abre la compra confirmada y presiona **Ingresar al inventario**.
2. SellPointy crea una **Entrada** en borrador en la sucursal de la compra, con
   el motivo **Factura de compra**, el número de factura como referencia y las
   mismas líneas, cantidades y costos. El motivo y la sucursal los fija la
   compra y no se cambian.
3. Revisa que lo que llegó coincida. Si el producto se controla por lote, revisa
   el lote y la caducidad.
4. Presiona **Confirmar** en la entrada.

![Una compra confirmada, lista para entrar al inventario](screen:purchase-to-inventory)

Al confirmar la entrada, la mercancía suma en la sucursal, el costo de cada
producto en tu catálogo se actualiza con el de la factura y la compra pasa a
**En inventario**. Si dejaste la entrada a medias, el botón de la compra cambia a
**Continuar** con el folio de la entrada.

Para hacer este paso hace falta, además del permiso de compras, el de registrar
movimientos de inventario (capítulo 23, «Entradas y salidas»).

## Anular una compra

**Anular compra** pide un motivo, que queda en el historial. Si ya habías
abierto su entrada en borrador, también se anula.

Una compra cuya mercancía **ya entró** al inventario no se puede anular. Si hay
que devolver algo, registra una **Salida** (capítulo 23, «Entradas y salidas»).

**Imprimir** baja la compra en PDF, para archivarla junto a la factura.
