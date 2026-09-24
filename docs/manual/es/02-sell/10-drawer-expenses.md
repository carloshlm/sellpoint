---
title: Gastos pagados desde el cajón
who: cajero
plan: Desde Basic
---

A veces algo se paga con el dinero de la caja: unos rollos de papel para la
impresora de tickets, por ejemplo. Ese dinero sale de tu cajón, así que al
cerrar tu turno tiene que restarse de lo que debes tener. SellPointy lo resta
cuando el gasto se registra como pagado **desde tu turno**; así, ese dinero no
aparece como un faltante tuyo.

## Quién lo registra

**Tú no registras gastos**: el rol de fábrica del cajero, Seller, no tiene ese
permiso. Lo registra
la dueña o el encargado (quien tenga el permiso **Registrar gastos**; de
fábrica, los roles Admin y Manager), y tiene que ser **mientras tu turno sigue
abierto**. Avísale en el momento y dale el comprobante.

En **Gastos** › **Registrar gasto**, esa persona:

1. Captura el gasto como cualquier otro: la fecha, la categoría, a quién se le
   pagó, el **Monto** y la descripción (capítulo 27).
2. En **Pago**, elige **Efectivo**. Aparece **Caja de origen**.
3. En **Caja de origen**, elige tu turno, por ejemplo **Turno de Luis Ramírez
   (Sucursal Centro)**. La sucursal del gasto queda fija: la de tu turno.
4. Presiona **Guardar**.

![Un gasto de $90 que salió del cajón del turno de Luis](screen:drawer-expense)

En **Caja de origen** solo aparecen los turnos abiertos. Un gasto que se
registra después de que cerraste tu turno ya no puede salir de tu cajón.

## Cómo se ve en tu cierre

Al cerrar tu turno (capítulo 5), el gasto aparece en **Gastos en efectivo**,
con signo de menos, y ya está restado del **Efectivo esperado**:

![El gasto del cajón en el cierre de turno de Luis](screen:drawer-expense-close)

En la tienda de ejemplo, Luis cobró $430.50 en efectivo y del cajón salieron
$90.00 para los rollos: el efectivo esperado es $340.50. Cuenta solo el dinero:
el comprobante del gasto no se suma.

## Si algo no cuadra

- **El gasto se registró sin tu turno.** Si en **Caja de origen** se dejó **No
  sale de una caja**, no se resta, y al contar te faltará ese dinero. Mientras
  tu turno siga abierto, se puede anular y registrar de nuevo eligiendo tu
  turno. Si ya cerraste, explica la diferencia en la **Nota** del cierre.
- **El gasto se anuló.** Un gasto anulado mientras tu turno está abierto deja
  de restarse: ese dinero vuelve a esperarse en tu cajón.
