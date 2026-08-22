import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: el menú lateral se puede DESPLAZAR cuando no cabe en la pantalla.
 *
 * **El porqué, medido en un navegador de verdad (2026-08-22):** en un celular
 * de 700 px de alto, el menú mide **844 px** de contenido. «Roles», el último
 * item, terminaba en el píxel **892** — casi 200 fuera de la pantalla— y con
 * `overflow-y: visible` no había forma de llegar a él. El usuario no puede
 * entrar a Usuarios ni a Roles desde el teléfono, y no hay ninguna pista de
 * que exista algo más abajo: el menú simplemente se corta.
 *
 * **Por qué esto es un test de FUENTE y no de render:** jsdom no calcula
 * layout — `scrollHeight` y `clientHeight` valen 0 ahí, así que un test que
 * montara el componente pasaría en verde con el bug puesto (lección del
 * 2026-08-19: los bugs de CSS se miden en el navegador). Lo que sí se puede
 * fijar es el CONTRATO: que las tres clases que hacen posible el desplazamiento
 * sigan escritas.
 *
 * **Las tres, y por qué ninguna sobra:**
 *
 *  · `flex-1` — sin él el `<nav>` crece con su contenido y se desborda del
 *    `<aside>` en vez de quedar contenido; era exactamente el estado del bug
 *    (`clientHeight === scrollHeight === 844`).
 *  · `overflow-y-auto` — el que habilita la barra.
 *  · `min-h-0` — **el que nadie recuerda**. Un hijo de flex tiene
 *    `min-height: auto` por defecto y se NIEGA a encoger por debajo de su
 *    contenido, así que `overflow-y-auto` no llega a activarse nunca. Sin esta
 *    clase, las otras dos no alcanzan.
 *
 * Mismo criterio que `tablas-responsivas.test.ts`: se arregla la CLASE de
 * error, no la instancia.
 */
const LAYOUT = join(__dirname, "../../components/layout/app-layout.tsx");

/**
 * La etiqueta de apertura del `<nav>` del menú, tal como está escrita.
 *
 * El regex tolera el salto de línea (`<nav\n  aria-label=…`): la primera
 * versión de este test exigía un espacio después de `<nav` y se rompió sola
 * en cuanto el formateador partió la etiqueta en varias líneas. Un test que se
 * cae por el formato es un test que alguien va a terminar borrando.
 */
function navDelMenu(): string {
  const fuente = readFileSync(LAYOUT, "utf8");
  const apertura = /<nav\b[^>]*>/.exec(fuente);
  if (apertura === null) {
    throw new Error("No se encontró el <nav> del menú en app-layout.tsx");
  }
  return apertura[0];
}

describe("menú lateral desplazable (LEY de layout)", () => {
  it("el <nav> del menú puede desplazarse cuando no cabe", () => {
    const nav = navDelMenu();

    const faltan = ["flex-1", "overflow-y-auto", "min-h-0"].filter((clase) => !nav.includes(clase));

    expect({ clasesQueFaltan: faltan }).toEqual({ clasesQueFaltan: [] });
  });

  /**
   * El `<aside>` tiene que quedarse en la altura de la pantalla: es lo que le
   * da al `<nav>` un techo contra el cual desbordar. Si algún día se le pone
   * una altura automática, el nav volvería a crecer sin límite y las tres
   * clases de arriba dejarían de servir sin que nada se ponga rojo.
   */
  it("el <aside> sigue anclado a la altura de la pantalla en móvil", () => {
    const fuente = readFileSync(LAYOUT, "utf8");
    const aside = fuente.slice(fuente.indexOf("<aside"), fuente.indexOf("</aside>"));

    expect(aside).toContain("inset-y-0");
  });
});
