import { getLocale, type Language, type Route } from "../config/markets";
import { en } from "./locales/en";
import { es, type Messages } from "./locales/es";
import { fr } from "./locales/fr";
import { ROUTE_OVERRIDES } from "./overrides";

export type { Messages } from "./locales/es";
export { ROUTE_OVERRIDES } from "./overrides";

export const LOCALE_MESSAGES: Record<Language, Messages> = { es, en, fr };

/** Los textos de una ruta: los de su idioma, con los ajustes de su mercado encima. */
export function getMessages(route: Route): Messages {
  const base = LOCALE_MESSAGES[getLocale(route).language];
  const overrides = ROUTE_OVERRIDES[route] ?? {};
  // Dos niveles —sección y clave— alcanzan: los textos no anidan más que eso.
  // Se arma un objeto nuevo para que un ajuste jamás se filtre al idioma base.
  const merged = { ...base } as Record<string, unknown>;
  for (const [section, values] of Object.entries(overrides)) {
    merged[section] = { ...(base[section as keyof Messages] as object), ...values };
  }
  return merged as Messages;
}
