// Puerto de envío de mail (f1-auth AD-9). Todo lo que tiene un proveedor
// externo se inyecta por token — cero `new ResendClient()` esparcido por el
// dominio. El envío es SIEMPRE best-effort en F1: quien llama a `send()` lo
// hace después del commit de la transacción de dominio, con `.catch()` que
// loguea (la cola con reintentos es F6).
export const MAILER = Symbol("MAILER");

/**
 * F11-SITE-LEGAL-04 — los correos TRANSACCIONALES: los que salen porque algo
 * pasó en la cuenta de quien los recibe.
 *
 * NO llevan pie comercial ni enlace de baja, y eso no es un descuido: nadie
 * puede darse de baja de que le avisen que su servicio vence o que alguien
 * pidió restablecer su contraseña. Ensuciarlos con un pie legal los haría
 * menos claros, no más honestos.
 *
 * `site-lead` está acá y no entre los comerciales porque lo lee el BACKOFFICE
 * —somos nosotros avisándonos de un prospecto—, no el prospecto.
 *
 * F7: "payment-received" entra con F7-CORE-04 (lo dispara recordPayment);
 * los 5 avisos del cron de billing llegan con F7-MAIL-01.
 */
export const TRANSACTIONAL_MAIL_TEMPLATES = [
  "verify-email",
  "reset-password",
  "invite-user",
  "payment-received",
  "trial-ending",
  "trial-ended",
  "payment-due-soon",
  "payment-past-due",
  "plan-downgraded",
  // F7-CONTACT: «escríbenos para activar tu plan» — al backoffice y el acuse al negocio.
  "plan-request",
  "plan-request-received",
  // F11-SITE-LEAD-04: el aviso INTERNO de un prospecto, en español porque es el
  // idioma de quien lo lee.
  "site-lead",
] as const;

/**
 * F11-SITE-LEGAL-04 — los correos COMERCIALES: los que salen a promocionar
 * SellPointy a alguien que todavía no es cliente.
 *
 * ⚠️ AGREGAR UNA PLANTILLA ACÁ TIENE CONSECUENCIAS, y ese es el punto. Toda
 * plantilla de esta lista está OBLIGADA a llevar su pie —quién envía y cómo
 * dejar de recibir— y `renderMailTemplate` la rechaza si le falta el enlace de
 * baja. La lista es una tupla `as const` y no un booleano suelto para que
 * `render.spec.ts` pueda recorrerla: una plantilla comercial nueva queda
 * cubierta por las pruebas sin escribir una sola línea de test.
 *
 * Hoy hay UNA: la respuesta automática al prospecto del sitio (F11-SITE-LEAD-05).
 */
export const COMMERCIAL_MAIL_TEMPLATES = ["site-lead-reply"] as const;

export type TransactionalMailTemplate = (typeof TRANSACTIONAL_MAIL_TEMPLATES)[number];
export type CommercialMailTemplate = (typeof COMMERCIAL_MAIL_TEMPLATES)[number];
export type MailTemplate = TransactionalMailTemplate | CommercialMailTemplate;

const COMMERCIAL_SET = new Set<string>(COMMERCIAL_MAIL_TEMPLATES);

/** El único lugar que decide si un correo lleva pie comercial. */
export function isCommercialTemplate(template: MailTemplate): template is CommercialMailTemplate {
  return COMMERCIAL_SET.has(template);
}

/**
 * El idioma de un correo. Incluye `fr` SOLO por `site-lead-reply`: el sitio
 * público habla tres idiomas y la aplicación dos (`SUPPORTED_LOCALES`). No se
 * fusionan: `fr` no es un idioma de la aplicación, y el único JSON que existe
 * en `src/i18n/fr/` es `emails.json` con las claves del sitio — cualquier otra
 * clave pedida en francés cae al idioma de respaldo, que es el comportamiento
 * normal de nestjs-i18n.
 */
export type MailLocale = "es" | "en" | "fr";

export interface MailMessage {
  to: string;
  template: MailTemplate;
  /**
   * F11-SITE-LEGAL-04: una plantilla COMERCIAL exige acá un `unsubscribeUrl`
   * — `renderMailTemplate` la rechaza sin él. No está en el tipo como campo
   * obligatorio porque `vars` es el mismo saco para las catorce plantillas;
   * la obligación vive donde se puede verificar de verdad, en el render.
   */
  vars: Record<string, string>;
  locale: MailLocale;
  /**
   * F11-SITE-LEAD-04: a quién le contesta el clic de «Responder». Hoy lo usa
   * solo el aviso de un prospecto del sitio —para contestarle sin copiar el
   * correo a mano—, y por eso es opcional: un `reply_to` vacío en el resto de
   * los mensajes sería ruido que Resend además rechaza.
   */
  replyTo?: string;
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}
