import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";

/** «a, B ,c» → ["a", "b", "c"]. El mismo parseo para las dos listas. */
function parseEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email: string) => email.trim().toLowerCase())
    .filter((email: string) => email.length > 0);
}

/**
 * `BILLING_ADMIN_EMAILS` → QUIÉN PUEDE ENTRAR al backoffice: la segunda llave
 * del `PlatformAdminGuard` (F7-ADMIN-01), que se compara contra el correo con el
 * que la persona inicia sesión. Es una lista de IDENTIDADES.
 *
 * Hasta el 2026-09-19 también era la lista de a quién se le avisa; ese trabajo
 * pasó a `platformNotifyEmails` (ver abajo).
 */
export function platformAdminEmails(configService: ConfigService<Env, true>): string[] {
  return parseEmails(configService.get("BILLING_ADMIN_EMAILS", { infer: true }));
}

/**
 * `PLATFORM_NOTIFY_EMAILS` → A QUIÉN SE LE AVISA: «quiero activar mi plan»
 * (`BillingService.requestPlan`) y «alguien escribió desde el sitio»
 * (`SiteLeadsService`, F11-SITE-LEAD-04). Es una lista de BUZONES.
 *
 * Carlos (2026-09-19): los avisos van a `contact@sellpointy.com`, pero él sigue
 * entrando con su correo personal. Mientras las dos preguntas tuvieron la misma
 * respuesta, una variable alcanzó; una sola lista obligaba a elegir entre
 * recibir los avisos en el correo personal o perder el acceso al backoffice.
 * Separadas, además, el día que atienda otra persona se le mandan los avisos
 * SIN darle la llave del backoffice.
 *
 * Vacía o ausente, cae en `BILLING_ADMIN_EMAILS`: un ambiente que todavía no la
 * define sigue avisando a quien avisaba, nunca a nadie.
 */
export function platformNotifyEmails(configService: ConfigService<Env, true>): string[] {
  const notify = parseEmails(configService.get("PLATFORM_NOTIFY_EMAILS", { infer: true }));
  return notify.length > 0 ? notify : platformAdminEmails(configService);
}
