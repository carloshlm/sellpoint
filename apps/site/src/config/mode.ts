// En qué modo se construye el sitio.
//
// `SITE_MODE=construction` arma UNA sola página —«sitio en construcción»— en
// lugar del sitio completo. Es lo que sirve PRODUCCIÓN mientras los textos
// legales no estén listos (Carlos, 2026-09-19): el apex deja de redirigir a la
// aplicación, pero nadie ve todavía un aviso de privacidad con huecos.
//
// El sitio de ensayo (`website-sandbox.sellpointy.com`) se construye SIN esta
// variable: ahí va el sitio completo.
export const UNDER_CONSTRUCTION = import.meta.env.SITE_MODE === "construction";
