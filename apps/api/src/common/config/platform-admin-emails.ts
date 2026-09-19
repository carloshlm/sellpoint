import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";

/**
 * `BILLING_ADMIN_EMAILS` → la lista de los dueños de la plataforma, normalizada.
 *
 * Vive en un solo lugar porque la leen TRES sitios por la misma razón —quién
 * administra los planes— y con el mismo formato:
 *
 *  · `PlatformAdminGuard`, como segunda llave del backoffice (F7-ADMIN-01);
 *  · `BillingService.requestPlan`, para avisar «quiero activar mi plan»;
 *  · `SiteLeadsService`, para avisar que alguien escribió desde el sitio
 *    público (F11-SITE-LEAD-04).
 *
 * Una `LEADS_NOTIFY_EMAIL` aparte sería una segunda lista que mantener igual a
 * la primera: un prospecto del sitio y un cliente que pide plan le llegan a la
 * misma persona.
 */
export function platformAdminEmails(configService: ConfigService<Env, true>): string[] {
  return (configService.get("BILLING_ADMIN_EMAILS", { infer: true }) ?? "")
    .split(",")
    .map((email: string) => email.trim().toLowerCase())
    .filter((email: string) => email.length > 0);
}
