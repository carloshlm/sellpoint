import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: toda `<table>` escrita a mano vive dentro de un contenedor con
 * scroll horizontal.
 *
 * **El porqué:** una tabla `w-full` con más columnas de las que caben NO se
 * encoge — desborda el ancho de la página y en un celular el usuario termina
 * arrastrando la pantalla entera de lado, con el menú y el encabezado
 * corriéndose. El `<Table>` compartido de `components/ui/table.tsx` ya resuelve
 * esto (envuelve en `overflow-x-auto` y da `px-3` a las celdas); quien escribe
 * una `<table>` cruda se lo salta sin enterarse.
 *
 * Pasó dos veces: la tabla del documento (arreglada el 2026-08-19 cuando
 * Carlos la vio en su celular) y los listados de Entradas, Salidas y
 * Traspasos, que tenían el MISMO defecto y nadie miró. Arreglar la instancia
 * y no la clase es cómo la segunda tanda llegó a producción.
 */
const RAIZ = join(__dirname, "../..");

function tsxRecursivo(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules") continue;
      encontrados.push(...tsxRecursivo(ruta));
      continue;
    }
    if (entrada.name.endsWith(".tsx") && !/\.test\./.test(entrada.name)) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

describe("tablas responsivas (LEY de layout)", () => {
  it("ninguna <table> cruda queda fuera de un contenedor con scroll", () => {
    const infractoras: string[] = [];

    for (const archivo of tsxRecursivo(RAIZ)) {
      // El componente compartido ES el contenedor: se exceptúa a sí mismo.
      if (archivo.endsWith(join("components", "ui", "table.tsx"))) continue;

      const contenido = readFileSync(archivo, "utf-8");
      const lineas = contenido.split("\n");
      lineas.forEach((linea, indice) => {
        if (!/<table[\s>]/.test(linea)) return;
        // El contenedor tiene que estar en las 3 líneas de arriba: más lejos
        // que eso ya no es "envolver", es esperanza.
        const contexto = lineas.slice(Math.max(0, indice - 3), indice + 1).join("\n");
        // Dos formas válidas: el contenedor a mano, o `<ScrollableTable>` —
        // que además avisa cuando hay más columnas de las que caben.
        const envuelta =
          contexto.includes("overflow-x-auto") || contexto.includes("<ScrollableTable>");
        if (!envuelta) {
          infractoras.push(`  · ${archivo.replace(RAIZ, "src")}:${indice + 1}`);
        }
      });
    }

    expect(
      infractoras,
      `Estas <table> desbordan la página en pantallas chicas:\n${infractoras.join("\n")}\n\n` +
        `Envuélvelas en <ScrollableTable> (que además avisa cuando sobran ` +
        `columnas) o usa el <Table> de @/components/ui/table.`,
    ).toEqual([]);
  });
});
