import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { MailModule } from "../mail/mail.module";
import { AdminSiteController } from "./admin-site.controller";
import { AdminSiteService } from "./admin-site.service";
import { SiteThrottlerGuard } from "./guards/site-throttler.guard";
import { PublicSiteController } from "./public-site.controller";
import { SiteBeaconBodyMiddleware } from "./site-beacon-body.middleware";
import { SiteCronRegistrar } from "./site-cron.registrar";
import { SiteEventsService } from "./site-events.service";
import { SiteLeadsService } from "./site-leads.service";
import { SiteLeadsRetentionJob } from "./site-leads-retention.job";
import { SiteUnsubscribeService } from "./site-unsubscribe.service";

/**
 * F11 — el sitio público `sellpointy.com` visto desde el API.
 *
 * Tres piezas y nada más: el formulario de interés (`/public/leads`), la
 * medición propia (`/public/site-events`) y lo que el backoffice ve de ambos.
 * Más el barrido que borra los prospectos a los 24 meses, que es lo que
 * vuelve verdad la promesa del aviso de privacidad.
 *
 * Ninguna de sus dos tablas lleva `tenant_id` ni RLS: un prospecto todavía no
 * es un negocio. Ver la cabecera de las migraciones.
 *
 * `MailModule` sí se importa (no es global, a diferencia de `ConfigModule`,
 * `ClockModule` y `ThrottleModule`): de ahí sale el `MAILER` con el que se
 * avisa un prospecto.
 */
@Module({
  // `ScheduleModule.forRoot()` es idempotente (BillingModule ya lo llama): se
  // repite para que este módulo siga teniendo su `SchedulerRegistry` el día
  // que el de billing deje de importarlo.
  imports: [MailModule, ScheduleModule.forRoot()],
  controllers: [PublicSiteController, AdminSiteController],
  providers: [
    SiteLeadsService,
    SiteUnsubscribeService,
    SiteEventsService,
    AdminSiteService,
    SiteLeadsRetentionJob,
    SiteCronRegistrar,
    SiteThrottlerGuard,
  ],
})
export class SiteModule implements NestModule {
  /**
   * El parser de `text/plain` va SOLO en la ruta del beacon. Global cambiaría
   * el cuerpo de endpoints ajenos; acá es el precio de que `sendBeacon` no
   * dispare preflight CORS al cerrar la página (ver el middleware).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SiteBeaconBodyMiddleware)
      .forRoutes({ path: "public/site-events", method: RequestMethod.POST });
  }
}
