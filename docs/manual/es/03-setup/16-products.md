---
title: Productos
who: dueño
---

Un **producto** es todo lo que vendes y que ocupa lugar en tu anaquel: el agua,
el queso, el aceite. Tus productos están en el menú de la izquierda, en
**Catálogos › Productos**. Arriba de la lista tienes tres maneras de darlos de
alta: **Nuevo producto**, uno por uno; **Carga rápida**, con el lector de código
de barras; e **Importar**, con una hoja de Excel (capítulo 20).

![La lista de productos](screen:products-list)

En **Buscar** puedes escribir el código, el nombre o el código de barras. Con
**Solo compuestos** ves solo los que se arman con otros productos (capítulo 17).
Para abrir un producto, presiona **Ver** en su renglón.

## Dar de alta un producto

1. Presiona **Nuevo producto**.
2. Captura los códigos. Necesitas **al menos uno** de los dos:
   - **Código de barras**: el que viene impreso en el empaque. Si tienes lector,
     escanea el producto: SellPointy busca el código en tu catálogo y en un
     catálogo público de productos, y si lo encuentra te sugiere el nombre.
   - **Código interno**: la clave que usa tu negocio, como «AGUA-1L». Si lo
     dejas vacío, se usa el código de barras.
3. Escribe el **Nombre** como lo vas a buscar en la caja: marca, producto y
   tamaño. «Agua natural 1 L» y «Agua natural 600 ml» son dos productos.
4. Elige la **Unidad base**: **Pieza** para lo que se cuenta, o una unidad de
   peso, volumen o longitud (kilogramo, litro, metro…) para lo que se mide.
5. En **Impuesto, costo y precio**, captura el **Costo** y el **Precio de
   venta**. Las etiquetas te dicen si van con el impuesto incluido o sin él,
   según lo que elegiste en el capítulo 13, «Impuestos». Debajo del precio ves
   cómo quedará en el ticket.
6. Si quieres un aviso cuando se esté acabando, pon un **Stock mínimo**: cuando
   las existencias bajen de ahí, el producto aparece como «bajo mínimo».
7. Presiona **Guardar**.

![El formulario de un producto nuevo](screen:product-form)

El costo es opcional: vacío significa «todavía no lo sé», y cero significa «me
cuesta $0». Con él, SellPointy calcula tu utilidad.

Más abajo en el mismo formulario hay otros datos que aparecen solo si los usas:

- **Ubicación en la sucursal**, como «Pasillo 3», si encendiste **Usar
  ubicaciones de sucursal** en tus datos del negocio (capítulo 12).
- Los **campos propios** que agregaste al catálogo de productos (capítulo 21).
- **Este producto se controla por lote y caducidad**, para medicinas y
  alimentos (capítulo 26, «Lotes y próximos a vencer»). Encenderla es del plan
  Plus: en Basic y Pro aparece apagada con el aviso «El control por lote y
  caducidad es de un plan superior». Un producto que ya la tenía encendida la
  conserva aunque cambies de plan (capítulo 26 explica qué sigue igual).
- **Se arma a partir de otros productos del catálogo** (capítulo 17).

## Venta por peso

Si la unidad base es de peso, como **Kilogramo**, en la caja se puede cobrar
una cantidad con decimales, como 0.750 kg de queso. Un producto en **Pieza** se
vende solo en enteros: media pieza no existe.

## Presentaciones: la caja, el paquete, la porción

Un producto puede venderse de varias formas. El agua se vende suelta y también
en caja con 12; el queso, por kilo y también en porción de 250 g. Cada forma es
una **presentación**, con su propio código de barras y su propio precio.

Todo producto nace con una presentación, la de su unidad base (en el agua, la
**Pieza**). Para agregar otra:

1. Abre el producto con **Ver** y elige la pestaña **Presentaciones**.
2. Presiona **Agregar presentación**.
3. Escribe el **Nombre** («Caja con 12»), la **Equivalencia** en la unidad base
   (12 piezas; para una porción de queso, 0.25 kg), y si quieres su **Código de
   barras** y su **Precio**.
4. Presiona **Agregar**.

![Las presentaciones del agua](screen:product-presentations)

En la tabla decides, para cada presentación, si **Se compra**, si **Se vende**,
cuál es la **Predeterminada** para vender y si va en **Solo enteros** (sin
decimales en la caja). Estas casillas se guardan al marcarlas.

## Carga rápida: escanear y dar de alta

Si tienes muchos productos con código de barras del fabricante, **Carga rápida**
es lo más rápido: escaneas, escribes el precio y sigues con el siguiente.

1. Presiona **Carga rápida**.
2. Escanea un código (o tecléalo y presiona Enter). Cada código agrega una línea.
3. Revisa el nombre. La etiqueta de cada línea te dice qué pasó: **Nombre
   sugerido** si lo encontramos, **Escribe el nombre** si el código es nuevo,
   **Ya lo tienes** si el producto ya está en tu catálogo.
4. Escribe el **Precio de venta**. Enter te regresa al código de barras para el
   siguiente.
5. Al terminar, presiona **Dar de alta** y confirma.

![Carga rápida, con un producto nuevo y uno que ya existe](screen:products-quick)

Los códigos nuevos se crean como productos; a los que ya tienes **solo se les
cambia el precio de venta**. Caben hasta 100 líneas por vez, y puedes volver
cuando quieras a seguir con los demás.

## Cambiar, desactivar o eliminar

Abre el producto con **Ver**. En la pestaña **Información** cambias sus datos y
presionas **Guardar**.

- El **Código de barras** aparece bloqueado, para que un escaneo accidental no lo
  cambie. Si de verdad necesitas corregirlo, presiona **Cambiar**.
- La **Unidad base** ya no se puede cambiar cuando el producto tiene existencias,
  movimientos o forma parte de un producto compuesto.
- **Desactivar** lo deja de ofrecer sin perder su historia. Primero sus
  existencias tienen que estar en cero en todas las sucursales.
- **Eliminar** lo borra para siempre, con sus presentaciones. Solo se puede si
  nunca tuvo movimientos de inventario y no es parte de otro producto.
