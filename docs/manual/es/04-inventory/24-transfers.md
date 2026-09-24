---
title: Traspasos entre sucursales
who: dueño
plan: Desde Pro
---

Un traspaso lleva mercancía de una sucursal a otra. Tiene dos momentos: la
sucursal de origen la **envía** y la de destino la **recibe**. Entre los dos, la
mercancía está **en tránsito**: ya salió de una y todavía no cuenta en la otra.

Así, si algo se pierde en el camino, se nota: lo que salió y nadie recibió se
queda a la vista hasta que alguien se haga cargo.

## Enviar

El envío es una **Salida** con motivo **Traspaso** (capítulo 23, «Entradas y
salidas»).

1. En **Movimientos › Salidas**, elige la sucursal de **origen** y presiona
   **Crear**.
2. En **Motivo**, elige **Traspaso**.
3. En **Sucursal destino**, elige a dónde va la mercancía.
4. Agrega los productos y sus cantidades.
5. Presiona **Confirmar**.

Al confirmar, la mercancía se descuenta del origen y queda en tránsito. En la
ficha del producto aparece en el renglón **En tránsito** (capítulo 22,
«Existencias y kardex»).

## Los traspasos en tránsito

En **Movimientos › Traspasos** está la pantalla **Traspasos en tránsito**, con
tres pestañas:

- **Pendientes de recibir**: lo que va hacia tus sucursales.
- **Pendientes de enviar**: lo que salió de tus sucursales y todavía no llega.
- **Cancelados**: los traspasos que se cancelaron, con su motivo.

El número junto a cada pestaña es cuántos hay. En las dos primeras, el filtro
**Destino** muestra solo los que van a una sucursal: la pantalla abre con la
tuya, así que si no ves un traspaso, cambia el destino.

![Un traspaso en tránsito hacia la Sucursal Norte](screen:transfers-in-transit)

La columna **Días** cuenta cuánto lleva en camino. Marca **Más de 7 días** para
ver solo los que llevan más de una semana: casi siempre es mercancía que llegó y
nadie confirmó. **Exportar Excel** baja el detalle de todo lo que está en
tránsito.

## Recibir

Quien recibe en la sucursal de destino:

1. Busca el traspaso en **Pendientes de recibir** y presiona **Recibir**.
2. El aviso dice qué se va a crear. Presiona **Crear entrada**.
3. Se abre una **Entrada** en borrador con las cantidades que se enviaron ya
   cargadas. El motivo y la sucursal de origen vienen del traspaso y no se
   cambian.
4. Revisa que las cantidades sean las que llegaron y presiona **Confirmar**.

![Recibir un traspaso](screen:transfer-receive)

Al confirmar, la mercancía suma en el destino y el traspaso deja de estar en
tránsito. No se puede recibir más de lo que se envió.

Si cierras la entrada sin confirmarla, el botón del traspaso cambia a
**Continuar** con el folio de esa entrada: presiónalo para retomarla donde la
dejaste.

### Si llega menos de lo que se envió

Baja la cantidad del producto que llegó incompleto. La cabecera de la entrada
tiene un campo **Nota**: cuéntale ahí qué pasó con la diferencia («llegaron 20
de 24 aguas», «se rompió una caja en el camino»). En cuanto algún producto
queda por debajo de lo enviado, **Confirmar** exige esa nota — sin ella, el
movimiento no se registra.

> La diferencia entre lo enviado y lo recibido **no entra al destino ni genera
> una merma automática**: ya salió del origen, y qué pasó en el camino lo
> decide una persona con un **Ajuste** aparte, si hace falta.

## Cancelar

Si un traspaso no va a llegar, se cancela con **Cancelar traspaso**. Escribe en
**Justificación** por qué y confirma.

![Cancelar un traspaso](screen:transfer-cancel)

> **La mercancía no regresa al origen.** La salida ya ocurrió y es historia. Si
> la mercancía aparece después, regístrala con una **Entrada** con motivo
> **Ajuste** en la sucursal donde esté.

Cancelar un traspaso lo puede hacer quien administra el inventario del negocio;
recibirlo, cualquiera que registre movimientos.
