---
title: El panel
who: dueño
---

El **Panel** es la primera pantalla al entrar a SellPointy: te dice en un
vistazo cuánto llevas vendido, cuánto te está dejando y qué necesita tu
atención. Todos los números se calculan con el día y el mes de la **zona
horaria de tu negocio**: una venta a las 11:30 de la noche cuenta en ese día,
aunque la revises desde otro lugar.

Lo que ves depende de tu rol. Los números de dinero los ve quien puede consultar
reportes (el permiso `reports:read`); el recuadro de **Inventario** y los
**Próximos a vencer**, quien puede consultar el inventario. Un cajero ve otro
panel, con su propio turno (capítulo 11). Y si tu usuario está limitado a
algunas sucursales, el panel suma solo esas.

## Los números de arriba

![Los mosaicos del panel](screen:dashboard-kpis)

| Mosaico | Qué es |
|---|---|
| **Ventas de hoy** | Lo cobrado hoy en ventas que no se cancelaron, con impuestos incluidos: lo que entró a la caja. |
| **Ventas del mes** | Lo mismo, desde el día 1 del mes. La barra y el **% de la meta** comparan contra tu meta mensual de ventas (capítulo 12); sin meta, no aparecen. Abajo, el **Cierre estimado** y, si tienes meta, cuánto te falta vender al día (más abajo, «A dónde vas en el mes»). |
| **Utilidad del mes** | Lo que te dejaron las ventas del mes: el precio sin impuestos menos el costo de lo vendido. Abajo, tu **margen** (por ejemplo, «17.2% de margen»): de lo que vendiste sin impuestos, qué parte te quedó. |
| **Utilidad neta del mes** | La utilidad del mes menos los gastos registrados con fecha de este mes (capítulo 27). Con gastos registrados, una barra dice cuánto de ellos ya cubrió tu utilidad. Solo aparece si tu plan incluye Gastos. |
| **Tickets de hoy** | Cuántas ventas llevas hoy y, abajo, el ticket **promedio**. |

### De dónde sale la utilidad

- Cada venta **guarda el costo que tenía el producto en ese momento**: el costo
  que capturaste en el producto (o en su presentación) o, si no tiene, el
  promedio de lo que has pagado en tus compras. Si después cambias el costo, las
  ventas pasadas no se recalculan.
- El impuesto no cuenta como ganancia: se resta del precio antes de calcularla,
  porque es dinero que le toca al fisco.
- Una venta de algo **sin costo** no entra en la utilidad, ni suma ni resta. Si
  ninguna venta del mes tiene costo, el mosaico dice **Aún sin datos de costo**.
  Para arreglarlo, captura el costo de tus productos y servicios.
- El **margen** se calcula con las mismas ventas: la utilidad entre su precio
  sin impuestos. Lo vendido sin costo tampoco cuenta aquí.

### A dónde vas en el mes

Debajo de **Ventas del mes**:

- **Cierre estimado**: lo que venderías en el mes si sigues al ritmo de los días
  que ya terminaron. Suma lo vendido del día 1 a ayer y, por cada día que falta
  (contando hoy), su promedio diario. Lo de hoy todavía no cuenta, así que el
  número no cambia mientras vendes durante el día. Si tu negocio empezó a vender
  este mes, el promedio cuenta desde tu primera venta. Necesita al menos tres
  días terminados: los primeros días del mes no aparece.
- **Para tu meta: $X al día**: lo que te falta para tu meta, repartido entre los
  días que quedan del mes, contando hoy. Cuando la alcanzas, dice **Meta
  alcanzada**. Sin meta, este renglón no aparece.

### Qué gastos resta la utilidad neta

Todos los gastos del mes que no estén anulados, **pagados o todavía por
pagar**: cuenta la fecha del gasto, no la del pago. En el negocio de ejemplo, la
renta ya pagada y el recibo de luz pendiente restan los dos.

A mitad de mes es normal que la utilidad neta salga **negativa**: la renta y los
demás gastos entran completos con su fecha, mientras que las ventas se suman día
a día. Por eso, debajo del número, una barra dice qué parte de tus gastos ya
cubrió tu utilidad (por ejemplo, «70% de tus gastos cubiertos») y, abajo, uno
de estos renglones:

- **Te falta vender $X**: lo que tendrías que vender para cubrirlos, al ritmo de
  lo que te dejó cada peso cobrado en los últimos 30 días (solo cuentan las
  ventas con costo). Si con eso no se puede calcular, por ejemplo porque se
  vendió por debajo del costo, este renglón no aparece.
- **Gastos cubiertos desde el día 19**: tu utilidad ya alcanzó tus gastos, y
  desde ese día del mes están cubiertos. La barra se pinta de verde.

Si no registraste gastos este mes, la barra no aparece.

### Las flechas de comparación

