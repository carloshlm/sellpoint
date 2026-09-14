import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * BARRERA: un `Label` siempre rotula un CAMPO (Carlos, 2026-09-14).
 *
 * Mi perfil mostraba el correo, el país y la moneda —datos de solo lectura—
 * con un `Label` sobre un `<p>`. Una `<label>` sin `htmlFor` ni campo adentro
 * no rotula nada: Chrome lo reportaba en su panel de avisos y un lector de
 * pantalla leía el nombre suelto. Para un dato que no se edita está
 * `ReadOnlyField` (`<dt>`/`<dd>`); para un campo, su `htmlFor`.
 *
 * Escanea TODO el código del web, no una lista: la próxima pantalla no tiene
 * que acordarse de agregarse para quedar cubierta.
 */
const SRC = join(__dirname, "..", "..");

function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosTsx(ruta);
    return ruta.endsWith(".tsx") && !ruta.endsWith(".test.tsx") ? [ruta] : [];
  });
}

/**
 * Las etiquetas de apertura de `Label` sin `htmlFor`, en CÓDIGO.
 *
 * Quita antes los comentarios: la primera versión de esta barrera marcó la
 * documentación de `ReadOnlyField`, que menciona la etiqueta para explicar
 * por qué no la usa. Una barrera que falla por un comentario enseña a
 * esquivarla reescribiendo comentarios, no a arreglar el código.
 *
 * Límites conocidos: una prop con `=>` cortaría la etiqueta antes de tiempo
 * (ningún Label del proyecto recibe funciones), y un `//` dentro de un texto
 * —una URL— se lee como comentario hasta el fin de esa línea.
 */
function etiquetasSinCampo(fuente: string): string[] {
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return (codigo.match(/<Label\b[^>]*>/g) ?? []).filter(
    (etiqueta) => !etiqueta.includes("htmlFor"),
  );
}

describe("el uso de Label", () => {
  describe("la regla, en las dos direcciones", () => {
    it("marca un Label sin htmlFor", () => {
      expect(etiquetasSinCampo("<Label>Email</Label>")).toHaveLength(1);
      expect(etiquetasSinCampo('<Label className="x">País</Label>')).toHaveLength(1);
    });

    it("acepta un Label con htmlFor, también en varias líneas", () => {
      expect(etiquetasSinCampo("<Label htmlFor={id}>Email</Label>")).toEqual([]);
      expect(
        etiquetasSinCampo('<Label\n  className="x"\n  htmlFor="email"\n>Email</Label>'),
      ).toEqual([]);
    });

    it("ignora las menciones dentro de comentarios", () => {
      expect(etiquetasSinCampo("/** no es un `<Label>` */")).toEqual([]);
      expect(etiquetasSinCampo("// antes era <Label>")).toEqual([]);
      expect(etiquetasSinCampo("{/* sin <Label> suelto */}")).toEqual([]);
    });
  });

  it("escanea el código de verdad (la barrera no barre en vacío)", () => {
    const conLabel = archivosTsx(SRC).filter((ruta) =>
      readFileSync(ruta, "utf8").includes("<Label"),
    );
    // Los campos compartidos (TextField, DateField, SelectField…) usan Label.
    expect(conLabel.length).toBeGreaterThan(3);
  });

  it("ningún Label del web se queda sin htmlFor", () => {
    const sinCampo = archivosTsx(SRC).flatMap((ruta) =>
      etiquetasSinCampo(readFileSync(ruta, "utf8")).map(
        (etiqueta) => `${relative(SRC, ruta)}: ${etiqueta}`,
      ),
    );
    expect({ sinCampo }).toEqual({ sinCampo: [] });
  });
});
