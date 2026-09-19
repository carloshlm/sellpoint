import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getLocale, ROUTES } from "../src/config/markets";
import { FAQ_ORDER } from "../src/config/page";
import { getMessages } from "../src/i18n";
import { DIST, distPages, readDist } from "./dist";

// F11-SITE-SEO-01, 02 y 05 — leído del sitio construido.

const SITE = "https://sellpointy.com";
const urlOf = (page: string) => `${SITE}/${page.replace(/index\.html$/, "")}`;
const indexable = () => distPages().filter((page) => page !== "404.html");
const headOf = (page: string) => {
  const html = readDist(page);
  return html.slice(0, html.indexOf("</head>"));
};
/** `hreflang → href` de una página. */
function alternatesOf(page: string): Map<string, string> {
  const links = [...headOf(page).matchAll(/<link\b[^>]*rel="alternate"[^>]*>/g)].map((m) => m[0]);
  return new Map(
    links.map((link) => [
      link.match(/hreflang="([^"]+)"/)?.[1] ?? "",
      link.match(/href="([^"]+)"/)?.[1] ?? "",
    ]),
  );
}

describe("canónica y hreflang (SEO-01)", () => {
  it("cada página se declara canónica de SÍ MISMA, con la dirección completa", () => {
    for (const page of indexable()) {
      expect(headOf(page), page).toContain(`<link rel="canonical" href="${urlOf(page)}"`);
    }
  });

  it("cada página lista las cinco versiones más x-default", () => {
    const expected = [...ROUTES.map((route) => getLocale(route).htmlLang), "x-default"].sort();
    for (const page of indexable()) {
      expect([...alternatesOf(page).keys()].sort(), page).toEqual(expected);
    }
  });

  it("x-default es la versión de México, servida en la raíz", () => {
    expect(alternatesOf("index.html").get("x-default")).toBe(`${SITE}/`);
    expect(alternatesOf("en-ca/index.html").get("x-default")).toBe(`${SITE}/`);
    // En lo legal, x-default es el documento de la versión mexicana.
    expect(alternatesOf("fr-ca/conditions/index.html").get("x-default")).toBe(
      `${SITE}/es-mx/terminos/`,
    );
  });

  it("el hreflang es RECÍPROCO: si A apunta a B, B existe y apunta de vuelta a A", () => {
    // Es lo que Google exige para hacerle caso: una pareja que no se
    // corresponde se ignora entera.
    const byUrl = new Map(indexable().map((page) => [urlOf(page), page]));
    for (const page of indexable()) {
      for (const [lang, href] of alternatesOf(page)) {
        if (lang === "x-default") continue;
        const target = byUrl.get(href);
        expect(target, `${page} → ${href}`).toBeDefined();
        const back = [...alternatesOf(target as string).values()];
        // La raíz es la misma página que /es-mx/: su pareja de vuelta es /es-mx/.
        const self = page === "index.html" ? urlOf("es-mx/index.html") : urlOf(page);
        expect(back, `${href} no apunta de vuelta a ${page}`).toContain(self);
      }
    }
  });

  it("las etiquetas para compartir llevan la imagen de SU idioma, y la imagen existe", () => {
    for (const route of ROUTES) {
      const head = headOf(`${route}/index.html`);
      const { language } = getLocale(route);
      expect(head).toContain(`<meta property="og:image" content="${SITE}/og/${language}.png"`);
      expect(existsSync(join(DIST, "og", `${language}.png`))).toBe(true);
      expect(head).toContain('<meta property="og:type" content="website"');
      expect(head).toContain(`<meta property="og:url" content="${SITE}/${route}/"`);
      expect(head).toContain('<meta name="twitter:card" content="summary_large_image"');
    }
  });

  it("el sitio ya se deja indexar; la 404, no", () => {
    for (const page of indexable()) expect(headOf(page), page).not.toContain('content="noindex');
    expect(headOf("404.html")).toContain('<meta name="robots" content="noindex"');
  });
});

describe("sitemap, robots y datos estructurados (SEO-02)", () => {
  it("el sitemap lista todas las páginas, cada una con sus alternativas por idioma", () => {
    const xml = readDist("sitemap.xml");
    for (const page of indexable()) {
      if (page === "index.html") continue; // la raíz duplica a /es-mx/: va una sola
      expect(xml, page).toContain(`<loc>${urlOf(page)}</loc>`);
    }
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(`hreflang="fr-CA" href="${SITE}/fr-ca/"`);
    expect(xml).not.toContain("404");
  });

  it("robots.txt deja pasar y dice dónde está el sitemap", () => {
    const robots = readDist("robots.txt");
    expect(robots).toMatch(/User-agent: \*/);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).not.toMatch(/Disallow: \/\s*$/m);
  });

  const ldOf = (page: string) =>
    [...readDist(page).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1] as string),
    );

  it.each([...ROUTES])("/%s/ declara la aplicación y SUS preguntas frecuentes", (route) => {
    const blocks = ldOf(`${route}/index.html`);
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(app?.name).toBe("SellPointy");
    expect(app?.inLanguage).toBe(getLocale(route).htmlLang);
    const { items } = getMessages(route).faq;
    expect(faq?.mainEntity.map((q: { name: string }) => q.name)).toEqual(
      FAQ_ORDER[route].map((id) => items[id].q),
    );
  });

  it("sin `offers` mientras los precios estén apagados", () => {
    // Declararle a Google un precio que la página no enseña es motivo de
    // penalización. El día que se prendan, esta prueba se cambia a propósito.
    for (const route of ROUTES) {
      expect(JSON.stringify(ldOf(`${route}/index.html`))).not.toContain('"offers"');
    }
  });
});

describe("página 404 (SEO-05)", () => {
  it("ofrece la salida al inicio en los tres idiomas y a las cinco versiones", () => {
    const html = readDist("404.html");
    for (const route of ROUTES) expect(html).toContain(`href="/${route}/"`);
    for (const language of ["es", "en", "fr"] as const) {
      const route = language === "es" ? "es-mx" : language === "en" ? "en-us" : "fr-ca";
      // Astro escribe el apóstrofo como entidad en el cuerpo.
      expect(html).toContain(getMessages(route).notFound.title.replace(/'/g, "&#39;"));
    }
  });
});
