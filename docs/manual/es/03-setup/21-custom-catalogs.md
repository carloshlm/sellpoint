---
title: Campos y subcatálogos propios
who: dueño
plan: En Plus
---

Cada negocio guarda datos distintos de sus cosas. Una ferretería quiere la
**marca** de cada producto; una tienda de ropa, la **talla**; un abarrotes, el
**pasillo** donde está. Con los **campos propios** agregas esos datos a tus
formularios, y con los **subcatálogos** creas tus propias listas para elegir de
ellas.

Los dos están en el menú de la izquierda, en **Catálogos personalizados**. En
los planes Basic y Pro aparecen con un candado, y al presionarlos te muestran
los planes.

## Agregar un campo

1. Entra a **Campos**.
2. En **Catálogo**, elige a qué formulario se lo quieres agregar: Productos,
   Servicios, Sucursales, Proveedores o uno de tus subcatálogos.
3. Presiona **Agregar campo**.
4. Escribe el **Nombre del campo**, como «Marca». Es lo que verás en el
   formulario, y lo puedes cambiar cuando quieras.
5. Elige el **Tipo**:
   - **Texto**, para escribir libremente.
   - **Numérico**, para un número.
   - **Lista de otro catálogo**, para elegir de una lista. Después eliges el
     **Catálogo al que apunta**, por ejemplo tu subcatálogo «Pasillos».
6. Marca **Es obligatorio** si no se debe poder guardar sin él.
7. Presiona **Guardar**.

![Agregar el campo «Marca» a los productos](screen:custom-field-form)

A la derecha, la **Previsualización** te enseña cómo queda el formulario. Los
**Campos estándar** vienen con cada catálogo y no se pueden quitar; los tuyos
aparecen abajo, en **Campos personalizados**, y los puedes subir o bajar con
las flechas para cambiar su orden.

![Los campos de los productos, con el campo «Pasillo» y su previsualización](screen:custom-fields)

Tus campos también aparecen como columnas en las plantillas de Excel
(capítulo 20).

### Cambiar o quitar un campo

- **Editar** te deja cambiar el nombre o si es obligatorio. El **tipo** ya no se
  puede cambiar cuando el campo tiene datos capturados.
- **Eliminar** un campo sin datos lo borra. Si ya tiene datos, SellPointy lo
  **desactiva** en lugar de borrarlo: deja de aparecer en los formularios, pero
  sus valores se conservan y lo puedes reactivar.

## Crear un subcatálogo

Un **subcatálogo** es una lista tuya: pasillos, marcas, tallas, colores. Cada
registro tiene un **Código** corto y los campos que tú le pongas.

1. En **Campos**, presiona **Nuevo subcatálogo** y escribe su nombre en plural,
   como «Pasillos».
2. Con el subcatálogo elegido en **Catálogo**, agrégale sus campos. A
   «Pasillos», por ejemplo, un campo de texto «Qué hay».
3. Entra a **Subcatálogos**, elígelo y presiona **Nuevo registro** para cada
   renglón: P1 «Bebidas», P2 «Aceites y enlatados»…
4. Para usarlo, agrega a Productos un campo de tipo **Lista de otro catálogo**
   que apunte a él. Desde ese momento, cada producto tiene una lista para elegir
   su pasillo.

![Los registros del subcatálogo «Pasillos»](screen:subcatalog-records)

Si tienes muchos registros, cárgalos con **Importar** (capítulo 20). Para
cambiarle el nombre a un subcatálogo, elígelo en **Campos** y presiona
**Renombrar**; los catálogos de SellPointy (Productos, Servicios…) no se
renombran.

Un registro que ya no usas se puede **Desactivar**. **Eliminar** solo funciona
si ningún otro registro lo está usando.
