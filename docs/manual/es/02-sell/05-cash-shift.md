---
title: Tu turno de caja: abrir, cerrar y arqueo
who: cajero
---

Para cobrar necesitas un **turno de caja** abierto. El turno dice desde qué
sucursal vendes y junta todo lo que cobras, y el efectivo que metes o sacas del
cajón, hasta que lo cierras. Al cerrarlo,
cuentas el efectivo de tu cajón y SellPointy lo compara con lo que debería
haber: eso es el **arqueo**.

Cada persona tiene su propio turno. Si dos cajeros cobran en la misma sucursal,
cada uno abre el suyo y cuadra su propio cajón.

## Abrir tu turno

1. En el menú de la izquierda, en **Punto de venta**, entra a **Venta**. También
   puedes presionar **Abrir turno** en tu panel (capítulo 11).
2. Revisa la **Sucursal**: la que tienes asignada ya viene elegida. Si hoy
   cobras en otra, elígela en la lista; solo aparecen las sucursales donde
   puedes trabajar. Si no te aparece ninguna, pide a quien administra el
   negocio que te dé acceso a una: sin sucursal no se abre el turno.
3. Si tu cajón arranca con dinero para dar cambio, escribe cuánto en **Fondo
   inicial (opcional)**, por ejemplo **500**. Si no usas fondo, déjalo vacío:
   tu turno abre en $0.00.
4. Presiona **Abrir turno**.

![Abrir el turno con la sucursal asignada ya elegida y $500 de fondo](screen:open-shift)

El fondo se escribe una sola vez, al abrir: después ya no se puede cambiar. Si
te equivocaste, cuéntalo igual al cerrar y explica la diferencia en la **Nota**.

Aparece la pantalla de venta (capítulo 6). Arriba, una barra te recuerda desde
qué sucursal cobras y desde qué hora, por ejemplo **Punto de venta · Sucursal
Centro · Turno abierto desde 8:45**. Revísala: lo que vendes sale del
inventario de esa sucursal. A la derecha de la barra está **Efectivo**, para
registrar el dinero que metes o sacas del cajón sin una venta (lo explica la
sección siguiente).

- Solo puedes tener **un turno abierto a la vez**. Si ya tienes uno, **Venta** te
  lleva directo a cobrar.
- Tu turno **no se cierra solo**, aunque cierres el navegador o apagues la
  computadora, y nadie más puede cerrarlo por ti. Si te vas sin cerrarlo, al
  día siguiente sigues en el mismo turno y las ventas nuevas se juntan con las
  de ayer. Ciérralo siempre al terminar.
- Para cotizar no necesitas turno (capítulo 9).

## Entradas y retiros de efectivo

A veces el efectivo entra o sale de tu cajón sin una venta: llevas billetes a la
caja fuerte para no tener tanto en el mostrador, o te traen monedas para dar
cambio. Si no lo registras, al cerrar ese dinero aparece como un faltante o un
sobrante tuyo. Regístralo en el momento:

1. En la barra de arriba de la pantalla de venta, presiona **Efectivo**. Se abre
   **Entradas y retiros de efectivo**.
2. Elige el tipo:
   - **Entrada**, si metes efectivo al cajón. Sus motivos son **Fondo para
     cambio** y **Otro**.
   - **Retiro**, si sacas efectivo del cajón. Sus motivos son **A la caja
     fuerte**, **Depósito al banco**, **Retiro del dueño** y **Otro**.
3. Escribe el **Importe** y elige el **Motivo**.
4. Si quieres, escribe una **Nota (opcional)**, por ejemplo el número de la bolsa
   que va a la caja fuerte. Con **Otro**, la nota es obligatoria: escribe de qué
   se trata.
5. En un retiro, si tu negocio tiene código de autorización (capítulo 14),
   aparece **Código de autorización**. Lo escribe quien supervisa la caja, por
   ejemplo la encargada que se lleva el dinero.
6. Presiona **Registrar retiro** o **Registrar entrada**.

![Luis registra un retiro de $500 a la caja fuerte, con el código de la encargada](screen:cash-movement)

Abajo, en **Movimientos del turno**, ves lo que se registró en tu turno, del más
nuevo al más viejo: el tipo, el motivo, el importe con su signo, la nota, la
hora y quién lo registró. Cuando terminas, presiona **Cerrar**.

- **El código.** Es el mismo de los descuentos y comparte su límite: después de
  cinco códigos equivocados, los descuentos y los retiros se te bloquean 15
  minutos. Si tu negocio no tiene código, el retiro no lo pide y queda
  registrado quién lo hizo. Una entrada nunca pide código.
