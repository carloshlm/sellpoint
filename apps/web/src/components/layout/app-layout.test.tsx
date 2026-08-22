import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA de layout: el contenedor del contenido puede ENCOGER.
 *
 * **Honestidad sobre su alcance (medido en navegador, 2026-08-20):** esto NO
 * es lo que arregla un desborde en celular hoy. Se midió la estructura real
 * con el CSS del proyecto a 390 px, con `min-w-0` y sin él: el `<main>` da 390
 * en los dos casos. La razón es que `main` es hijo de un flex COLUMNA, y ahí
 * `min-width: auto` no aplica al eje horizontal — el `min-w-0` que de verdad
 * importa ya lo tiene la columna (hijo del flex raíz, que sí es fila).
 *
 * Entonces, ¿para qué la barrera? Porque el día que alguien convierta esa
 * columna en fila, o mueva el `<main>` bajo otro flex horizontal, el
 * `min-width: auto` VUELVE a aplicar y la página entera se desborda de nuevo:
 * el `<main>` se niega a ser más angosto que su tabla más ancha. Es un
 * guardarraíl contra una refactorización futura, no un parche de hoy.
 *
 * La lección ya estaba escrita en `routes/catalog.schema.tsx` para las
 * tarjetas del grid: el conocimiento existía, la barrera no.
 */
const LAYOUT = join(__dirname, "app-layout.tsx");

describe("layout que encoge (LEY de responsive)", () => {
  it("el <main> del layout puede encoger: sin min-w-0 la página se desborda", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    // `<main` a principio de etiqueta, no la palabra suelta: el propio
    // comentario del archivo la menciona y agarrarlo daría un falso rojo.
    const main = contenido.split("\n").find((linea) => /<main\s/.test(linea));

    expect(main).toBeDefined();
    expect(main).toContain("min-w-0");
  });

  /**
   * El contenedor de la columna también: es hijo del flex raíz.
   *
   * El selector busca un `<div` con `flex-1` y `flex-col`, no CUALQUIER línea
   * que los tenga: el 2026-08-22 el `<nav>` del menú ganó `flex-1 flex-col`
   * (para poder desplazarse) y, por estar antes en el archivo, se convirtió en
   * el primer match — este test se puso rojo señalando un elemento que no es
   * el que vigila. Un selector que agarra "la primera línea que se parezca"
   * mide lo que encuentra, no lo que le importa.
   */
  it("la columna que contiene header y main también encoge", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    const columna = contenido
      .split("\n")
      .find(
        (linea) => /<div\s/.test(linea) && linea.includes("flex-1") && linea.includes("flex-col"),
      );

    expect(columna).toBeDefined();
    expect(columna).toContain("min-w-0");
  });

  /**
   * BLINDAJE, no diagnóstico. Carlos reportó que la página entera se desliza
   * de lado en su celular; se midió la estructura a 390 px con el CSS real y
   * NO se reprodujo, así que el elemento culpable sigue sin identificarse.
   *
   * En vez de un cuarto intento a ciegas, `overflow-x-hidden` en el `<main>`
   * hace la clase entera IMPOSIBLE: pase lo que pase adentro, la página no
   * arrastra el menú de lado. Es seguro porque todo lo ancho que tenemos
   * (las tablas) ya vive en su propia caja con scroll — nada queda
   * inaccesible, solo deja de empujar.
   */
  it("el <main> no deja que la página se deslice de lado", () => {
    const contenido = readFileSync(LAYOUT, "utf-8");
    const main = contenido.split("\n").find((linea) => /<main\s/.test(linea));

    expect(main).toContain("overflow-x-hidden");
  });
});
