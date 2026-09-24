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
   **teórico**). Los productos con lote traen una fila por lote.
3. Imprime la hoja o llévala en la tableta, cuenta y escribe lo que encontraste
   en la columna **contado**. Si no hay nada, escribe **0**.
4. Guarda el archivo, vuelve a SellPointy, presiona **Elegir archivo** y súbelo.

![La hoja del conteo](screen:count-sheet)

Si subes el archivo otra vez, reemplaza lo que cargaste antes: sirve para
corregir. También puedes corregir un número directamente en la columna
**Contado** de la pantalla.

## Revisar las diferencias

Arriba de la lista aparece el resumen: cuántos productos **Contados**, cuántos
**Coinciden** con el sistema, cuántas **Discrepancias**, cuántos quedaron
**Omitidos** (sin contado) y cuántos **Lotes nuevos** encontraste al contar.

![Lo contado contra lo que dice el sistema](screen:count-differences)

Cada línea muestra el **Teórico**, lo **Contado** y la **Diferencia**, y en
**Stock** cómo va a quedar: de cuánto a cuánto. Marca **Solo discrepancias**
para ver únicamente lo que no cuadra; es donde vale la pena volver a contar
antes de confirmar.

## Confirmar ajusta el inventario

Cuando estés conforme, presiona **Confirmar**. SellPointy pone el saldo de cada
producto en lo que contaste: donde sobraba, registra una salida; donde faltaba,
una entrada, las dos con motivo **Inventario físico**. Las ves en el kardex de
cada producto.

Para confirmar, cada línea necesita su contado: una vacía, negativa o con texto
no deja confirmar, y la pantalla te dice cuál es.

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
