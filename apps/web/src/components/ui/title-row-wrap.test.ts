import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * BARRERA: la fila del título de una pantalla se acomoda en un celular
 * (Carlos, 2026-11-01).
 *
 * En un teléfono de 390 px, «Nueva sucursal» en Sucursales y «Agregar» en
 * Estudios Diagnósticos y Estudios de Laboratorio salían cortados: el título
 * y los botones iban en una fila `justify-between` que no podía partirse, y
 * lo que no cabía se salía de la pantalla. Con `flex-wrap` los botones bajan
 * a la línea siguiente.
 *
 * Esta prueba escanea TODO el web: una fila `justify-between` que lleva un
 * `<h1>` en sus primeras líneas tiene que poder partirse (`flex-wrap`) o ir
 * en columna (`flex-col`), y el grupo de botones que va junto al `<h1>`
 * también. Así la próxima pantalla no nace cortada.
 */
const SRC = join(__dirname, "..", "..");

function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosTsx(ruta);
    return ruta.endsWith(".tsx") && !ruta.endsWith(".test.tsx") ? [ruta] : [];
  });
}

const SE_ACOMODA = /flex-wrap|flex-col/;

/** Los renglones de fuente con una fila de título que no se puede partir. */
function filasQueNoSeParten(fuente: string): string[] {
  const lineas = fuente.split("\n");
  const culpables: string[] = [];
  lineas.forEach((linea, i) => {
    // La fila que envuelve al título: `justify-between` y el `<h1>` adentro.
    const titulo = lineas.slice(i + 1, i + 8).some((l) => l.includes("<h1"));
    if (linea.includes("justify-between") && !SE_ACOMODA.test(linea) && titulo) {
      culpables.push(linea.trim());
    }
    // El grupo de botones que va justo después del `<h1>`.
    if (linea.includes("<h1")) {
      for (const siguiente of lineas.slice(i + 1, i + 5)) {
        if (/className="flex[\s"]/.test(siguiente) && /gap-/.test(siguiente)) {
          if (!SE_ACOMODA.test(siguiente) && !siguiente.includes("justify-between")) {
            culpables.push(siguiente.trim());
          }
          break;
        }
      }
    }
  });
  return culpables;
}

describe("la fila del título se acomoda en un celular", () => {
  it("marca una fila de título que no se parte, y su grupo de botones", () => {
    expect(
      filasQueNoSeParten(
        '<div className="flex items-center justify-between gap-2">\n  <h1>Gastos</h1>\n  <div className="flex gap-2">',
      ),
    ).toEqual([
      '<div className="flex items-center justify-between gap-2">',
      '<div className="flex gap-2">',
    ]);
    expect(
      filasQueNoSeParten(
        '<div className="flex flex-wrap items-center justify-between gap-2">\n  <h1>Gastos</h1>\n  <div className="flex flex-wrap gap-2">',
      ),
    ).toEqual([]);
  });

  it("deja pasar un renglón `justify-between` sin título, como el de un total", () => {
    expect(
      filasQueNoSeParten('<div className="flex justify-between">\n  <span>Total</span>'),
    ).toEqual([]);
  });

  it("ninguna pantalla del web tiene una fila de título que se corte", () => {
    const culpables = archivosTsx(SRC).flatMap((ruta) =>
      filasQueNoSeParten(readFileSync(ruta, "utf8")).map((l) => `${relative(SRC, ruta)}: ${l}`),
    );
    expect(culpables).toEqual([]);
  });
});