- **No por debajo de cero.** Un retiro no puede sacar más efectivo del que debe
  haber en tu cajón. Si tecleas 10,000 en lugar de 1,000, SellPointy no lo
  registra y te dice cuánto efectivo hay.
- **Un retiro no es un gasto.** El dinero que llevas a la caja fuerte o al banco
  sigue siendo del negocio: no aparece en los gastos ni baja la utilidad. Si con
  dinero del cajón se le paga algo a alguien, eso sí es un gasto (capítulo 10).

### Anular una entrada o un retiro

Si te equivocaste, presiona **Anular** junto al movimiento, escribe **Por qué se
anula** y presiona **Anular el movimiento**.

- Anular una **entrada** baja el efectivo esperado, igual que un retiro: pide el
  **Código de autorización**, si tu negocio lo tiene, y tampoco puede dejar el
  esperado por debajo de cero.
- Anular un **retiro** nunca pide el código.

Un movimiento anulado no se borra: queda en la lista tachado, marcado
**Anulado**, con quién lo anuló y por qué, y deja de contar en el efectivo
esperado. Solo se anula mientras tu turno está abierto; con el turno cerrado, ya
no se puede tocar.

## Cerrar tu turno y hacer el arqueo

1. En el menú, entra a **Cierre de turno**. También puedes presionar **Cerrar
   turno**, abajo de la pantalla de venta.
2. Revisa las cuentas de tu turno (las explica la tabla de abajo).
3. Cuenta todo el efectivo de tu cajón, con el fondo incluido, y escríbelo en
   **Efectivo contado en caja**. Mientras escribes, SellPointy muestra la
   **Diferencia** contra lo esperado.
4. Si no cuadra, explica por qué en **Nota (opcional)**, por ejemplo «Faltaron
   $20 del cambio.».
5. Presiona **Cerrar turno**.

![El cierre de turno de Luis: contó $20 menos de lo esperado](screen:close-shift)

| Renglón | Qué es |
|---|---|
| **Fondo inicial** | El dinero con que abriste tu turno para dar cambio. Si no escribiste ninguno, dice $0.00. |
| **Efectivo**, **Tarjeta**, **Transferencia** | Lo que cobraste con cada forma de pago, y en cuántas ventas. |
| **Entradas de efectivo** | El efectivo que metiste al cajón sin una venta. Solo aparece si hubo alguna. |
| **Retiros de efectivo** | El efectivo que sacaste del cajón sin una venta, por ejemplo a la caja fuerte. Solo aparece si hubo alguno. |
| **Gastos en efectivo** | Lo que se pagó con dinero de tu cajón. Solo aparece si hubo alguno (capítulo 10). |
| **Efectivo esperado** | Lo que debe haber en tu cajón: el fondo inicial, más el efectivo de tus ventas, más las entradas, menos los retiros y los gastos. |

Las entradas y los retiros anulados no cuentan.

En la tienda de ejemplo, Luis abrió con $500.00 de fondo, cobró $430.50 en
efectivo y del cajón salieron $90.00: el efectivo esperado es $840.50. Contó
$820.50, así que la diferencia es -$20.00. Si a media mañana hubiera llevado
$500.00 a la caja fuerte y lo hubiera registrado como retiro, el esperado sería
$340.50.

¿Al contar te falta dinero porque olvidaste registrar un retiro? La barra del
cierre también tiene **Efectivo**: regístralo ahí y el efectivo esperado se
corrige antes de que cierres.

Solo se cuenta el efectivo: lo que se cobra con tarjeta o transferencia no pasa
por tu cajón. Las ventas que se cancelaron mientras tu turno estaba abierto no
cuentan, porque su dinero ya no está en el cajón (capítulo 8).

**La diferencia no te impide cerrar.** Si falta dinero sale con signo de menos
(«-$20.00»); si sobra, sin signo. En los dos casos se pinta en rojo. El turno
se cierra igual y la diferencia queda registrada: quien administra el negocio ve
cada cierre, con lo que se esperaba, lo que contaste, la diferencia y tu nota,
en el reporte de cierres de turno (capítulo 31). Escribe lo que de verdad
contaste: una diferencia a la vista se aclara; una escondida se repite.

Cada turno tiene un **folio**, como «TUR-000042», que toma al abrirse. Al
cerrar, se descarga en tu equipo el **PDF del cierre** en tamaño carta, para
control interno, con el folio como nombre (`TUR-000042.pdf`): arriba el arqueo
y abajo las ventas del turno y los gastos que salieron del cajón. La pantalla
vuelve a **Abrir turno**, lista para tu siguiente turno, y arriba te dice el folio del turno que cerraste, con
**Descargar PDF del cierre** por si no se descargó o necesitas bajarlo otra vez.
