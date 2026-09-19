// El texto MAESTRO del sitio: español neutro, de tú (SITIO-WEB-CONTENIDO.md §4).
// Los demás idiomas se comparan contra este archivo: `test/i18n.test.ts` falla
// si a alguno le falta —o le sobra— una clave.
//
// Las claves van en inglés; el valor, en el idioma de quien lo lee. Aquí va lo
// que comparten todas las versiones en español; lo que cambia de un país a
// otro vive en `../overrides.ts`.
export const es = {
  meta: {
    title: "SellPointy — Punto de venta, inventario y compras en un solo lugar",
    description:
      "Vende, controla tu inventario y compra mejor desde una sola pantalla, sin instalar nada. Pruébalo 14 días con todas las funciones, sin tarjeta.",
  },
  a11y: {
    skipToContent: "Saltar al contenido",
  },
  nav: {
    label: "Principal",
    home: "SellPointy, ir al inicio",
    whatItDoes: "Qué hace",
    benefits: "Beneficios",
    plans: "Planes",
    faq: "Preguntas",
    login: "Iniciar sesión",
    cta: "Empieza gratis",
  },
  hero: {
    // Un renglón por elemento. El último termina en el punto amarillo, que
    // reemplaza al punto tipográfico: por eso ninguno lo lleva escrito.
    headline: ["Tus ventas son el punto"],
    lead: "Punto de venta, inventario y compras en un solo lugar. Escanea, cobra y lleva el control de tu negocio desde la caja o desde tu celular.",
    primaryCta: "Empieza gratis",
    secondaryCta: "Ver qué hace",
    trustLine: "14 días con todas las funciones. Sin tarjeta y sin instalar nada.",
  },
  footer: {
    tagline: "Tus ventas son el punto.",
  },
};

/** La forma que todo idioma tiene que cumplir: la del maestro, con texto libre. */
type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? string[]
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof es>;
