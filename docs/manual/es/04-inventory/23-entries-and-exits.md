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
   nombre, y presiona **Agregar**. Repite con cada producto.
5. En cada línea elige la **Presentación** (por ejemplo, «Caja con 12») y escribe
   la **Cantidad**. Debajo ves a cuántas piezas equivale. Si el motivo lo pide,
   escribe el **Costo unitario**.
6. Presiona **Confirmar** y, en el aviso, confirma de nuevo.

Lo que escribes se guarda solo mientras lo capturas. Si algo falta, la pantalla
marca la línea y no deja confirmar hasta que lo corrijas.

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
«Lotes y próximos a vencer»).

## Lo que ya no se puede cambiar

Un documento confirmado es historia: **ya no se edita ni se borra**.

![Una salida confirmada](screen:exit-confirmed)

Si te equivocaste, registra un documento nuevo que lo corrija. Por ejemplo, si
diste salida a 5 piezas y eran 3, registra una **Entrada** con motivo **Ajuste**
por 2 y explícalo en la nota. Así el kardex cuenta lo que pasó de verdad.

Lo que sí puedes hacer con un documento confirmado es **Imprimir**: baja un PDF
con sus líneas.

Un **Borrador** que ya no necesitas se **Anula**. El folio queda anulado y no se
vuelve a usar, y sus líneas se pierden.
