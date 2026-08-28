import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import type { Env } from "../../config/env.schema";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { BillingDailyJob } from "./billing-daily.job";

/**
 * F7-CRON-01 — registra el barrido diario, y NADA más. Separado del job a
 * propósito: `BillingDailyJob` es lógica pura testeable sin cron, y esta
 * clase es el único lugar que conoce el reloj de pared.
 *
 * Con `BILLING_CRON_ENABLED=false` el cron NO SE REGISTRA (tests, e2e, y
 * cualquier entorno donde el barrido no deba correr solo). El registro es
 * dinámico (SchedulerRegistry) porque la hora y la zona vienen del env — un
 * decorador @Cron las querría en tiempo de compilación.
 *
 * Con dos instancias del api el job correría dos veces: inofensivo por
 * construcción (updateMany idempotente + UNIQUE de avisos), pero hoy no hay
 * dos instancias — es un `setInterval` dentro del proceso que ya corre,
 * cero RAM extra (la LEY de la fase, contra BullMQ).
 */
@Injectable()
export class BillingCronRegistrar implements OnModuleInit {
  private readonly logger = new Logger(BillingCronRegistrar.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
    private readonly job: BillingDailyJob,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get("BILLING_CRON_ENABLED", { infer: true })) {
      this.logger.log("Cron de billing APAGADO (BILLING_CRON_ENABLED=false)");
      return;
    }

    const hour = this.configService.get("BILLING_CRON_HOUR", { infer: true });
    const timeZone = this.configService.get("BILLING_CRON_TZ", { infer: true });

    const cronJob = new CronJob(
      `0 0 ${hour} * * *`,
      () => {
        this.job.run(this.clock.now()).catch((error: unknown) => {
          this.logger.error(
            `El barrido diario de billing falló: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      null,
      true,
      timeZone,
    );
    this.registry.addCronJob("billing-daily", cronJob);
    this.logger.log(`Cron de billing registrado: ${hour}:00 ${timeZone}`);
  }
}
