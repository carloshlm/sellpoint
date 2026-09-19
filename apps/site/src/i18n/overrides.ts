import type { Route } from "../config/markets";
import type { Messages } from "./locales/es";

/** Un recorte de los textos: solo las claves que una ruta quiere cambiar. */
export type MessageOverrides = {
  [K in keyof Messages]?: Partial<Messages[K]>;
};

// Lo que una RUTA dice distinto de su idioma base. Cada mercado tiene SUS
// textos y no una traducción: en México se compite contra la libreta; en
// Canadá, contra el precio de los sistemas grandes (SITIO-WEB-CONTENIDO.md §1).
//
// `es-mx` y `en-us` son la base de su idioma y por eso no aparecen. `fr-ca` es
// hoy la única versión en francés.
export const ROUTE_OVERRIDES: Partial<Record<Route, MessageOverrides>> = {
  "es-us": {
    meta: {
      description:
        "Punto de venta e inventario de verdad en un solo lugar, en español o en inglés, a un precio que un negocio pequeño sí puede pagar. 14 días con todas las funciones, sin tarjeta.",
    },
  },
  "en-ca": {
    meta: {
      description:
        "The point of sale with serious inventory — lots, expiry dates and multiple warehouses — without the enterprise price. Try every feature for 14 days. No credit card.",
    },
  },
};
