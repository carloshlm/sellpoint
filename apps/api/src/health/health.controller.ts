import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";
import { PrismaService } from "../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../infrastructure/redis/redis.module";
import { Public } from "../modules/auth/decorators/public.decorator";

type CheckResult = "ok" | "error";

export interface HealthReport {
  status: CheckResult;
  db: CheckResult;
  redis: CheckResult;
  /** F6-RELEASE-04: la versión del package.json raíz bakeada en la imagen (`0.0.0` en local). */
  version: string;
  /** El sha corto del build (`local` fuera del pipeline). */
  build: string;
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async getHealth(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redis.ping()),
    ]);

    const report: HealthReport = {
      status: db === "ok" && redis === "ok" ? "ok" : "error",
      db,
      redis,
      version: process.env.APP_VERSION ?? "0.0.0",
      build: process.env.APP_BUILD ?? "local",
    };

    if (report.status !== "ok") {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }

  private async check(probe: () => Promise<unknown>): Promise<CheckResult> {
    try {
      await probe();
      return "ok";
    } catch {
      return "error";
    }
  }
}
