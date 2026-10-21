import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_KEYS } from "@sellpoint/shared";

/**
 * F9-RECEP-23 — barrera de FUENTE de la ley 16 de la Fase 9: el POS no
 * importa NADA de un módulo vertical.
 *
 * Con el punto de extensión de la venta (ley 31) la tentación es obvia: el día
 * que haga falta «un detalle más» de Recepción en la caja, importarlo es una
 * línea. Esa línea es la que vuelve al núcleo dependiente de cada vertical, y
 * ninguna prueba de comportamiento la ve: la venta funciona igual. Esta sí.
 *
 * Se arma el nombre de la CARPETA de cada módulo desde `MODULE_KEYS` (con
 * guion: `medical_clinic` vive en `medical-clinic/`), así que un vertical
 * nuevo queda vigilado sin tocar este archivo.
 */
const POS_DIR = __dirname;

function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const ruta = join(dir, entry.name);
    if (entry.isDirectory()) return fuentes(ruta);
    return entry.name.endsWith(".ts") ? [ruta] : [];
  });
}

describe("el POS no importa módulos verticales (ley 16)", () => {
  const archivos = fuentes(POS_DIR);
  const carpetas = MODULE_KEYS.map((key) => key.replaceAll("_", "-"));

  it("hay fuentes que revisar (si esto falla, la barrera no está mirando nada)", () => {
    expect(archivos.length).toBeGreaterThan(20);
  });

  it("ningún import apunta a la carpeta de un módulo vertical", () => {
    const infractores = archivos.flatMap((ruta) => {
      const texto = readFileSync(ruta, "utf8");
      const imports = [...texto.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
      return imports
        .filter((destino) =>
          carpetas.some((c) => destino.includes(`/${c}/`) || destino.endsWith(`/${c}`)),
        )
        .map((destino) => `${ruta.slice(POS_DIR.length + 1)} → ${destino}`);
    });

    expect(infractores).toEqual([]);
  });
});
