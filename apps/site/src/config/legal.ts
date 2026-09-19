// F11-SITE-LEGAL-01 — las dos páginas legales y su dirección en cada idioma.
// La dirección es algo que la persona LEE (y que se comparte), así que va en su
// idioma: `/es-mx/privacidad/`, `/en-us/privacy/`, `/fr-ca/confidentialite/`.
import { getLocale, type Language, type Route } from "./markets";

export const LEGAL_DOCS = ["privacy", "terms"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_SLUGS: Record<Language, Record<LegalDoc, string>> = {
  es: { privacy: "privacidad", terms: "terminos" },
  en: { privacy: "privacy", terms: "terms" },
  fr: { privacy: "confidentialite", terms: "conditions" },
};

export function legalPath(route: Route, doc: LegalDoc): string {
  return `/${route}/${LEGAL_SLUGS[getLocale(route).language][doc]}/`;
}
