import { Injectable } from "@nestjs/common";
import {
  endOfDayUtc,
  SITE_EVENT_NAMES,
  SITE_MARKETS,
  SITE_TOP_REFERRERS,
  type SiteEventName,
  type SiteEventsQuery,
  type SiteEventsSummary,
  type SiteLeadRow,
  type SiteLeadsPage,
  type SiteLeadsQuery,
  type SiteMarket,
  type SitePlanInterest,
  startOfDayUtc,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * El calendario en el que se leen estos rangos. A diferencia de los reportes
 * de un negocio —que van en la zona del negocio—, aquí quien mira es la
 * plataforma: «los prospectos del 1 al 30 de septiembre» son los días de
 * Carlos, no los de un cliente ni los de UTC.
 */
const SITE_REPORT_TZ = "America/Mexico_City";

/** Los dos eventos que cuentan como conversión al mirar de dónde llega la gente. */
const CONVERTING_EVENTS: SiteEventName[] = ["form_submit", "cta_click"];

/**
 * F11-SITE-LEAD-08/09 — lo que el backoffice ve del sitio público.
 *
 * Todo es de SOLO LECTURA: un prospecto no se edita ni se borra a mano (lo
 * borra la retención a los 24 meses) y un evento tampoco. Esta pantalla es la
 * red para el día que un correo de aviso no llegue —`notified` en false es
 * justo eso— y el tablero para saber si el sitio vende.
 *
 * No hay contexto de tenant en ningún lado: las dos tablas son globales, no
 * llevan RLS y el guard de la plataforma ya decidió quién entra.
 */
@Injectable()
export class AdminSiteService {
  constructor(private readonly prisma: PrismaService) {}

  async listLeads(query: SiteLeadsQuery): Promise<SiteLeadsPage> {
    const where = this.rangoDeFechas(query.from, query.to);

    const [filas, total] = await Promise.all([
      this.prisma.siteLead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.siteLead.count({ where }),
    ]);

    return {
      items: filas.map(
        (fila): SiteLeadRow => ({
          id: fila.id,
          createdAt: fila.createdAt.toISOString(),
          name: fila.name,
          email: fila.email,
          country: fila.country,
          route: fila.route,
          planInterest: fila.planInterest as SitePlanInterest,
          businessType: fila.businessType,
          message: fila.message,
          // `notified_at` es un instante, pero la pantalla solo necesita saber
          // si salió o no: la fecha exacta del correo no le dice nada a nadie.
          notified: fila.notifiedAt !== null,
        }),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async eventsSummary(query: SiteEventsQuery): Promise<SiteEventsSummary> {
    const where: Prisma.SiteEventWhereInput = {
      ...this.rangoDeFechas(query.from, query.to),
      ...(query.market ? { market: query.market } : {}),
    };

    const [porEvento, porMercado, porOrigen] = await Promise.all([
      this.prisma.siteEvent.groupBy({ by: ["event"], where, _count: { _all: true } }),
      this.prisma.siteEvent.groupBy({ by: ["market"], where, _count: { _all: true } }),
      this.prisma.siteEvent.groupBy({
        by: ["referrerDomain", "event"],
        where: { ...where, event: { in: CONVERTING_EVENTS }, referrerDomain: { not: null } },
        _count: { _all: true },
      }),
    ]);

    // Los cinco eventos y los tres mercados SIEMPRE presentes: una tabla a la
    // que le faltan filas obliga a quien la lee a recordar cuáles existen.
    const byEvent = Object.fromEntries(SITE_EVENT_NAMES.map((name) => [name, 0])) as Record<
      SiteEventName,
      number
    >;
    for (const fila of porEvento) {
      byEvent[fila.event as SiteEventName] = fila._count._all;
    }

    const byMarket = Object.fromEntries(SITE_MARKETS.map((market) => [market, 0])) as Record<
      SiteMarket,
      number
    >;
    for (const fila of porMercado) {
      byMarket[fila.market as SiteMarket] = fila._count._all;
    }

    const aperturas = byEvent.form_open;

    return {
      from: query.from,
      to: query.to,
      byEvent,
      byMarket,
      // `null` y no 0 cuando nadie abrió: una tasa sin denominador no es cero,
      // es nada — y una pantalla que muestra «0 %» ahí miente.
      formOpenToSubmitRate: aperturas === 0 ? null : byEvent.form_submit / aperturas,
      topReferrers: this.topReferrers(porOrigen),
    };
  }

  /**
   * Los días del calendario de la plataforma, traducidos a instantes UTC. El
   * final es ABIERTO (`lt`): un `23:59:59.999` deja fuera lo que ocurra en ese
   * último milisegundo, y `created_at` guarda microsegundos.
   */
  private rangoDeFechas(from?: string, to?: string): { createdAt?: { gte?: Date; lt?: Date } } {
    if (!from && !to) {
      return {};
    }
    return {
      createdAt: {
        ...(from ? { gte: startOfDayUtc(from, SITE_REPORT_TZ) } : {}),
        ...(to ? { lt: endOfDayUtc(to, SITE_REPORT_TZ) } : {}),
      },
    };
  }

  private topReferrers(
    filas: { referrerDomain: string | null; event: string; _count: { _all: number } }[],
  ): SiteEventsSummary["topReferrers"] {
    const porDominio = new Map<string, { formSubmit: number; ctaClick: number }>();

    for (const fila of filas) {
      if (fila.referrerDomain === null) {
        continue;
      }
      const acumulado = porDominio.get(fila.referrerDomain) ?? { formSubmit: 0, ctaClick: 0 };
      if (fila.event === "form_submit") {
        acumulado.formSubmit += fila._count._all;
      } else {
        acumulado.ctaClick += fila._count._all;
      }
      porDominio.set(fila.referrerDomain, acumulado);
    }

    return [...porDominio.entries()]
      .map(([domain, conteos]) => ({
        domain,
        ...conteos,
        total: conteos.formSubmit + conteos.ctaClick,
      }))
      .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain))
      .slice(0, SITE_TOP_REFERRERS);
  }
}
