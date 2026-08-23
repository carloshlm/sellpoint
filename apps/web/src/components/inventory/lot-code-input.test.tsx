import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: todo input de código de lote normaliza AL TECLEAR (2026-08-23).
 *
 * El API ya normaliza —esa es la garantía de los datos— pero si la pantalla
 * no lo hace, el cajero escribe `stm01`, guarda, y al recargar aparece
 * `STM01`: un cambio que él no pidió y que le hace dudar de si guardó bien.
 * Lo que se escribe tiene que ser lo que se guarda.
 *
 * Es test de FUENTE porque lo que se protege es que CADA input use el
 * normalizador compartido, no el comportamiento de uno solo: hoy son dos
 * sitios (el editor de lote y la línea de documento) y el tercero que nazca
 * tiene que llegar con la regla puesta o ponerse rojo acá.
 */
const COMPONENTES = join(__dirname, "..");

/** Los archivos que declaran un `setLotCode` (o sea: un input de lote). */
function archivosConInputDeLote(): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const encontrados: string[] = [];

  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta);
        continue;
      }
      if (!ruta.endsWith(".tsx") || ruta.includes(".test.")) {
        continue;
      }
      if (readFileSync(ruta, "utf8").includes("setLotCode(")) {
        encontrados.push(ruta);
      }
    }
  };

  recorrer(COMPONENTES);
  return encontrados;
}

describe("el código de lote se normaliza al teclear", () => {
  it("encuentra los inputs de lote (la barrera no se salta por un barrido vacío)", () => {
    // Sin esto, renombrar el estado dejaría la lista vacía y el test de abajo
    // pasaría por no tener nada que revisar — la peor clase de verde.
    expect(archivosConInputDeLote().length).toBeGreaterThanOrEqual(2);
  });

  it("cada `setLotCode` pasa por `normalizeLotCode`", () => {
    const infractores = archivosConInputDeLote()
      .filter((ruta) => {
        const fuente = readFileSync(ruta, "utf8");
        // Cada llamada que viene de un evento del input debe envolver el valor.
        const desdeEvento = /setLotCode\(\s*event\.target\.value\s*\)/.test(fuente);
        return desdeEvento || !fuente.includes("normalizeLotCode");
      })
      .map((ruta) => ruta.slice(COMPONENTES.length + 1));

    expect({ sinNormalizar: infractores }).toEqual({ sinNormalizar: [] });
  });
});
