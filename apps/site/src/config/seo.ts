// F11-SITE-SEO-01 — las direcciones completas del sitio y las parejas por
// idioma que declara cada página (`hreflang`).
import { DEFAULT_ROUTE, ROUTES, type Route } from "./markets";

/** El mismo valor que `site` en `astro.config.ts`. Sin barra al final. */
export const SITE_URL = "https://sellpointy.com";

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`;

/** La misma página en cada versión: `{ "es-mx": "/es-mx/", … }`. */
export type Alternates = Record<Route, string>;

export const HOME_ALTERNATES = Object.fromEntries(
  ROUTES.map((route) => [route, `/${route}/`]),
) as Alternates;

/**
 * Lo que Google enseña a quien no encaja en ninguna versión: para la portada,
 * la raíz —que sirve la versión de México (Carlos, 2026-09-18)—.
 */
export const HOME_X_DEFAULT = "/";

export { DEFAULT_ROUTE };
