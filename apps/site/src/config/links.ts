/** El nombre de la marca. No se traduce, y por eso no vive en los textos. */
export const BRAND_NAME = "SellPointy";

// A dónde llevan las dos puertas de la aplicación (SITIO-WEB-CONTENIDO.md §0 y §2).
const APP_ORIGIN = "https://app.sellpointy.com";

/** «Empieza gratis»: la acción principal del sitio. */
export const APP_REGISTER_URL = `${APP_ORIGIN}/register`;
/** «Iniciar sesión»: los clientes actuales teclean sellpointy.com por costumbre. */
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;

/** Las anclas de la página. En inglés, como todo identificador. */
export const ANCHORS = {
  main: "main",
  whatItDoes: "what-it-does",
  benefits: "benefits",
  plans: "plans",
  faq: "faq",
  contact: "contact",
} as const;
