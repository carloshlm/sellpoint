// F11-SITE-SEO-02 — el sitemap, con las alternativas por idioma de cada página.
// Escrito a mano y no con una integración: son quince direcciones que salen de
// la matriz, y así no entra una dependencia más.
//
// La raíz `/` NO va: sirve lo mismo que `/es-mx/` y listarla sería ofrecerle a
// Google la misma página dos veces.
import type { APIRoute } from "astro";
import { LEGAL_DOCS, legalPath } from "../config/legal";
import { getLocale, ROUTES, type Route } from "../config/markets";
import { UNDER_CONSTRUCTION } from "../config/mode";
import { absoluteUrl } from "../config/seo";

/** Cada «página» es un grupo: la misma en sus cinco versiones. */
const groups: ((route: Route) => string)[] = [
  (route) => `/${route}/`,
  ...LEGAL_DOCS.map((doc) => (route: Route) => legalPath(route, doc)),
];

export const GET: APIRoute = () => {
  const urls = (UNDER_CONSTRUCTION ? [] : groups).flatMap((pathOf) =>
    ROUTES.map((route) => {
      const alternates = ROUTES.map(
        (other) =>
          `    <xhtml:link rel="alternate" hreflang="${getLocale(other).htmlLang}" href="${absoluteUrl(pathOf(other))}"/>`,
      ).join("\n");
      return `  <url>\n    <loc>${absoluteUrl(pathOf(route))}</loc>\n${alternates}\n  </url>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
