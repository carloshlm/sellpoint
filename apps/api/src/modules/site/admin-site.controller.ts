import { Controller, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import {
  type SiteEventsQuery,
  type SiteEventsSummary,
  type SiteLeadsPage,
  type SiteLeadsQuery,
  siteEventsQuerySchema,
  siteLeadsQuerySchema,
} from "@sellpoint/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { AllowedInFreeTier } from "../billing/decorators/allowed-in-free-tier.decorator";
import { PlatformAdminGuard } from "../billing/guards/platform-admin.guard";
import { AdminSiteService } from "./admin-site.service";
import { SiteLeadsRetentionJob, type SiteLeadsRetentionResult } from "./site-leads-retention.job";

/**
 * F11-SITE-LEAD-08/09/10 — el sitio público dentro del backoffice.
 *
 * Mismas dos anotaciones que `AdminBillingController`, y por las mismas
 * razones: `PlatformAdminGuard` a nivel de CLASE (las cuatro llaves en AND en
 * cada request) y `@AllowedInFreeTier()` porque administrar la plataforma no
 * puede depender de que la suscripción del propio dueño esté al día.
 */
@AllowedInFreeTier()
@UseGuards(PlatformAdminGuard)
@Controller("admin/site")
export class AdminSiteController {
  constructor(
    private readonly adminSite: AdminSiteService,
    private readonly retention: SiteLeadsRetentionJob,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /** La lista de solo lectura: la red para el día que un correo no llegue. */
  @Get("leads")
  listLeads(
    @Query(new ZodValidationPipe(siteLeadsQuerySchema, "site.invalid_body"))
    query: SiteLeadsQuery,
  ): Promise<SiteLeadsPage> {
    return this.adminSite.listLeads(query);
  }

  /** Los números del sitio: los cinco eventos, la tasa y de dónde llegan. */
  @Get("events/summary")
  eventsSummary(
    @Query(new ZodValidationPipe(siteEventsQuerySchema, "site.invalid_body"))
    query: SiteEventsQuery,
  ): Promise<SiteEventsSummary> {
    return this.adminSite.eventsSummary(query);
  }

  /**
   * El barrido de retención a demanda — para el runbook («córrelo a mano y
   * mira cuántos se fueron») y para los e2e. Idempotente por construcción:
   * correrlo dos veces no borra nada la segunda.
   */
  @Post("leads/retention/run")
  runRetention(): Promise<SiteLeadsRetentionResult> {
    return this.retention.run(this.clock.now());
  }
}
