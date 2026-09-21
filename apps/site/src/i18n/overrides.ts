import type { Route } from "../config/markets";
import type { Messages } from "./locales/es";

/** Un recorte de los textos, a cualquier profundidad. Las listas se reemplazan enteras. */
type DeepPartial<T> = T extends string[]
  ? string[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type MessageOverrides = DeepPartial<Messages>;

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
    hero: {
      mock: {
        items: {
          first: { name: "Agua de manantial 1 L" },
          // En Estados Unidos el mostrador pesa en onzas.
          second: { detail: "8 oz" },
          third: { name: "Aceite de oliva 17 fl oz" },
        },
      },
    },
    benefits: {
      items: {
        catalog: {
          // «De un jalón» es muy mexicano (§4.3).
          text: "Escanea el código y SellPointy reconoce el producto y te sugiere su nombre; tú solo pones el precio. ¿Ya lo tienes en Excel? Súbelo de una vez.",
        },
      },
    },
    whoFor: {
      // Los giros de Estados Unidos (§7.3), en español: sin farmacias, con
      // mercados latinos.
      trades: [
        "Tiendas de abarrotes",
        "Restaurantes",
        "Tiendas de conveniencia",
        "Mercados latinos",
        "Ferreterías",
        "Tiendas de regalos",
        "Boutiques",
        "Refaccionarias",
        "Panaderías",
        "Cafeterías",
        "Dulcerías",
        "Tiendas naturistas",
        "Tiendas para mascotas",
      ],
    },
  },
  "en-ca": {
    meta: {
      description:
        "The point of sale with serious inventory — lots, expiry dates and multiple stores — without the enterprise price. Try every feature for 14 days. No credit card.",
    },
    hero: {
      mock: {
        items: {
          // Canadá es métrico.
          second: { detail: "250 g" },
          third: { name: "Olive oil 500 mL" },
        },
      },
    },
    benefits: {
      items: {
        // Ortografía canadiense: «catalogue» (§7.5).
        catalog: {
          title: "Build your catalogue in *one afternoon*.",
        },
      },
    },
    faq: {
      items: {
        data: {
          a: "Yes. Your sales, prices, customers and stock are yours alone: they are never shared or sold. The only thing in common is the barcode catalogue — the name printed on the package — which is what lets you add a product just by scanning it.",
        },
      },
    },
    whoFor: {
      trades: [
        "Convenience stores",
        "Restaurants",
        "Grocery stores",
        "Hardware stores",
        "Health food stores",
        "Gift shops",
        "Boutiques",
        "Pet supplies",
        "Bakeries",
        "Coffee shops",
        "Candy shops",
      ],
    },
  },
};
