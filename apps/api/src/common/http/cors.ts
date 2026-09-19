import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/**
 * El prefijo de los endpoints que consume el SITIO público, y solo él.
 * `/api` va contemplado porque nginx sirve la aplicación bajo ese prefijo y
 * no siempre lo quita antes de llegar al proceso.
 */
const PUBLIC_SITE_PREFIXES = ["/public/", "/api/public/"];

export function isPublicSitePath(url: string | undefined): boolean {
  if (typeof url !== "string") {
    return false;
  }
  const path = url.split("?")[0] ?? "";
  // Con la barra final a propósito: `/publicidad` no puede colarse por
  // parecerse a `/public`.
  return PUBLIC_SITE_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));
}

/**
 * F11-SITE-LEAD-06 — CORS por RUTA, no uno solo para toda la app.
 *
 * `sellpointy.com` y `app.sellpointy.com` son orígenes distintos, así que el
 * formulario del sitio necesita entrar por CORS. Lo que se acota es cuánto se
 * le concede: los dos endpoints de `/public/*` no leen ni escriben la cookie
 * de refresh, así que van **sin credenciales** y solo con `POST`/`OPTIONS`.
 * Todo lo demás conserva exactamente el trato de siempre (credenciales sí,
 * `Content-Disposition` expuesto para las descargas).
 *
 * La lista de orígenes sigue siendo UNA, `CORS_ORIGINS`: separar «los del
 * sitio» de «los de la aplicación» pediría una segunda variable de entorno y
 * una segunda lista que mantener igual a la primera. Lo que sí se gana con
 * este acotado es que un origen del sitio no puede hacer peticiones con
 * cookies contra `/auth/*` — y eso es lo que importaba.
 */
export function resolveCorsOptions(url: string | undefined, origins: string[]): CorsOptions {
  if (isPublicSitePath(url)) {
    return { origin: origins, credentials: false, methods: ["POST", "OPTIONS"] };
  }

  return {
    origin: origins,
    // La SPA necesita mandar/recibir la cookie `sp_refresh` en peticiones a
    // `/api/auth/*` (design AD-5).
    credentials: true,
    // El nombre del archivo que se descarga lo decide el API (en el idioma
    // del usuario); el web lo lee de este encabezado.
    exposedHeaders: ["Content-Disposition"],
  };
}
