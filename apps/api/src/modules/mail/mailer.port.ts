// Puerto de envío de mail (f1-auth AD-9). Todo lo que tiene un proveedor
// externo se inyecta por token — cero `new ResendClient()` esparcido por el
// dominio. El envío es SIEMPRE best-effort en F1: quien llama a `send()` lo
// hace después del commit de la transacción de dominio, con `.catch()` que
// loguea (la cola con reintentos es F6).
export const MAILER = Symbol("MAILER");

// F7: "payment-received" entra con F7-CORE-04 (lo dispara recordPayment);
// los 5 avisos del cron de billing llegan con F7-MAIL-01.
export type MailTemplate =
  | "verify-email"
  | "reset-password"
  | "invite-user"
  | "payment-received"
  | "trial-ending"
  | "trial-ended"
  | "payment-due-soon"
  | "payment-past-due"
  | "plan-downgraded"
  // F7-CONTACT: «escríbenos para activar tu plan» — al backoffice y el acuse al negocio.
  | "plan-request"
  | "plan-request-received"
  // F11-SITE-LEAD-04/05: el sitio público. `site-lead` avisa al backoffice (en
  // español, que es su idioma) y `site-lead-reply` le contesta al prospecto en
  // el suyo — que puede ser francés, ver `MailLocale`.
  | "site-lead"
  | "site-lead-reply";

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
