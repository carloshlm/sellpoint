import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { validateEnv } from "./config/env.schema";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./infrastructure/prisma/prisma.module";
import { RedisModule } from "./infrastructure/redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers['set-cookie']",
            "*.password",
            "req.body.password",
          ],
          censor: "[REDACTED]",
        },
      },
    }),
    PrismaModule,
    RedisModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
