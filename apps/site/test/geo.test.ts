import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, getLocale, LANGUAGE_NAMES, ROUTES } from "../src/config/markets";
import { getMessages } from "../src/i18n";
import { readDist, scriptsOf } from "./dist";

// F11-SITE-GEO-02 y GEO-03 — lo que llega al navegador, leído del sitio construido.

const PAGES = ["index.html", ...ROUTES.map((route) => `${route}/index.html`)];
const routeOfPage = (page: string) =>
  page === "index.html" ? DEFAULT_ROUTE : (page.split("/")[0] as (typeof ROUTES)[number]);

/** El bloque del selector de una página. */
function switcherOf(html: string): string {
  const match = html.match(/<details[^>]*data-market-switcher[\s\S]*?<\/details>/);
  expect(match, "la página no tiene selector").not.toBeNull();
  return match?.[0] ?? "";
}

/** Los enlaces del selector, con sus atributos. */
function linksOf(switcher: string) {
  return [...switcher.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => {
    const attrs = match[1] as string;
    const attr = (name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return {
      href: attr("href"),
      lang: attr("lang"),
      hreflang: attr("hreflang"),
      current: attr("aria-current"),
      text: (match[2] as string).trim(),
    };
  });
}

describe("el selector de país e idioma (GEO-03)", () => {
  it.each(PAGES)("%s lleva las cinco versiones, en su propio idioma", (page) => {
    const links = linksOf(switcherOf(readDist(page)));
    expect(links.map((link) => link.href).sort()).toEqual(ROUTES.map((r) => `/${r}/`).sort());
    for (const link of links) {
      const locale = getLocale(link.href?.replaceAll("/", "") as (typeof ROUTES)[number]);
      // «Français», no «Francés»: se escribe como lo lee quien lo busca…
      expect(link.text).toBe(LANGUAGE_NAMES[locale.language]);
      // …y el lector de pantalla lo pronuncia en ese idioma.
      expect(link.lang).toBe(locale.htmlLang);
      expect(link.hreflang).toBe(locale.htmlLang);
    }
  });

  it.each(PAGES)("%s marca como actual la versión que se está viendo", (page) => {
    const current = linksOf(switcherOf(readDist(page))).filter((link) => link.current === "page");
    expect(current.map((link) => link.href)).toEqual([`/${routeOfPage(page)}/`]);
  });

  it.each(PAGES)("%s nombra los países en el idioma de la página", (page) => {
    const switcher = switcherOf(readDist(page));
    for (const name of Object.values(getMessages(routeOfPage(page)).markets)) {
      expect(switcher).toContain(name);
    }
  });

  it("sin banderas: una bandera es un país, no un idioma", () => {
    for (const page of PAGES) {
      expect(switcherOf(readDist(page)), page).not.toMatch(/\p{Regional_Indicator}/u);
    }
  });

  it("funciona sin JavaScript: es un <details> con enlaces de verdad", () => {
    // Se abre con el teclado, el lector de pantalla anuncia si está abierto, y
    // cada idioma es una URL que se puede compartir.
    const switcher = switcherOf(readDist("es-mx/index.html"));
    expect(switcher).toMatch(/<summary\b/);
  });
});

describe("el aviso «¿Estás en…?» (GEO-02)", () => {
  const root = readDist("index.html");
  const notices = [...root.matchAll(/<aside\b[^>]*data-route="([^"]+)"[^>]*>([\s\S]*?)<\/aside>/g)];

  it("la raíz trae un aviso por cada OTRA versión, escondido hasta que el guion decida", () => {
    const others = ROUTES.filter((route) => route !== DEFAULT_ROUTE);
    expect(notices.map((match) => match[1]).sort()).toEqual([...others].sort());
    for (const match of notices) expect(match[0]).toMatch(/\bhidden\b/);
  });

  it("cada aviso habla el idioma de la versión que ofrece y enlaza a ella", () => {
    // A un canadiense que llega a la versión mexicana no se le pregunta en español.
    for (const match of notices) {
      const route = match[1] as (typeof ROUTES)[number];
      const { market, htmlLang } = getLocale(route);
      const { notice } = getMessages(route).geo;
      const aside = match[0];
      expect(aside).toContain(`lang="${htmlLang}"`);
      expect(aside).toContain(`href="/${route}/"`);
      expect(aside).toContain(notice.question[market]);
      expect(aside).toContain(notice.link[market]);
      expect(aside).toContain(`aria-label="${notice.close}"`);
    }
  });

  it("el aviso no cambia la página: vive fuera de <main>", () => {
    // Es la misma versión mexicana que `/es-mx/` (lo compara pages.test.ts).
    const main = root.slice(root.indexOf("<main"), root.indexOf("</main>"));
    expect(main).not.toContain("data-market-notice");
  });

  it.each(ROUTES)("/%s/ no lleva aviso: quien abrió esa URL ya eligió", (route) => {
    expect(readDist(`${route}/index.html`)).not.toContain("data-market-notice");
  });

  /**
   * GEO-05 (Carlos, 2026-09-19): la raíz SÍ manda sola a la versión del
   * visitante, pero con guantes. Lo que esta barrera cuida es que siga siendo
   * una decisión de `decideAutoRoute` —con sus tres frenos— y no un redirect
   * a secas: nada de `http-equiv="refresh"`, que se dispara antes de que
   * corra guion alguno y se lleva por delante al robot de Google y a quien ya
   * eligió; y `replace` y no `assign`, para no encerrar a nadie contra el
   * botón de «atrás».
   */
  it("la raíz manda sola SOLO por `decideAutoRoute`, y con `replace`", () => {
    expect(root).not.toMatch(/http-equiv="refresh"/i);
    const guiones = scriptsOf("index.html");
    const conRedirect = guiones.filter((script) =>
      /location\.(replace|assign)|location\.href\s*=/.test(script),
    );
    expect(conRedirect).toHaveLength(1);
    expect(conRedirect[0]).not.toMatch(/location\.assign|location\.href\s*=/);
    // El empaquetador renombra las funciones, así que la barrera mira las
    // CONDICIONES, que son datos y sobreviven al minificado: lo guardado, la
    // sugerencia y la confianza en la zona horaria tienen que entrar las tres
    // en la decisión, y el destino tiene que ser el que ella devuelve.
    expect(conRedirect[0]).toMatch(/saved:/);
    expect(conRedirect[0]).toMatch(/confident:/);
    expect(conRedirect[0]).toMatch(/location\.replace\(`\/\$\{\w+\}\/`\)/);
  });

  it.each(ROUTES)("/%s/ NO manda a nadie a ningún lado: ahí ya se eligió", (route) => {
    for (const script of scriptsOf(`${route}/index.html`)) {
      expect(script).not.toMatch(/location\.(replace|assign)|location\.href\s*=/);
    }
  });
});
