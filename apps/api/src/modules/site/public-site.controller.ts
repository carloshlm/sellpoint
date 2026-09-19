import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { type SiteLeadInput, siteLeadSchema } from "@sellpoint/shared";
import type { Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Public } from "../auth/decorators/public.decorator";
import { SiteThrottlerGuard } from "./guards/site-throttler.guard";
// Importación de VALOR, no `import type`: Nest resuelve la dependencia por el
// metadato de diseño del constructor, que un `import type` borraría.
import { type SiteEventAccepted, SiteEventsService } from "./site-events.service";
import { type SiteLeadAccepted, SiteLeadsService } from "./site-leads.service";
import { SITE_THROTTLES, SiteThrottle } from "./site-throttle";
import { SiteUnsubscribeService } from "./site-unsubscribe.service";

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
    private readonly siteUnsubscribe: SiteUnsubscribeService,
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

  /**
   * F11-SITE-LEGAL-04 — el enlace de baja del pie de los correos comerciales.
   *
   * El TERCER endpoint público, y el único que devuelve HTML: del otro lado
   * hay un navegador que acaba de salir de un correo, no el sitio pegándole al
   * API. Un `{"message":"…"}` sería una pantalla en blanco con un error.
   *
   * Por eso tampoco THROWEA: un token malo responde 400 pero con su propia
   * página, no con el JSON del filtro global. El código distingue «valió» de
   * «no valió» para quien mire los registros; lo que ve la persona es una
   * página que explica qué hacer, sin decir jamás si ese correo existe.
   */
  @Get("unsubscribe")
  @SiteThrottle(SITE_THROTTLES.unsubscribe)
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async unsubscribe(
    @Query("token") token: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const outcome = await this.siteUnsubscribe.apply(token);
    response.status(outcome.ok ? HttpStatus.OK : HttpStatus.BAD_REQUEST);
    return outcome.html;
  }
}
