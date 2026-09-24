---
title: Productos compuestos: recetas y kits
who: dueño
plan: Desde Pro
---

Un **producto compuesto** se arma con otros productos de tu catálogo. Puede ser
un **kit**, como una despensa con dos aguas, un aceite, un kilo de frijol y unas
galletas, o una **receta**, como una torta que lleva pan, jamón y queso.

El compuesto tiene su propio nombre y su propio precio, pero **no tiene
existencias propias**: cuando lo vendes, SellPointy descuenta del inventario
cada uno de sus componentes.

## Crear un producto compuesto

1. Da de alta el producto como cualquier otro (capítulo 16, «Productos»), con su
   nombre y su precio de venta.
2. Antes de guardar, marca **Se arma a partir de otros productos del catálogo**.
3. Presiona **Guardar**.
4. Abre el producto con **Ver** y elige la pestaña **Composición**, que solo
   aparece en los productos compuestos.
5. En **Buscar un producto para agregar como componente**, busca cada
   componente y agrégalo.
6. En cada renglón escribe la **Cantidad** que lleva **una** unidad del
   compuesto, en la unidad del componente: 2 piezas de agua, 1 kilogramo de
   frijol.
7. Presiona **Guardar composición**.

![La composición de la despensa](screen:composite-composition)

## Merma

La **Merma %** es lo que se pierde al preparar. Si una receta lleva 1 kg de un
ingrediente y se pierde el 10% al limpiarlo, escribe 10: cada venta descuenta
1.1 kg. En un kit, déjala en 0.

## El resumen

Debajo de la tabla, SellPointy te dice:

- **Costo estimado**: la suma del costo de los componentes, sin impuesto. Te
  sirve para ponerle un precio que deje utilidad.
- **Alcanza para**: cuántas unidades puedes armar con las existencias de hoy.
- **Limitado por**: el componente que se acabaría primero.

La pestaña **Stock por sucursal** de un compuesto también muestra cuántos se
pueden armar con lo que hay.

## Bueno saber

- Un compuesto puede llevar otro compuesto, pero no a sí mismo: si una relación
  forma un círculo, SellPointy no la guarda.
- Un producto que es componente de otro **no se puede eliminar** ni cambiar de
  unidad base. Quítalo primero de la composición.
- En la lista de productos, los compuestos llevan la etiqueta **Compuesto** y se
  pueden ver solos con **Solo compuestos**.
- En el plan Basic la casilla aparece apagada con el aviso «Los productos
  compuestos son de un plan superior».
