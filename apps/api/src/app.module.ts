import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { I18nModule } from "nestjs-i18n";
import { LoggerModule } from "nestjs-pino";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { validateEnv } from "./config/env.schema";
import { HealthController } from "./health/health.controller";
import { i18nOptions } from "./i18n/i18n.config";
import { I18nDemoController } from "./i18n/i18n-demo.controller";
import { CryptoModule } from "./infrastructure/crypto/crypto.module";
import { PrismaModule } from "./infrastructure/prisma/prisma.module";
import { RedisModule } from "./infrastructure/redis/redis.module";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { TokenService } from "./modules/auth/services/token.service";

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
    I18nModule.forRoot(i18nOptions),
    CryptoModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [HealthController, I18nDemoController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Secure by default (f1-auth AD-8): TODO endpoint requiere JWT válido
    // salvo @Public() explícito. TokenService/JwtAuthGuard viven acá
    // temporalmente hasta que U2 introduzca AuthModule — no hay controller
    // de auth todavía, pero el guard global ya tiene que estar montado.
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
