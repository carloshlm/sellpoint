import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: un link del menú que es PREFIJO de otro exige `exact`.
 *
 * **El porqué, medido en producción (2026-08-22):** estando en `/pos/quotes`
 * quedaban DOS items resaltados a la vez — «Venta» y «Cotización». TanStack
 * Router marca un `<Link>` como activo cuando la ruta actual *empieza* con su
 * destino, así que `/pos` se enciende también en `/pos/quotes`, `/pos/sales` y
 * `/pos/close`. Dos items resaltados no es solo feo: el menú deja de responder
 * la única pregunta que tiene que responder, «¿dónde estoy?».
 *
 * **Por qué la barrera mira la CLASE y no el caso:** hoy el único link-prefijo
 * es `/pos`, y arreglar solo esa línea dejaría la trampa armada para el
 * siguiente grupo con hub e hijos. Este test deriva la lista de infractores del
 * archivo mismo: agrega mañana `/reports` junto a `/reports/stock` y se pone
 * rojo solo, sin que nadie tenga que acordarse.
 *
 * Es un test de FUENTE porque lo que se protege es una prop de configuración
 * del router, no un resultado de layout. Mismo molde que
 * `tablas-responsivas.test.ts` y `menu-desplazable.test.ts`.
 */
const LAYOUT = join(__dirname, "../../components/layout/app-layout.tsx");

interface LinkDelMenu {
  destino: string;
  exacto: boolean;
}

/** Los `<Link>` del layout con su destino y si piden coincidencia exacta. */
function linksDelMenu(): LinkDelMenu[] {
  const fuente = readFileSync(LAYOUT, "utf8");
  const links: LinkDelMenu[] = [];

  // Cada `<Link …>`: se corta en el `>` que cierra la etiqueta de apertura.
  for (const trozo of fuente.split("<Link").slice(1)) {
    const apertura = trozo.slice(0, trozo.indexOf(">"));
    const destino = /\bto="([^"]+)"/.exec(apertura)?.[1];
    if (destino === undefined) {
      continue;
    }
    links.push({ destino, exacto: apertura.includes("activeOptions") });
  }

  return links;
}

describe("resaltado del menú (LEY de navegación)", () => {
  it("encuentra los links del menú (la barrera no se salta por un parseo vacío)", () => {
    // Sin esto, cambiar la forma de escribir los links dejaría la lista vacía y
    // el test de abajo pasaría por no tener nada que revisar — la peor clase de
    // test verde.
    expect(linksDelMenu().length).toBeGreaterThan(10);
  });

  it("todo link que es PREFIJO de otro pide coincidencia exacta", () => {
    const links = linksDelMenu();
    const destinos = links.map((l) => l.destino);

    const infractores = links
      .filter((l) =>
        destinos.some((otro) => otro !== l.destino && otro.startsWith(`${l.destino}/`)),
      )
      .filter((l) => !l.exacto)
      .map((l) => l.destino);

    // El objeto y no el array pelado: el diff NOMBRA el problema además de
    // listar las rutas (idioma de la casa para barreras en Jest y Vitest).
    expect({ sinActiveOptionsExact: infractores }).toEqual({ sinActiveOptionsExact: [] });
  });
});
