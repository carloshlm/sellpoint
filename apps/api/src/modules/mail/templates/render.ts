import type { I18nService } from "nestjs-i18n";
import type { MailTemplate } from "../mailer.port";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
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
  // F7-CORE-04: el recibo del pago manual registrado por el backoffice.
  "payment-received": "emails.paymentReceived",
  // F7-MAIL-01: los avisos del ciclo de cobro (los dispara el cron diario).
  "trial-ending": "emails.trialEnding",
  "trial-ended": "emails.trialEnded",
  "payment-due-soon": "emails.paymentDueSoon",
  "payment-past-due": "emails.paymentPastDue",
  "plan-downgraded": "emails.planDowngraded",
};

// El azul primario de la marca, FIJO en hex a propósito: un correo se lee en
// clientes que no conocen oklch() ni los tokens del tema, y además es correo
// de SellPoint (la marca), no del tenant — los temas del wizard no lo tocan.
// Es la conversión sRGB de --primary (oklch(0.5164 0.2229 264.63)).
const BRAND_BLUE = "#2456e5";

// `firstName` lo escribe el usuario al registrarse: sin esto, un nombre con
// HTML viviría dentro del correo como markup real.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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
  const linkFallback = i18n.translate("emails.linkFallback", { lang: locale, args: vars });

  const text = [greeting, body, vars.link, cta, expiry].filter(Boolean).join("\n\n");

  // La versión HTML (Carlos, 2026-08-25): el CTA como botón azul centrado y
  // el enlace COPIABLE como alternativa — hay clientes que bloquean botones y
  // gente que desconfía de ellos; las dos puertas llevan al mismo lugar. El
  // texto plano de arriba viaja igual como fallback del cliente de correo.
  //
  // Todo inline y en tablas de una celda: los clientes de correo no cargan
  // CSS externo y varios ignoran <div> con estilos. Los textos van escapados:
  // vienen de i18n pero interpolan datos del usuario (firstName).
  const link = vars.link ?? "";
  const html = [
    `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2430;">`,
    greeting ? `<p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>` : "",
    body ? `<p style="margin:0 0 24px;">${escapeHtml(body)}</p>` : "",
    link && cta
      ? `<table role="presentation" style="margin:0 auto 24px;border-collapse:collapse;"><tr><td style="border-radius:8px;background-color:${BRAND_BLUE};">` +
        `<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 28px;border-radius:8px;background-color:${BRAND_BLUE};color:#ffffff;font-weight:600;text-decoration:none;">${escapeHtml(cta)}</a>` +
        `</td></tr></table>`
      : "",
    link
      ? `<p style="margin:0 0 8px;color:#5b6472;font-size:13px;">${escapeHtml(linkFallback)}</p>` +
        `<p style="margin:0 0 24px;word-break:break-all;font-size:13px;"><a href="${escapeHtml(link)}" style="color:${BRAND_BLUE};">${escapeHtml(link)}</a></p>`
      : "",
    expiry ? `<p style="margin:0;color:#5b6472;font-size:13px;">${escapeHtml(expiry)}</p>` : "",
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, text, html };
}
