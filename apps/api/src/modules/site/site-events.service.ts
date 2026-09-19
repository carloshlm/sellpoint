import { Injectable, Logger } from "@nestjs/common";
import { normalizeReferrerDomain, siteEventSchema } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * La respuesta del beacon, SIEMPRE la misma. Tipo exportado a propósito: un
 * método público que devuelve un tipo anónimo rompe `nest build` (TS4053).
 */
export interface SiteEventAccepted {
  received: true;
}

/**
 * F11-SITE-SEO-06 — la medición del sitio público.
 *
 * ── Por qué NUNCA responde 400 ──────────────────────────────────────────
 * El sitio manda estos eventos con `navigator.sendBeacon`, que no frena la
 * navegación ni se pierde al salir de la página… y que TAMPOCO lee la
 * respuesta. Un 400 no lo vería nadie: solo serviría para llenar los logs de
 * errores que ningún cliente puede corregir. Lo que no valida se descarta con
 * el mismo 202, y queda un `debug` sin datos de nadie por si algún día hay que
 * mirar si el sitio está mandando basura.
 *
 * ── Lo que NO se guarda ─────────────────────────────────────────────────
 * Sin IP, sin agente de usuario, sin identificador de visitante. El
 * `referrerDomain` lo recorta el SERVIDOR aunque el sitio ya lo mande
 * recortado: lo que llega de internet no se cree, y la ruta de un `Referer`
 * es justo donde un buscador mete lo que la persona escribió.
 */
@Injectable()
export class SiteEventsService {
  private readonly logger = new Logger(SiteEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(body: unknown): Promise<SiteEventAccepted> {
    const parsed = siteEventSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.debug("Evento del sitio descartado: no pasa el esquema");
      return { received: true };
    }

    const { event, market, locale, section, plan, referrerDomain } = parsed.data;

    try {
      await this.prisma.siteEvent.create({
        data: {
          event,
          market,
          locale,
          section,
          plan,
          referrerDomain: normalizeReferrerDomain(referrerDomain),
        },
      });
    } catch (error) {
      // Un beacon no se reintenta ni se le puede contestar: si la base falla
      // se pierde un conteo, que es exactamente lo que vale perder acá.
      this.logger.warn(
        `No se pudo guardar un evento del sitio: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { received: true };
  }
}
