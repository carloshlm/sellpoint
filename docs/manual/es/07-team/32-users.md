---
title: Usuarios: invitar y asignarles sucursal
who: dueño
---

Cada persona que trabaja contigo necesita su propio usuario: así SellPointy sabe
quién cobró cada venta y le muestra a cada quien solo lo que le toca. Los
usuarios se administran en el menú de la izquierda, en **Sistema** ›
**Usuarios**. Crear, editar y suspender usuarios es del rol **Admin**; un
**Manager** puede ver la lista, pero no cambiarla.

![La lista de usuarios](screen:users-list)

Cada usuario tiene uno de tres estados:

| Estado | Qué significa |
|---|---|
| **Invitado** | Ya lo diste de alta, pero todavía no activa su cuenta con el correo de invitación. |
| **Activo** | Ya puede entrar. |
| **Suspendido** | No puede entrar hasta que lo reactives. |

## Invitar a alguien

1. Presiona **Nuevo usuario**.
2. Escribe su **Email**, su **Nombre** y su apellido. El correo es con el que va
   a entrar y **no se puede cambiar después**.
3. Elige su **Idioma**: en ese idioma le llega el correo de invitación.
4. En **Sucursal asignada**, elige desde dónde trabaja. Es la sucursal donde
   abre su turno de caja y la que se le propone en cada movimiento. Si la dejas
   en **Sin asignar**, tendrá que elegir sucursal cada vez.
5. Marca al menos un rol en **Roles**. Para un cajero, **Seller**. Lo que puede
   hacer cada rol está en el capítulo 33 y en el apéndice B.
6. Presiona **Crear usuario**.

![Nuevo usuario, llenado como ejemplo](screen:user-new)

Un rol aparece en gris cuando da permisos que tú no tienes: nadie puede dar más
de lo que tiene.

### El correo de invitación

La persona recibe un correo con el asunto **Te invitaron a SellPointy** y un
botón, **Definir mi contraseña**. Al abrirlo:

1. Llega a la pantalla **Activa tu cuenta**.
2. Escribe su contraseña en **Define tu contraseña**: al menos 12 caracteres.
3. Presiona **Activar mi cuenta** y después entra con su correo y su contraseña
   (capítulo 2).

**El enlace dura 7 días** y sirve una sola vez. Si se le venció o no lo
encuentra, búscalo en su correo no deseado o reenvíaselo tú: abre el menú de
**Acciones** de su renglón y elige **Reenviar invitación**. Al reenviarla, el
enlace anterior deja de servir.

## El menú de cada usuario

Los tres puntos de la columna **Acciones** abren lo que puedes hacer con esa
persona. Las opciones cambian según su estado.

![Las acciones de un usuario activo](screen:user-actions)

| Opción | Cuándo aparece | Qué hace |
|---|---|---|
| **Editar** | Siempre | Cambia su nombre, idioma, sucursal, roles y alcance. |
| **Suspender** | Si está activo | Le quita el acceso y **cierra todas sus sesiones abiertas**. Te pide confirmar. No puedes suspenderte a ti mismo. |
| **Reactivar** | Si está suspendido | Le devuelve el acceso con la misma contraseña. |
| **Reenviar invitación** | Si está invitado | Le manda un correo nuevo con un enlace nuevo. |
| **Restablecer contraseña** | Si está activo | Le manda el correo para elegir una contraseña nueva, el mismo de «¿Olvidaste tu contraseña?». |

Un usuario **no se borra**: se suspende. Así su nombre sigue en las ventas y
los movimientos que hizo. Si intenta entrar, verá **Esta cuenta está
suspendida**.

## Limitar a un usuario a algunas sucursales

Si tienes varias sucursales, puedes hacer que alguien vea y opere solo algunas.
Esto se hace al **editar** al usuario, no al crearlo:

1. Abre sus **Acciones** y elige **Editar**.
2. En **Alcance por sucursal**, marca las sucursales que puede operar.
3. Presiona **Guardar cambios**.

![Sucursal asignada y alcance por sucursal](screen:user-store-scope)

- **Sin sucursales marcadas, el usuario ve TODAS.** Marca al menos una para
  limitarlo.
- La **Sucursal asignada** tiene que estar dentro de su alcance: las que quedan
  fuera se ven en gris.
- Quien tiene un rol que administra usuarios y roles, como **Admin**, ve todas
  las sucursales siempre; la pantalla te lo avisa.

Con el alcance puesto, esa persona solo ve los reportes, el inventario y los
números del panel de sus sucursales. Si intenta operar en otra, SellPointy le
responde **No tienes acceso a esta sucursal**.

## Cuántos usuarios permite tu plan

| Plan | Usuarios |
|---|---|
| Basic | 3 |
| Pro | 6 |
| Plus | 20 |

Cuentan los usuarios **activos e invitados**; los suspendidos no. Si ya llegaste
al límite, al crear uno verás **Tu plan permite hasta 3 usuarios. Mejora tu plan
para invitar más.** (con el número de tu plan). Suspender a alguien libera su
lugar. Si cambias a un plan con menos usuarios, nadie queda suspendido: el
límite solo se revisa al invitar.
