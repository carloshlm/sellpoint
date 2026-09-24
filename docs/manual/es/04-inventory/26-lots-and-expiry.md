---
title: Lotes y próximos a vencer
who: dueño
plan: En Plus
---

Si vendes cosas que caducan —leche, medicinas, alimentos—, SellPointy puede
llevar cada **lote** por separado: con su código y su fecha de caducidad. Así
sabes qué partida tienes, cuál vence primero y cuál ya no puedes vender.

## Encender los lotes en un producto

En la ficha del producto, pestaña **Información**, marca **Este producto se
controla por lote y caducidad** y guarda. Solo actívalo en los productos que de
verdad traen lote; en los demás déjalo apagado.

Una vez que un producto tiene existencias repartidas en lotes, la casilla ya no
se puede desmarcar: primero hay que sacar o vender esas existencias.

Encender los lotes es del plan Plus. En Basic y Pro la casilla aparece apagada
con el aviso «El control por lote y caducidad es de un plan superior». Lo mismo
pasa al importar productos (capítulo 20): una fila con SI en `controla_lotes` se
marca con error si el producto es nuevo o todavía no llevaba lote.

## Qué cambia al encenderlos

- **Al recibir mercancía**, la entrada te pide el **Lote** y su **Caducidad** en
  cada línea (capítulo 23, «Entradas y salidas»). Lo mismo al recibir una
  orden de compra (capítulo 29, «Órdenes de compra y recepciones»).
- **Al vender o dar salida**, SellPointy descuenta primero el lote que vence
  antes. No tienes que elegirlo: la salida te muestra de qué lote va a salir.
- **Lo vencido no se vende.** El punto de venta no toma piezas de un lote
  vencido. Para sacarlas del inventario, dales salida con motivo **Caducado**.

## Dónde ver tus lotes

En la ficha del producto, la pestaña **Stock por sucursal** muestra los lotes de
cada sucursal con su cantidad y su caducidad.

![Los lotes de un producto, por sucursal](screen:lots-stock)

- **Se descuenta primero** marca el lote que va a salir en la próxima venta.
- **Vence pronto** avisa que la caducidad está cerca.
- **Editar lote** corrige el código o la caducidad si se capturaron mal. Cuidado:
  la caducidad decide qué lote sale primero, así que cambiarla puede cambiar de
  qué partida sale la próxima venta.

## Próximos a vencer

En **Movimientos › Próximos a vencer** ves, de todas tus sucursales, los lotes
que están por caducar, del más próximo al más lejano.

![Los lotes que vencen en los próximos 90 días](screen:expiring-soon)

Arriba eliges el plazo: **7 días**, **30 días** (el que se abre) o **90 días**.
**Vencidos** muestra solo lo que ya caducó y sigue en tus sucursales.
**Exportar Excel** baja la lista del plazo que estás viendo.

### Dar salida a lo caducado

1. En el renglón del lote, presiona **Dar salida por caducado**.
2. Se abre una **Salida** en borrador en la sucursal del lote, con el motivo
   **Caducado**, el producto, el lote y toda su cantidad ya cargados. La nota
   trae el lote y su fecha.
3. Ajusta la cantidad si no vas a sacar todo y presiona **Confirmar**.

Si un lote todavía se puede vender, no hace falta hacer nada: ponlo al frente
del anaquel o en promoción, y el punto de venta lo irá descontando primero.

## Si pasas de Plus a Pro

Los productos que ya llevan lote lo conservan. Sus entradas siguen pidiendo
**Lote** y **Caducidad**, las ventas siguen descontando primero el lote que vence
antes y la pestaña **Stock por sucursal** sigue mostrando sus lotes.

Lo que cambia:

- Ya no puedes encender los lotes en otro producto.
- En la ficha de un producto con lote, la casilla sigue marcada con el aviso
  «Este producto conserva su control por lote. Si lo apagas, volver a
  encenderlo es de un plan superior». Puedes apagarla (si ya no le quedan
  existencias en lotes), pero volver a encenderla pide Plus.
- Corregir un lote es de Plus: en **Stock por sucursal**, **Editar lote**
  aparece apagado y, debajo de la tabla, el aviso «Corregir el código o la
  caducidad de un lote es de un plan superior».
- **Próximos a vencer** aparece con candado.
- Si vuelves a subir tu plantilla de productos, el SI de los que ya llevan lote
  no marca error.
