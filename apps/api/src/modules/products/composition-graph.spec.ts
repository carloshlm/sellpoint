import { findCompositionCycle } from "./composition-graph";

/**
 * F2-BOM-01. Los ciclos INDIRECTOS son los que importan: el directo ya lo
 * frena un CHECK en la DB, este es el único lugar donde se detecta A→B→C→A.
 */
describe("findCompositionCycle (F2-BOM-01)", () => {
  it("una composición plana no tiene ciclo", () => {
    const edges = new Map<string, string[]>();

    expect(findCompositionCycle(edges, "cafe", ["leche", "azucar"])).toBeNull();
  });

  it("composiciones ANIDADAS son válidas mientras no cierren el círculo", () => {
    // Un compuesto puede llevar otro compuesto: una salsa base dentro de un
    // plato, un kit dentro de otro kit.
    const edges = new Map<string, string[]>([["salsa", ["tomate", "sal"]]]);

    expect(findCompositionCycle(edges, "plato", ["salsa", "pasta"])).toBeNull();
  });

  it("detecta el ciclo DIRECTO", () => {
    expect(findCompositionCycle(new Map(), "cafe", ["cafe"])).toEqual(["cafe", "cafe"]);
  });

  it("detecta el ciclo INDIRECTO y devuelve el camino completo", () => {
    // A lleva B, B lleva C; agregar "C lleva A" cierra el círculo.
    const edges = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);

    expect(findCompositionCycle(edges, "c", ["a"])).toEqual(["c", "a", "b", "c"]);
  });

  it("un mismo componente usado por DOS padres no es un ciclo", () => {
    // Diamante: dos productos comparten un componente. Es normal y frecuente
    // — el azúcar va en el café y en el postre.
    const edges = new Map<string, string[]>([
      ["cafe", ["azucar"]],
      ["postre", ["azucar"]],
    ]);

    expect(findCompositionCycle(edges, "combo", ["cafe", "postre"])).toBeNull();
  });

  it("no se cuelga con un grafo que ya tiene un ciclo preexistente", () => {
    // Defensa: si por un bug pasado quedaron datos cíclicos, este código no
    // puede ser el que tire la app abajo con un stack overflow.
    const edges = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);

    expect(findCompositionCycle(edges, "nuevo", ["a"])).toEqual(["a", "b", "a"]);
  });
});
