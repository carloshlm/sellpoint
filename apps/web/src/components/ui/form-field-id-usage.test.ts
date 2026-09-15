import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * BARRERA: todo campo del web lleva `id` o `name` (Carlos, 2026-09-14).
 *
 * Chrome reporta en su panel de avisos «A form field element should have an id
 * or name attribute» por cada campo que no tiene ninguno de los dos: sin ellos
 * el autocompletado del navegador no puede recordar ni sugerir el valor. El
 * aviso reapareció en Venta (el numpad del carrito) después de haberlo limpiado
 * en Entradas: se arreglaba pantalla por pantalla y la siguiente volvía a nacer
 * igual.
 *
 * Los campos compartidos (`TextField`, `MoneyField`, `DateField`…) ya ponen su
 * `id` con `useId`; lo que se escapa son los `<input>`, `<select>` y
 * `<textarea>` escritos a mano y el `Input` de la UI. Un campo que recibe sus
 * props con `{...props}` se da por bueno: el `id` lo pone quien lo usa.
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
 * La etiqueta de apertura completa a partir de `inicio`.
 *
 * No basta con cortar en el primer `>`: una prop como
 * `onChange={(e) => …}` lleva uno adentro. Se cuenta la profundidad de llaves
 * y solo cierra el `>` que queda fuera de ellas.
 */
function etiquetaDesde(codigo: string, inicio: number): string {
  let profundidad = 0;
  for (let i = inicio; i < codigo.length; i++) {
    const c = codigo[i];
    if (c === "{") profundidad++;
    else if (c === "}") profundidad--;
    else if (c === ">" && profundidad === 0) return codigo.slice(inicio, i + 1);
  }
  return codigo.slice(inicio);
}

/**
 * Los campos sin `id` ni `name`, en CÓDIGO: los comentarios se quitan antes,
 * porque la documentación menciona `<select>` para explicar decisiones.
 *
 * Límite conocido: un `//` dentro de un texto —una URL— se lee como comentario
 * hasta el fin de esa línea.
 */
function camposSinIdentificador(fuente: string): string[] {
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const campos: string[] = [];
  for (const m of codigo.matchAll(/<(input|select|textarea|Input)\b/g)) {
    const etiqueta = etiquetaDesde(codigo, m.index);
    if (!/\s(id|name)=|\s\{\.\.\./.test(etiqueta)) {
      campos.push(etiqueta.replace(/\s+/g, " "));
    }
  }
  return campos;
}

describe("los campos llevan id o name", () => {
  describe("la regla, en las dos direcciones", () => {
    it("marca un campo sin id ni name, también con una función adentro", () => {
      expect(camposSinIdentificador('<input value={x} aria-label="Cantidad" />')).toHaveLength(1);
      expect(
        camposSinIdentificador("<select\n  onChange={(e) => set(e.target.value)}\n>"),
      ).toHaveLength(1);
      expect(camposSinIdentificador("<Input value={x} />")).toHaveLength(1);
    });

    it("acepta id, name o las props de quien lo usa", () => {
      expect(camposSinIdentificador('<input id="q" value={x} />')).toEqual([]);
      expect(
        camposSinIdentificador('<select\n  onChange={(e) => set(e)}\n  name="status"\n>'),
      ).toEqual([]);
      expect(camposSinIdentificador("<input {...props} />")).toEqual([]);
    });

    it("ignora las menciones dentro de comentarios y otros nombres", () => {
      expect(camposSinIdentificador("/** no es un `<select>` */")).toEqual([]);
      expect(camposSinIdentificador("// antes era <input>")).toEqual([]);
      expect(camposSinIdentificador("<InputGroup><Selector /></InputGroup>")).toEqual([]);
    });
  });

  it("escanea el código de verdad (la barrera no barre en vacío)", () => {
    const conCampos = archivosTsx(SRC).filter((ruta) =>
      /<(input|select|textarea)\b/.test(readFileSync(ruta, "utf8")),
    );
    expect(conCampos.length).toBeGreaterThan(10);
  });

  it("ningún campo del web se queda sin id ni name", () => {
    const sinIdentificador = archivosTsx(SRC).flatMap((ruta) =>
      camposSinIdentificador(readFileSync(ruta, "utf8")).map(
        (campo) => `${relative(SRC, ruta)}: ${campo}`,
      ),
    );
    expect({ sinIdentificador }).toEqual({ sinIdentificador: [] });
  });
});
