---
title: Existencias y kardex
who: dueño
plan: Desde Pro
---

Desde el plan Pro, SellPointy lleva la cuenta de cuánto tienes de cada producto
en cada sucursal. Cada venta, cada entrada de mercancía y cada salida mueve esa
cuenta, y todo queda anotado en el **kardex**: la lista, en orden, de cada
movimiento de un producto, con el saldo que quedó después de cada uno. Es como
el estado de cuenta del banco, pero de piezas en lugar de pesos.

Las dos cosas viven en la ficha del producto: entra a **Productos**, presiona el
nombre del producto (o **Ver** en su renglón) y elige la pestaña.

## Cuánto hay en cada sucursal

La pestaña **Stock por sucursal** muestra un renglón por sucursal, con la
**Cantidad** que hay y la fecha en que se movió por última vez (**Actualizado**).
Si una sucursal nunca ha tenido ese producto, aparece en cero y dice **Nunca**.

![Stock por sucursal de un producto](screen:stock-by-store)

Abajo está el **Total** de todas tus sucursales. Dos avisos pueden aparecer ahí:

- **Bajo mínimo**, cuando el total quedó por debajo del mínimo que capturaste en
  el producto. Es la señal para volver a pedirlo.
- **En tránsito**: mercancía que salió de una de tus sucursales hacia otra y que
  todavía nadie recibió. No cuenta en ninguna de las dos hasta que llegue
  (capítulo 24, «Traspasos entre sucursales»).

Si el producto se controla por lote, debajo de cada sucursal ves sus lotes con
su caducidad (capítulo 26, «Lotes y próximos a vencer»).

Los botones **Registrar entrada** y **Registrar salida** te llevan a las
pantallas del capítulo 23, «Entradas y salidas».

Un producto compuesto (un kit o una receta) no tiene existencias propias: la
pestaña te dice cuántos se pueden armar con lo que hay y qué componente lo
limita. Lo ves en el capítulo 17, «Productos compuestos: recetas y kits».

## El kardex

La pestaña **Kardex** lista los movimientos del producto, del más reciente al más
viejo. Cada renglón dice:

| Columna | Qué es |
|---|---|
| **Fecha** | Día y hora del movimiento. |
| **Movimiento** | Si fue **Entrada** o **Salida**, y el motivo: Venta, Factura de compra, Traspaso, Merma o pérdida, Inventario físico… |
| **Cantidad** | Cuánto entró (positivo) o salió (negativo), en la unidad del producto. |
| **Sucursal** | Dónde pasó. |
| **Referencia** | El folio del documento que lo causó: una venta (`VTA-`), una entrada (`ENT-`), una salida (`SAL-`) o un conteo (`INV-`). Presiónalo para abrirlo. |
| **Usuario** | Quién lo registró. |
| **Saldo** | Cuánto quedó en esa sucursal después del movimiento. |

![El kardex de un producto](screen:kardex)

La columna **Saldo** es la que hace útil al kardex: si hoy el estante no cuadra,
recorres los renglones hacia atrás hasta encontrar dónde cambió la cuenta, sin
sumar nada a mano. En los productos con lote aparece también la columna del lote.

### Filtrar y exportar

Arriba tienes los filtros **Sucursal**, **Motivo**, **Movimiento** (entradas,
salidas o las dos) y el rango **Desde** / **Hasta**. Al abrir, el kardex muestra
los últimos 30 días; presiona **Limpiar fechas** para ver toda la historia.

**Exportar Excel** baja a un archivo exactamente lo que estás viendo, con los
mismos filtros.

> Para ver las existencias de todos tus productos a la vez, con su valor, usa el
> reporte de existencias del capítulo 31, «Reportes y exportarlos a Excel».
