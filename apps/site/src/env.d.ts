/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** El API de donde se leen los precios AL CONSTRUIR. Solo hace falta con `showPrices` prendido. */
  readonly SITE_API_URL?: string;
  /** `construction` arma solo la página de «sitio en construcción». */
  readonly SITE_MODE?: string;
  /** La base del API para el formulario y la medición. Por omisión `/api`: mismo origen. */
  readonly PUBLIC_SITE_API_URL?: string;
}
