import type {
  SiteEventsQuery,
  SiteEventsSummary,
  SiteLeadsPage,
  SiteLeadsQuery,
} from "@sellpoint/shared";
import { api } from "@/lib/api";

/**
 * F11-SITE-LEAD-08/09 — el sitio público (`sellpointy.com`) visto desde el
 * backoffice: la lista de prospectos y el resumen de tráfico/conversión.
 * Ambos son de SOLO LECTURA (`GET /admin/site/*`) y viven detrás del mismo
 * `PlatformAdminGuard` que «Negocios» y «Cobros» — el server re-verifica
 * igual, así que acá no hay nada que decidir sobre permisos.
 */
export async function getSiteLeads(query: SiteLeadsQuery): Promise<SiteLeadsPage> {
  const { data } = await api.get<SiteLeadsPage>("/admin/site/leads", { params: query });
  return data;
}

export async function getSiteEventsSummary(query: SiteEventsQuery): Promise<SiteEventsSummary> {
  const { data } = await api.get<SiteEventsSummary>("/admin/site/events/summary", {
    params: query,
  });
  return data;
}
