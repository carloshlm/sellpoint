---
title: Historial de ventas
who: cajero
---

En **Historial** están las ventas del negocio, de la más reciente a la más
antigua: las de todas las cajas y sucursales, no solo las tuyas. Sirve para
encontrar la venta de un cliente que regresa, reimprimir su ticket o revisar
qué se cobró.

![El historial de ventas: una con descuento, una cancelada y una de otra caja](screen:sales-history)

| Columna | Qué dice |
|---|---|
| **Folio** | El número de la venta, como VTA-000482. |
| **Código de barras** | El número del código que trae impreso el ticket. |
| **Vendió** | Quién la cobró. |
| **Descuento** | Lo que se descontó, o un guion si no hubo descuento. |
| **Estado** | **Cobrada**, en verde, o **Cancelada**, en rojo. |

## Buscar una venta

Arriba de la tabla tienes tres filtros, que se pueden combinar:

- **Folio o código**: escribe el folio o solo una parte («482» encuentra la
  VTA-000482), o escanea con el lector el código de barras del ticket.
- **Estado**: **Todas**, **Cobrada** o **Cancelada**.
- **Desde** y **Hasta**: para ver solo ciertos días.

Se ven 20 ventas por página. Para ver más, usa **Siguiente** y **Anterior**,
abajo de la tabla.

**Reimprimir**, en cada renglón, saca otra vez el ticket de esa venta
(capítulo 7).

## Si una venta se cobró mal

**Tú no puedes cancelar una venta**: deshacer un cobro le toca a quien
administra el negocio. Por eso en tu historial no aparece el botón **Cancelar**.
Si una venta se cobró mal, avisa a la dueña o al encargado. Quien tiene el
permiso **Cancelar ventas** (de fábrica, los roles Admin y Manager) ve
**Cancelar** junto a **Reimprimir**; escribe el motivo en **Por qué se anula** y
confirma con **Cancelar la venta**.

Cuando una venta se cancela:

- **No se borra.** Se queda en el historial con el estado **Cancelada**, con el
  texto en gris.
- Lo que se vendió **vuelve al inventario** de la sucursal.
- Si se cancela mientras tu turno sigue abierto, **deja de contar en tu
  cierre**: su dinero ya no está en tu cajón (capítulo 5).
- No se puede volver a cobrar. Si el cliente sí se lleva algo, se cobra como una
  venta nueva.
