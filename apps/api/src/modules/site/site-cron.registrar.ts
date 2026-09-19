import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import type { Env } from "../../config/env.schema";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { SiteLeadsRetentionJob } from "./site-leads-retention.job";

/**
 * A qué hora se purgan los prospectos vencidos. Constantes y no variables de
 * entorno, a diferencia de las del cron de billing: nadie va a querer mover
 * esto por ambiente, y una variable más es una variable más que mantener. Las
 * 4 de la mañana de CDMX, una hora después del barrido de billing, para que
 * dos borrados no compitan por la misma base.
 */
export const SITE_CRON_HOUR = 4;
export const SITE_CRON_TZ = "America/Mexico_City";

/**
 * F11-SITE-LEAD-10 — registra el barrido de retención, y NADA más. Separado
 * del job a propósito (el molde es `billing-cron.registrar.ts`):
 * `SiteLeadsRetentionJob` es lógica pura testeable sin cron, y esta clase es
 * el único lugar que conoce el reloj de pared.
 *
 * Con `SITE_LEADS_RETENTION_ENABLED=false` el cron NO SE REGISTRA — y ese es
 * el default. Un barrido que BORRA filas es opt-in explícito del ambiente: los
 * tests y cualquier entorno nuevo jamás lo arrancan sin decidirlo.
 *
 * Con dos instancias del api correría dos veces: inofensivo por construcción
 * (el DELETE es idempotente), pero hoy no hay dos instancias — es un
 * `setInterval` dentro del proceso que ya corre, cero RAM extra.
 */
@Injectable()
export class SiteCronRegistrar implements OnModuleInit {
  private readonly logger = new Logger(SiteCronRegistrar.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
    private readonly job: SiteLeadsRetentionJob,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get("SITE_LEADS_RETENTION_ENABLED", { infer: true })) {
      this.logger.log("Retención de prospectos APAGADA (SITE_LEADS_RETENTION_ENABLED=false)");
      return;
    }

    const cronJob = new CronJob(
      `0 0 ${SITE_CRON_HOUR} * * *`,
      () => {
        this.job.run(this.clock.now()).catch((error: unknown) => {
          this.logger.error(
            `La retención de prospectos falló: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      },
      null,
      true,
      SITE_CRON_TZ,
    );
    this.registry.addCronJob("site-leads-retention", cronJob);
    this.logger.log(`Retención de prospectos registrada: ${SITE_CRON_HOUR}:00 ${SITE_CRON_TZ}`);
  }
}
