---
title: Inventario físico: el conteo
who: dueño
plan: Desde Pro
---

Por más cuidado que tengas, lo que dice el sistema y lo que hay en el estante se
van separando: una botella rota que nadie registró, un producto mal cobrado.
El inventario físico es contar lo que hay de verdad y dejar que SellPointy
corrija sus números con lo que contaste.

Se hace en **Movimientos › Inventario**, una sucursal a la vez. Cada conteo es un
documento con folio propio (`INV-000001`) y, como las entradas y salidas, nace
como borrador: nada se ajusta hasta que lo confirmas.

## Contar

1. En **Movimientos › Inventario**, elige la **Sucursal** y presiona **Crear**.
   Solo puede haber un conteo abierto por sucursal: si ya hay uno, termínalo o
   anúlalo antes de empezar otro.
2. En la tarjeta **Subir el conteo**, presiona **Plantilla Excel**. Baja una hoja
   con los productos de esa sucursal y lo que el sistema cree que hay (el
   **teórico**). Los productos con lote traen una fila por lote, y una fila con
   el lote vacío para lo que todavía no tiene lote: por ejemplo, lo que ya
   tenías cuando encendiste el control por lote. Al contarlo, escribe su lote y
   su caducidad. La columna **controla_lotes** te dice en cuáles: **SI** lleva
   lote y caducidad; **NO** se cuenta sin ellos. La caducidad escríbela como
   día/mes/año (15/08/2026) o como 2026-08-15; si SellPointy no la entiende,
   te avisa en esa fila al subir el archivo.
3. Imprime la hoja o llévala en la tableta, cuenta y escribe lo que encontraste
   en la columna **contado**. Si no hay nada, escribe **0**.
4. Guarda el archivo, vuelve a SellPointy, presiona **Elegir archivo** y súbelo.

![La hoja del conteo](screen:count-sheet)

Si subes el archivo otra vez, reemplaza lo que cargaste antes: sirve para
corregir. También puedes corregir un número directamente en la columna
**Contado** de la pantalla.

## Contar por presentaciones

Lo contado va en la unidad base del producto: el queso, en kilogramos. Si en el
estante lo tienes en empaques, no hace falta sacar la cuenta a mano. Bajo el
campo **Contado** de la fila presiona **Contar por presentaciones**: se abre un
desglose con una fila por cada empaque del producto («Bolsa 1 Kg», «Bolsa 10
Kg») y una de **Sueltos**.

Por ejemplo, en el refrigerador hay 2 bolsas de 1 kg, 1 bolsa de 10 kg y un
trozo de 600 g de queso Oaxaca:

1. Escribe **2** junto a «Bolsa 1 Kg» y **1** junto a «Bolsa 10 Kg».
2. En **Sueltos**, toca **g** y escribe **600**.
3. Abajo aparece **Total: 12.600 kilogramos**. Presiona **Usar este total** y
   ese número queda en **Contado**.

La fila guarda cómo contaste: bajo lo contado se lee «2 × Bolsa 1 Kg + 1 ×
Bolsa 10 Kg + 600 g», también en el conteo ya confirmado. Si te equivocaste en
una bolsa, vuelve a abrir el desglose: trae lo que escribiste y solo corriges
esa. Un empaque marcado como **Solo enteros** no acepta medio empaque. Si
después escribes un número directo en **Contado**, ese número es el que vale y
el desglose se borra.

El botón aparece en los productos que tienen empaques además de su unidad base.
En un producto con lote, cada fila (su lote y su ubicación) se desglosa por
separado. Con el teclado, **Enter** usa el total y **Esc** cierra sin guardar.

## Revisar las diferencias

Arriba de la lista aparece el resumen: cuántos productos **Contados**, cuántos
**Coinciden** con el sistema, cuántas **Discrepancias**, cuántos quedaron
**Omitidos** (sin contado) y cuántos **Lotes nuevos** encontraste al contar.

![Lo contado contra lo que dice el sistema](screen:count-differences)

Cada línea muestra el **Teórico**, lo **Contado** y la **Diferencia**, y en
**Stock** cómo va a quedar: de cuánto a cuánto. Esa columna solo aparece en el
borrador; ya confirmado, el conteo muestra lo que se contó y su diferencia.
Marca **Solo discrepancias**
para ver únicamente lo que no cuadra; es donde vale la pena volver a contar
antes de confirmar.

## Confirmar ajusta el inventario

Cuando estés conforme, presiona **Confirmar inventario**, arriba a la derecha
junto a **Anular**; se habilita en cuanto subes la plantilla. SellPointy pone el
saldo de cada producto en lo que contaste: donde sobraba, registra una salida;
donde faltaba, una entrada, las dos con motivo **Inventario físico**. Las ves en
el kardex de cada producto.

Para confirmar, cada línea necesita su contado: una vacía, negativa o con texto
no deja confirmar, y la pantalla te dice cuál es.

Cada producto sin lote se cuenta en una sola fila y en su unidad base (piezas,
kilogramos): si la hoja lo trae dos veces, la segunda fila no deja confirmar
hasta que corrijas la hoja y la vuelvas a subir, y si trae una presentación como
«Caja con 12», SellPointy no lee esa fila al subirla y la deja sin contado para
que escribas cuánto hay en la unidad base. Para sumar cajas y sueltos en esa
fila, usa **Contar por presentaciones**.

Tres cosas conviene saber:

- **Las ventas no se detienen.** El ajuste se hace sobre lo que hay en el momento
  de confirmar, no sobre lo que había al bajar la hoja. Si vendiste mientras
  contabas, se toma en cuenta.
- **Confirmar lo hace un administrador.** Un conteo puede cambiar los números de
  toda una sucursal, así que hace falta el permiso de administrar el
  inventario. Quien solo registra movimientos puede capturarlo, pero el
  borrador queda esperando a que un administrador lo confirme.
- **Un conteo confirmado ya no se edita.** Si algo quedó mal, corrígelo con una
  entrada o salida con motivo **Ajuste** (capítulo 23, «Entradas y salidas»).

Un conteo confirmado se imprime, se guarda como PDF o se descarga en Excel igual
que una entrada o una salida (capítulo 23). El Excel trae el teórico, lo contado
y la diferencia de cada producto como números, y se llama como su folio, por
ejemplo `INV-000002.xlsx`.
