---
title: Entradas y salidas
who: dueño
plan: Desde Pro
---

Las ventas descuentan el inventario solas. Todo lo demás que entra o sale de una
sucursal se registra con un documento: una **Entrada** cuando llega mercancía
(una compra, una devolución, un ajuste) y una **Salida** cuando se va sin
venderse (una merma, un consumo interno, un traspaso a otra sucursal).

Las dos pantallas están en el menú **Movimientos**: **Entradas** y **Salidas**.
Funcionan igual.

![El listado de salidas](screen:exits-list)

Cada documento tiene un folio propio: `ENT-000001` para las entradas y
`SAL-000001` para las salidas. El listado se puede filtrar por folio, por
**Sucursal** y por fechas, y los botones **Activos**, **Borradores**,
**Confirmados** y **Cancelados** filtran por estado.

## Cómo se registra

Un documento nace como **Borrador**: puedes irlo llenando con calma, y nada se
mueve en el inventario hasta que lo confirmas.

1. En **Sucursal**, elige dónde entra o de dónde sale la mercancía.
2. Presiona **Crear**. El documento toma su folio y se abre.
3. Elige el **Motivo** (los ves en la tabla de abajo). Según el motivo, la
   pantalla te pide una **Referencia**, una **Nota** o la **Sucursal destino**.
4. En **Buscar producto**, escanea el código de barras o teclea el SKU o el
   nombre, y presiona **Agregar**. Repite con cada producto. Si el código es el
   de una presentación (su código de barras o su código interno), la línea
   entra ya con ella: escanear la bolsa de 10 kg agrega la bolsa, no el kilo.
   Si el producto tiene varias presentaciones, cada resultado las muestra como
   botones, por ejemplo **Kilogramo**, **Bolsa 1 Kg** y **Bolsa 10 Kg**:
   presiona la que llegó y la línea entra con ella. También llegas a esos
   botones con la tecla Tab y los eliges con Enter.
5. En cada línea revisa la **Presentación** (por ejemplo, «Caja con 12») y
   escribe la **Cantidad**. Debajo ves a cuántas piezas equivale. Si el motivo lo pide,
   escribe el **Costo unitario**.
6. Presiona **Confirmar** y, en el aviso, confirma de nuevo.

Lo que escribes se guarda solo mientras lo capturas. Si algo falta, la pantalla
marca la línea y no deja confirmar hasta que lo corrijas.

Si agregas otra vez la misma presentación del mismo producto (y del mismo lote),
la cantidad se suma en su línea en vez de abrir una nueva.

## El mismo producto en varias presentaciones

Un producto a granel puede llegar en empaques y suelto a la vez. Por ejemplo,
tienes 2.500 kg de queso y llegan 2 bolsas de 1 kg, 1 bolsa de 10 kg y 600 g
sueltos. Cada presentación va en su propia línea:

1. Busca el queso y presiona **Bolsa 1 Kg**. En la cantidad escribe **2**.
2. Búscalo otra vez y presiona **Bolsa 10 Kg**. Escribe **1**.
3. Búscalo otra vez y presiona **Kilogramo**. Junto a la cantidad hay dos
   botones, **kg** y **g**: presiona **g** y escribe **600**. Debajo dice
   **600 g = 0.600 kilogramos**.

Bajo la última línea del queso aparece su resumen, con lo que suman las tres
líneas y en qué queda el inventario:

**Queso Oaxaca · 3 renglones · +12.600 kilogramos · existencias 2.500 → 15.100 kilogramos**

En una salida, el resumen lleva el signo de menos: lo que sale se resta.

Los botones **kg** y **g** aparecen solo en las líneas de la presentación base
del producto, la que se creó con él, como **Kilogramo**. La **Bolsa 1 Kg** también
vale un kilo, pero es un empaque: ahí no hay botones y la cantidad son bolsas. Con
**g** escribes los gramos, con hasta un decimal (la cantidad mínima es 0.1 g), y
SellPointy guarda la línea en kilos. Si ya escribiste una cantidad y cambias de
botón, la cantidad no cambia: se reescribe en la otra unidad, y 600 g pasan a
0.6 kg. Si no se puede escribir en la otra unidad, el campo queda vacío y en gris
dice la cantidad, que sigue igual. SellPointy recuerda en esa computadora la
unidad que elegiste, así que revisa el botón antes de escribir. Igual con litros
y mililitros (**L** y **ml**), metros y centímetros (**m** y **cm**) o libras y
onzas (**lb** y **oz**). En un empaque, como **Bolsa 10 Kg**, no hay botones: la
cantidad son bolsas.

En una salida, cada línea te dice cuánto hay disponible en la sucursal. Una
salida no puede sacar más de lo que hay: si lo intentas, SellPointy te dice
cuánto hay y cuánto pides.

## Los motivos

| Motivo | Va en | Qué te pide |
|---|---|---|
| **Factura de compra** | Entrada | Referencia (el número de la factura) y el costo unitario de cada línea |
| **Ajuste** | Entrada y salida | Una nota que explique por qué |
| **Devolución de cliente** | Entrada | Una nota |
| **Traspaso** | Salida | La sucursal destino (capítulo 24, «Traspasos entre sucursales») |
| **Merma o pérdida** | Salida | Una nota: qué se perdió y por qué |
| **Consumo interno** | Salida | El área o concepto: limpieza, producción, mantenimiento… |
| **Caducado** | Salida | Una nota |

En **Ajuste**, **Merma o pérdida** y **Caducado** aparece además el campo
**Autoriza**, para anotar quién dio el visto bueno. Es opcional.

Al confirmar una entrada con **Factura de compra**, el costo que escribiste pasa
a ser el costo del producto en tu catálogo.

Si el producto se controla por lote, la entrada te pide el **Lote** y su
**Caducidad**, y la salida elige sola el lote que vence primero (capítulo 26,
«Lotes y próximos a vencer»). En una entrada, la caducidad lleva el año
completo, entre 2000 y 2099, y no puede ser de antes de hoy: SellPointy no da
entrada a mercancía caducada, ni al capturar la línea ni al confirmar.

## Lo que ya no se puede cambiar

Un documento confirmado es historia: **ya no se edita ni se borra**.

![Una salida confirmada](screen:exit-confirmed)

Si te equivocaste, registra un documento nuevo que lo corrija. Por ejemplo, si
diste salida a 5 piezas y eran 3, registra una **Entrada** con motivo **Ajuste**
por 2 y explícalo en la nota. Así el kardex cuenta lo que pasó de verdad.

Lo que sí puedes hacer con un documento confirmado es llevarte su papel, con sus
líneas: **Imprimir** abre el cuadro de impresión de tu navegador, y **Guardar
como PDF** baja el archivo con el folio por nombre, como `SAL-000003.pdf`.
**Descargar Excel** baja las mismas líneas en una hoja de cálculo, con las
cantidades como números para que puedas sumarlas: `SAL-000003.xlsx`.

Un **Borrador** que ya no necesitas se **Anula**. El folio queda anulado y no se
vuelve a usar, y sus líneas se pierden.