Cuando hay con qué comparar, cada mosaico muestra una flecha con el porcentaje:
**verde** si vas mejor y **roja** si vas peor. La comparación es siempre **a la
misma hora**, para que no te asuste a media mañana:

- **Ventas de hoy** contra el mismo día de la semana pasada, hasta la misma hora.
- **Ventas del mes** y las dos utilidades contra el mes anterior, hasta el mismo
  día y hora.

Si el periodo anterior no tuvo ventas, no hay flecha: un negocio recién abierto
no tiene contra qué compararse.

## Las gráficas

![Las dos gráficas de ventas](screen:dashboard-charts)

- **Ventas: mes actual vs anterior** dibuja lo vendido cada día del mes, con el
  mes pasado como línea de referencia.
- **Ventas de hoy por hora** muestra en qué horas se vende más: tu hora pico.
  Las barras son lo de **Hoy**; la línea punteada del fondo es un día típico:
  lo que vendiste en promedio a cada hora el **mismo día de la semana de las
  últimas 4 semanas**. Solo cuentan los días en que vendiste, así que un día que
  cerraste no baja el promedio. Así, desde temprano, aunque todavía no vendas
  nada, ves venir tu hora pico. Si en esos días no vendiste nada, la línea no
  aparece.

Pasa el cursor sobre una gráfica para ver la cantidad exacta. En la de horas
ves las dos cifras juntas: lo de hoy y el promedio.

## Las listas y sus pestañas

Debajo de las gráficas hay cuatro pestañas: **Hoy**, **Esta semana**, **Este
mes** y **Mes anterior**. Cambian las dos listas de productos y los **Métodos
de pago**; los mosaicos de arriba no cambian. La semana empieza el lunes.

![Los más vendidos y los de mayor utilidad](screen:dashboard-top-products)

- **Más vendidos**: los 10 productos o servicios que más dinero trajeron, sin
  impuestos, con la cantidad vendida. Lo que se vende por peso dice su unidad
  (por ejemplo, «111 kg»). La flecha junto al nombre compara contra el periodo
  anterior.
- **Mayor utilidad**: los 5 que más te dejaron, con su **margen**. Vender mucho
  no es ganar mucho: al ver las dos listas juntas descubres cuál es tu producto
  estrella de verdad. Solo entra lo que te dejó algo; si nada te dejó utilidad en
  el periodo, dice **Nada dejó utilidad en este período.**

Debajo de **Mayor utilidad** pueden aparecer dos avisos, cada uno con cuántos
son. Presiona uno para ver su lista:

- **Se vendieron por debajo de su costo**: lo que te hizo perder dinero en el
  periodo, de la mayor pérdida a la menor, con su margen. Revisa su precio o su
  costo.
- **Se vendieron sin costo: no cuentan en tu utilidad**: los productos y
  servicios que vendiste sin costo capturado. Captúralo para que tu utilidad
  esté completa.

Cada lista muestra hasta cinco y, si hay más, dice cuántos faltan. Si puedes ver
el catálogo, cada nombre te lleva a su producto o a la lista de servicios.

## Inventario y métodos de pago

![Inventario y métodos de pago](screen:dashboard-inventory)

El recuadro **Inventario** cuenta solo los productos que tienen un **stock
mínimo** (capítulo 16):

- **Agotados**: los que llegaron a cero.
- **Stock bajo**: los que tienen algo, pero menos que su mínimo.
- **Valor del inventario**: lo que vale tu mercancía al costo promedio de tus
  compras. Un producto que nunca compraste con costo no suma.

Presiona cualquiera de los tres para abrir el reporte **Stock por sucursal**
(capítulo 31). Abajo, **Productos a atender** lista hasta cinco productos
agotados o bajos, primero los más urgentes: calcula para cuántos días te
alcanzan al ritmo de venta de las últimas dos semanas. Si uno no se vendió en
ese tiempo dice **Sin ritmo de venta**.

**Métodos de pago** reparte tus ventas del periodo entre efectivo, tarjeta y
transferencia.

## Avisos y próximos a vencer

Entre los mosaicos y las gráficas pueden aparecer **avisos** de una línea, y
cada uno te lleva al reporte que lo explica. Salen solo cuando hay algo que
contar:

- productos agotados;
- ventas de hoy 10% o más abajo que el mismo día de la semana pasada;
- un producto que creció 20% o más sus ventas este mes;
- un método de pago que ya es el 60% o más de tus ventas del mes.

Al final, **Próximos a vencer** muestra los lotes que caducan en los próximos 30
días, los más urgentes primero, con **Ver todos** para la lista completa
(capítulo 26). Si no hay ninguno, el recuadro no aparece. Si puedes consultar
reportes, junto al título dice cuánto vale todo lo que vence en esos 30 días al
costo promedio de tus compras (por ejemplo, «$4,300.00 en riesgo»), y no solo
lo de los tres renglones a la vista. Lo que nunca compraste con costo no suma; si
nada tiene costo, el importe no aparece.
