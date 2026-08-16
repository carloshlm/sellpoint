/**
 * F2-BOM-01 — detección de ciclos en el grafo de composición.
 *
 * El CHECK de la DB solo cubre el ciclo DIRECTO (un producto componente de sí
 * mismo). Los INDIRECTOS —A lleva B, B lleva C, C lleva A— necesitan recorrer
 * el grafo, y eso SQL no lo puede hacer en un constraint.
 *
 * Sin esta validación, guardar ese ciclo compila sin error y explota después:
 * el cálculo de unidades armables entra en recursión infinita la primera vez
 * que alguien abre el producto.
 *
 * Función PURA sobre el grafo ya cargado: se testea sin DB y sin Nest.
 */

/** `parentId -> componentIds`. Solo aristas, sin cantidades. */
export type CompositionEdges = ReadonlyMap<string, readonly string[]>;

/**
 * Devuelve el camino del ciclo (`[A, B, C, A]`) que se formaría al hacer que
 * `parentId` lleve `componentIds`, o `null` si no hay ninguno.
 *
 * Se devuelve el CAMINO y no un booleano a propósito: el mensaje de error
 * puede nombrar por dónde pasa el ciclo, que es lo único que le sirve a quien
 * lo tiene que deshacer.
 */
export function findCompositionCycle(
  edges: CompositionEdges,
  parentId: string,
  componentIds: readonly string[],
): string[] | null {
  // El grafo propuesto: el existente con las aristas nuevas del padre.
  const proposed = new Map(edges);
  proposed.set(parentId, componentIds);

  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];

  function walk(nodeId: string): string[] | null {
    if (visiting.has(nodeId)) {
      // Ya está en el camino actual: el ciclo va desde su primera aparición.
      const start = path.indexOf(nodeId);
      return [...path.slice(start), nodeId];
    }
    if (done.has(nodeId)) {
      return null;
    }

    visiting.add(nodeId);
    path.push(nodeId);

    for (const next of proposed.get(nodeId) ?? []) {
      const cycle = walk(next);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    visiting.delete(nodeId);
    done.add(nodeId);
    return null;
  }

  return walk(parentId);
}
