import { within } from "@testing-library/react";
import { ROW_ACTIONS_CELL } from "@/components/ui/row-action";

/**
 * La columna de acciones de un listado, vista desde una de sus acciones
 * (Carlos, 2026-11-01): es la ÚLTIMA columna, su encabezado dice «Acciones»
 * y su celda lleva la regla compartida que deja los botones en una sola
 * línea, alineados a la derecha.
 *
 * jsdom no mide el ancho de nada: lo que se puede probar aquí es que la celda
 * lleva la clase compartida. Que en un celular no se encimen se mira en el
 * navegador.
 *
 * `accion` es cualquier botón o enlace de la fila; `encabezado` cambia el
 * texto esperado para las pantallas en inglés.
 */
export function expectRowActionsColumn(accion: HTMLElement, encabezado = "Acciones") {
  const celda = accion.closest("td");
  if (!celda) throw new Error("la acción no vive dentro de una celda de la tabla");
  const tabla = celda.closest("table");
  if (!tabla) throw new Error("la celda de la acción no vive dentro de una tabla");

  const columna = within(tabla).getByRole("columnheader", { name: encabezado });
  const encabezados = within(tabla).getAllByRole("columnheader");
  // El título va en la ÚLTIMA columna, encima de las acciones.
  expect(encabezados.at(-1)).toBe(columna);
  expect(celda.parentElement?.lastElementChild).toBe(celda);
  // Una sola línea, a la derecha: la regla vive en UNA constante.
  expect(celda).toHaveClass(...ROW_ACTIONS_CELL.split(" "));
}
