import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { type SiteLeadInput, siteLeadSchema } from "@sellpoint/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Public } from "../auth/decorators/public.decorator";
import { SiteThrottlerGuard } from "./guards/site-throttler.guard";
// Importación de VALOR, no `import type`: Nest resuelve la dependencia por el
// metadato de diseño del constructor, que un `import type` borraría.
import { type SiteEventAccepted, SiteEventsService } from "./site-events.service";
import { type SiteLeadAccepted, SiteLeadsService } from "./site-leads.service";
import { SITE_THROTTLES, SiteThrottle } from "./site-throttle";

/**
 * F11-SITE-LEAD-02 / F11-SITE-SEO-06 — los DOS endpoints que el sitio público
 * (`sellpointy.com`, un Astro estático servido por nginx) le pega al API.
 *
 * Los dos son `@Public()` —quien escribe desde el sitio no tiene cuenta— y los
 * dos responden **202** con un cuerpo fijo. Dos razones distintas para el
 * mismo código:
 *
 *  · el formulario: si la respuesta variara según el correo, el endpoint
 *    serviría para averiguar quién ya nos escribió;
 *  · el beacon: `navigator.sendBeacon` no lee la respuesta, así que cualquier
 *    otro código sería un error que nadie puede corregir.
 *
 * La ÚNICA respuesta distinta es el 400 de un cuerpo mal formado del
 * formulario, que el formulario real sí necesita para pintar el campo malo.
 * Las trampas anti-robot no responden 400 a propósito: eso le enseñaría al
 * robot qué corregir.
 */
@Public()
@UseGuards(SiteThrottlerGuard)
@Controller("public")
export class PublicSiteController {
  constructor(
    private readonly siteLeads: SiteLeadsService,
    private readonly siteEvents: SiteEventsService,
  ) {}

  @Post("leads")
  @HttpCode(HttpStatus.ACCEPTED)
  @SiteThrottle(SITE_THROTTLES.lead)
  createLead(
    @Body(new ZodValidationPipe(siteLeadSchema, "site.invalid_body")) dto: SiteLeadInput,
  ): Promise<SiteLeadAccepted> {
    return this.siteLeads.submit(dto);
  }

  /**
   * El cuerpo llega SIN validar a propósito: lo valida el servicio con
   * `safeParse` para poder descartar en silencio en vez de responder 400 (ver
   * `SiteEventsService`). Puede venir como `application/json` o como
   * `text/plain` — ver `SiteBeaconBodyMiddleware` para por qué el recomendado
   * es el segundo.
   */
  @Post("site-events")
  @HttpCode(HttpStatus.ACCEPTED)
  @SiteThrottle(SITE_THROTTLES.event)
  recordEvent(@Body() body: unknown): Promise<SiteEventAccepted> {
    return this.siteEvents.record(body);
  }
}
