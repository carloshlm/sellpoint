import { getLocale, type Language, type Route } from "../config/markets";
import { en } from "./locales/en";
import { es, type Messages } from "./locales/es";
import { fr } from "./locales/fr";
import { ROUTE_OVERRIDES } from "./overrides";

export type { Messages } from "./locales/es";
export { ROUTE_OVERRIDES } from "./overrides";

export const LOCALE_MESSAGES: Record<Language, Messages> = { es, en, fr };

/** Mezcla `patch` sobre `base` en un objeto NUEVO. Las listas se reemplazan enteras. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return patch as T;
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged as T;
}

/**
 * Los textos de una ruta: los de su idioma, con los ajustes de su mercado
 * encima. Siempre un objeto nuevo: un ajuste jamás se filtra al idioma base.
 */
export function getMessages(route: Route): Messages {
  return deepMerge(LOCALE_MESSAGES[getLocale(route).language], ROUTE_OVERRIDES[route] ?? {});
}
