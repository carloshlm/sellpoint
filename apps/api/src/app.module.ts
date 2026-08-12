import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { I18nModule } from "nestjs-i18n";
import { LoggerModule } from "nestjs-pino";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { validateEnv } from "./config/env.schema";
import { HealthController } from "./health/health.controller";
import { i18nOptions } from "./i18n/i18n.config";
import { I18nDemoController } from "./i18n/i18n-demo.controller";
import { LocaleResolverMiddleware } from "./i18n/locale-resolver.middleware";
import { ClockModule } from "./infrastructure/clock/clock.module";
import { CryptoModule } from "./infrastructure/crypto/crypto.module";
import { PrismaModule } from "./infrastructure/prisma/prisma.module";
import { RedisModule } from "./infrastructure/redis/redis.module";
import { TenantContextMiddleware } from "./infrastructure/tenant-context/tenant-context.middleware";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { MailModule } from "./modules/mail/mail.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";

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
    // global: true (f1-auth U2): nestjs-i18n no marca I18nModule global por
    // default — sin esto, cada feature module que necesite I18nService
    // (MailModule acá) tendría que volver a llamar forRoot() y duplicar
    // loaders/watchers. DynamicModule respeta `global` como cualquier otro.
    { ...I18nModule.forRoot(i18nOptions), global: true },
    ClockModule,
    CryptoModule,
    PrismaModule,
    RedisModule,
    // f1-auth U2: registro de tenant+owner + verificación de email.
    AuditModule,
    MailModule,
    TenantsModule,
    AuthModule,
    // F1-LOCALE-05: PATCH /me (cambio de locale del propio user).
    UsersModule,
  ],
  controllers: [HealthController, I18nDemoController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Secure by default (f1-auth AD-8): TODO endpoint requiere JWT válido
    // salvo @Public() explícito. JwtAuthGuard resuelve TokenService desde
    // AuthModule (importado arriba, lo exporta desde U3) — no se declara acá.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  // F1-LOCALE-02: LocaleResolverMiddleware corre en TODA request ('*'),
  // antes que los guards — necesario porque decodifica el claim `locale`
  // del Bearer token sin depender de que JwtAuthGuard ya haya poblado
  // req.user (los middlewares siempre corren antes que los guards).
  // F1-TENANT-01: mismo patrón para el claim `tenantId` (observabilidad de
  // request; la única fuente de confianza para RLS es
  // PrismaService.withTenantContext, no este middleware).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LocaleResolverMiddleware, TenantContextMiddleware).forRoutes("*");
  }
}
