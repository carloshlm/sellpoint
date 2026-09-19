// A dónde le habla el sitio al API propio: el formulario (`/public/leads`) y la
// medición (`/public/site-events`). Sin terceros: son endpoints del mismo API
// que ya corre la aplicación (Carlos, 2026-09-18).
//
// MISMO ORIGEN, a propósito: el sitio llama a `/api/public/…` en su propio
// dominio y el vhost del apex reenvía SOLO ese prefijo al API (INFRA-02). Así
// no hay CORS ni preflight, y el apex no entra a `CORS_ORIGINS` — donde
// ganaría permiso para hablarle a `/auth/*` con cookies, que no necesita.
//
// `PUBLIC_SITE_API_URL` lo cambia al construir: un API local
// (`http://localhost:3000`, que sí acepta `http://localhost:4321` por CORS) o
// un sandbox sin ese reenvío.
const API_URL = (import.meta.env.PUBLIC_SITE_API_URL ?? "/api").replace(/\/$/, "");

export const LEADS_URL = `${API_URL}/public/leads`;
export const SITE_EVENTS_URL = `${API_URL}/public/site-events`;
