import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Redis } from "ioredis";
import { PrismaService } from "../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../infrastructure/redis/redis.module";

type CheckResult = "ok" | "error";

export interface HealthReport {
  status: CheckResult;
  db: CheckResult;
  redis: CheckResult;
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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
