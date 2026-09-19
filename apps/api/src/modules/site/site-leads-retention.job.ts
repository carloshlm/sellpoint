import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Los 24 meses que promete el aviso de privacidad (Carlos, 2026-09-18). Vive
 * en una constante con nombre y no en un número suelto dentro de la consulta:
 * el día que cambie el aviso, hay UN lugar donde cambiarlo.
 */
export const SITE_LEADS_RETENTION_MONTHS = 24;

/** Lo que devuelve el barrido, también por el endpoint manual del backoffice. */
export interface SiteLeadsRetentionResult {
  deleted: number;
}

/**
 * La fecha de corte: todo lo anterior se va. Lógica PURA, sin reloj — el
 * `now` lo pone quien llama (el registrador, con el reloj de pared; el spec,
 * con uno simulado).
 *
 * Un día que no existe dos años atrás (29 de febrero) rueda al siguiente, que
 * es el comportamiento de `setUTCMonth`. Da igual: un día de diferencia sobre
 * un plazo de dos años no cambia nada de lo que el aviso promete.
 */
export function siteLeadsRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SITE_LEADS_RETENTION_MONTHS);
  return cutoff;
}

/**
 * F11-SITE-LEAD-10 — los prospectos se borran solos a los 24 meses.
 *
 * ── Por qué NO cuelga de `BillingDailyJob` ──────────────────────────────
 * Ese job tiene una regla de oro escrita en su cabecera: «SOLO DEGRADA»
 * planes. Meterle un borrado de prospectos le rompería esa garantía y
 * mezclaría dos responsabilidades que no tienen nada que ver. Lo que SÍ se
 * calca es su forma, que ya está resuelta: lógica pura testeable sin reloj,
 * un registrador aparte con su flag de entorno y un endpoint del backoffice
 * para correrlo a mano.
 *
 * ── «Y que no se haya vuelto cliente» ───────────────────────────────────
 * Si ese correo ya tiene cuenta, el dato dejó de ser un prospecto y lo rige la
 * cuenta, no esta retención. La comprobación pasa por
 * `auth_resolve_tenant_by_email`, la única excepción de RLS del sistema
 * (SECURITY DEFINER, f1-auth AD-2): `users` tiene RLS y sin contexto de tenant
 * un `NOT EXISTS` contra esa tabla devolvería SIEMPRE «no existe» y borraría
 * los prospectos de todos los clientes. Esa función normaliza a minúsculas,
 * igual que `site_leads.email`.
 *
 * ── Idempotente por construcción ────────────────────────────────────────
 * Un `DELETE … WHERE created_at < corte`: la segunda pasada borra cero filas.
 * Correrlo dos veces no hace nada, y `POST /admin/site/leads/retention/run`
 * existe justo para eso.
 */
@Injectable()
export class SiteLeadsRetentionJob {
  private readonly logger = new Logger(SiteLeadsRetentionJob.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date): Promise<SiteLeadsRetentionResult> {
    const cutoff = siteLeadsRetentionCutoff(now);

    const deleted = await this.prisma.$executeRaw`
      DELETE FROM site_leads
       WHERE created_at < ${cutoff}
         AND public.auth_resolve_tenant_by_email(email) IS NULL
    `;

    // CUÁNTOS, nunca quiénes: un log con los correos borrados sería guardar
    // en el registro justo lo que se acaba de eliminar de la base.
    this.logger.log(
      `Retención de prospectos: ${deleted} borrados (anteriores a ${cutoff.toISOString()})`,
    );
    return { deleted };
  }
}
