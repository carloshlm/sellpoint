// F11-SITE-LEAD-07 — la lógica del formulario de interés, sin navegador: qué
// plan llega elegido, qué está mal llenado y qué se le manda al API. El guion
// del formulario solo lee el DOM y llama a estas funciones.
import { getLocale, type Route } from "../config/markets";

/** Los planes que el formulario ofrece (CONTENIDO §9). */
export const LEAD_PLANS = ["basic", "pro", "plus", "custom", "undecided"] as const;
export type LeadPlan = (typeof LEAD_PLANS)[number];

/** El plan que dejó elegido el botón de una tarjeta (`?plan=pro#contact`). */
export function planFromSearch(search: string): LeadPlan | null {
  const plan = new URLSearchParams(search).get("plan");
  return (LEAD_PLANS as readonly string[]).includes(plan ?? "") ? (plan as LeadPlan) : null;
}

export interface LeadFields {
  name: string;
  email: string;
  country: string;
  plan: string;
  businessType: string;
  message: string;
  consent: boolean;
  /** El campo trampa: una persona no lo ve; un robot lo llena. */
  website: string;
}

export type LeadErrorKind = "required" | "email" | "consent";
export type LeadErrors = Partial<Record<"name" | "email" | "consent", LeadErrorKind>>;

/** Lo mínimo para no mandar basura. La validación de verdad es la del API. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLead(fields: LeadFields): LeadErrors {
  const errors: LeadErrors = {};
  if (fields.name.trim() === "") errors.name = "required";
  const email = fields.email.trim();
  if (email === "") errors.email = "required";
  else if (!EMAIL.test(email)) errors.email = "email";
  if (!fields.consent) errors.consent = "consent";
  return errors;
}

export interface LeadContext {
  route: Route;
  sourceUrl: string;
  /** El texto EXACTO de la casilla que la persona aceptó (lo pide CASL). */
  consentText: string;
  /** Milisegundos entre cargar la página y enviar: un robot tarda casi cero. */
  elapsedMs: number;
}

export function buildLeadPayload(fields: LeadFields, context: LeadContext) {
  const businessType = fields.businessType.trim();
  const message = fields.message.trim();
  return {
    name: fields.name.trim(),
    email: fields.email.trim(),
    country: fields.country,
    locale: getLocale(context.route).language,
    route: context.route,
    planInterest: fields.plan,
    ...(businessType ? { businessType } : {}),
    ...(message ? { message } : {}),
    consent: fields.consent,
    consentText: context.consentText,
    sourceUrl: context.sourceUrl,
    website: fields.website,
    elapsedMs: Math.round(context.elapsedMs),
  };
}
