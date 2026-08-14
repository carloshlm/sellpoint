import type { I18nService } from "nestjs-i18n";
import type { MailTemplate } from "../mailer.port";

export interface RenderedMail {
  subject: string;
  text: string;
}

// f1-auth AD-9: subject y cuerpo salen SIEMPRE de i18n/{es,en}/emails.json —
// cero strings hardcodeados acá. `vars.link` ya viene armado por el caller
// con APP_URL (AuthService), nunca un dominio hardcodeado.
const TEMPLATE_KEYS: Record<MailTemplate, string> = {
  "verify-email": "emails.verifyEmail",
  "reset-password": "emails.resetPassword",
  // Gap S1 (f1-rbac): el alta administrativa de un usuario `invited` manda
  // ESTE mail, no el de reset — aunque por debajo reusa el mismo
  // PasswordResetToken. Quien lo recibe no pidió nada: el texto tiene que
  // explicarle que lo dieron de alta y que el link define su PRIMERA
  // contraseña.
  "invite-user": "emails.inviteUser",
};

export function renderMailTemplate(
  i18n: I18nService,
  template: MailTemplate,
  vars: Record<string, string>,
  locale: "es" | "en",
): RenderedMail {
  const key = TEMPLATE_KEYS[template];

  const subject = i18n.translate(`${key}.subject`, { lang: locale, args: vars });
  const greeting = i18n.translate(`${key}.greeting`, { lang: locale, args: vars });
  const body = i18n.translate(`${key}.body`, { lang: locale, args: vars });
  const cta = i18n.translate(`${key}.cta`, { lang: locale, args: vars });
  const expiry = i18n.translate(`${key}.expiry`, { lang: locale, args: vars });

  const text = [greeting, body, vars.link, cta, expiry].filter(Boolean).join("\n\n");

  return { subject, text };
}
