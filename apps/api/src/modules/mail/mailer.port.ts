// Puerto de envío de mail (f1-auth AD-9). Todo lo que tiene un proveedor
// externo se inyecta por token — cero `new ResendClient()` esparcido por el
// dominio. El envío es SIEMPRE best-effort en F1: quien llama a `send()` lo
// hace después del commit de la transacción de dominio, con `.catch()` que
// loguea (la cola con reintentos es F6).
export const MAILER = Symbol("MAILER");

// F7: "payment-received" entra con F7-CORE-04 (lo dispara recordPayment);
// los 5 avisos del cron de billing llegan con F7-MAIL-01.
export type MailTemplate = "verify-email" | "reset-password" | "invite-user" | "payment-received";

export interface MailMessage {
  to: string;
  template: MailTemplate;
  vars: Record<string, string>;
  locale: "es" | "en";
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}
