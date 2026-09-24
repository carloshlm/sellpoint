---
title: Roles: los de fábrica y los personalizados
who: dueño
plan: En Plus (personalizados)
---

Un **rol** es un paquete de permisos: dice qué puede ver y hacer quien lo
tiene. A cada usuario le das uno o varios roles (capítulo 32) y SellPointy le
muestra solo lo que esos roles permiten. Los roles están en el menú de la
izquierda, en **Sistema** › **Roles**.

## Los roles de fábrica

Todo negocio nace con cuatro roles. Sus nombres aparecen en inglés:

| Rol | Para quién | Qué puede hacer |
|---|---|---|
| **Admin** | El dueño | Todo, incluidos los usuarios, los roles, los datos del negocio y **Mi plan**. |
| **Manager** | El encargado | La operación diaria completa: vender, anular ventas, productos, inventario, compras y gastos. No administra usuarios ni roles, no cambia los datos del negocio, no diseña los campos propios del catálogo, no cancela traspasos ni aprueba un inventario físico. |
| **Seller** | El cajero | Vender, cotizar, ver el historial de ventas y reimprimir tickets, y consultar productos y servicios. No ve los reportes ni el dinero del negocio. |
| **Viewer** | Quien solo consulta | Consultar el catálogo, el inventario, las compras, los gastos, los usuarios, el historial de ventas y los reportes, sin poder cambiar nada. Útil para tu contador. |

El detalle, permiso por permiso, está en el apéndice B.

Si una persona tiene **varios roles**, puede hacer todo lo que permita
cualquiera de ellos.

## Ver los permisos de un rol

Presiona un rol en la lista. A la derecha aparecen todos los permisos,
agrupados por área del sistema («Punto de venta», «Inventario», «Compras»…),
con marcados los que tiene ese rol. Cada uno se ve con un nombre claro («Vender
en caja», «Cancelar ventas», «Administrar sucursales») y no con el código interno.
El apéndice B explica qué hace cada permiso, rol por rol.

![Los permisos del rol Seller](screen:roles-seller)

En los planes Basic y Pro la pantalla es de **solo lectura**, con un aviso
arriba: los roles de fábrica se asignan igual a tus usuarios, pero no se
cambian ni se crean roles nuevos.

## Crear un rol a tu medida

En el plan Plus puedes armar roles propios. Por ejemplo, un «Encargado de
almacén» que solo consulta productos y registra entradas y salidas, o un cajero
que además puede anular ventas.

1. Presiona **Nuevo rol**.
2. Escribe el **Nombre del rol** y presiona **Crear rol**.
3. El rol nuevo queda elegido, todavía sin permisos. Marca los que necesita.
4. Presiona **Guardar cambios**.

![Un rol nuevo, antes de crearlo](screen:role-new)

Después ya lo puedes asignar a tus usuarios desde **Usuarios**.

### Cambiar o eliminar un rol

En Plus también puedes cambiar los permisos o el nombre de cualquier rol,
incluidos los de fábrica: elígelo, ajusta y presiona **Guardar cambios**.
**Cancelar** deshace lo que no guardaste. Los permisos nuevos valen de
inmediato; si alguien con ese rol tiene SellPointy abierto, que recargue la
página para ver su menú al día.

Para quitar un rol, presiona **Eliminar** junto a su nombre y confirma con
**Eliminar rol**. No se puede eliminar un rol que tiene usuarios asignados:
primero cámbiales el rol.

### Tres candados que te protegen

- **No puedes dar lo que no tienes.** Los permisos que tú no tienes aparecen en
  gris: no los puedes agregar a un rol.
- **Siempre queda un administrador.** Si un cambio dejara al negocio sin nadie
  que pueda administrar usuarios y roles, SellPointy lo rechaza con **Esta
  acción dejaría al comercio sin ningún usuario que pueda administrar roles y
  usuarios**.
- **Los nombres no se repiten.** Dos roles no pueden llamarse igual.
