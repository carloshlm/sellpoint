import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { I18nModule } from "nestjs-i18n";
import { LoggerModule } from "nestjs-pino";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import type { Env } from "./config/env.schema";
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
import { RedisThrottlerStorage } from "./infrastructure/throttle/redis-throttler.storage";
import { ThrottleModule } from "./infrastructure/throttle/throttle.module";
import { WarehouseScopeInterceptor } from "./infrastructure/warehouse-scope/warehouse-scope.interceptor";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "./modules/auth/guards/permissions.guard";
import { MailModule } from "./modules/mail/mail.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { RolesModule } from "./modules/roles/roles.module";
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
            // W6 del re-verify de f1-web-auth, probado en producción: los
            // tokens de un solo uso viajan en la query string
            // (/accept-invitation?token=... vive 7 DÍAS) y el navegador manda
            // la URL COMPLETA del documento como Referer en las subrequests
            // same-origin. pino loguea el objeto `headers` entero, así que el
            // secreto quedaba en texto plano en el log de la api. Es el mismo
            // vector que ya se tapó en los dos nginx con `map $http_referer`;
            // acá faltaba. (El cierre definitivo es sacar el token de la URL.)
            "req.headers.referer",
            "req.headers.referrer",
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
    ThrottleModule,
    // f1-auth U6-02: throttler `default` (100/60s, IP, app entera) — vive
    // acá porque protege TODA la app, no solo /auth/*. `auth-ip`/`auth-email`
    // (5/900s, 10/3600s) NO están acá: son un guard aparte
    // (AuthEmailThrottlerGuard) aplicado solo en AuthController — ver esa
    // clase para el porqué de no meter los 3 throttlers en un único
    // ThrottlerModule global con @SkipThrottle por controller.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (configService: ConfigService<Env, true>, storage: RedisThrottlerStorage) => ({
        skipIf: () => !configService.get("THROTTLE_ENABLED", { infer: true }),
        // Contrato de key (design §6/AD-7): `throttle:{name}:{tracker}`,
        // SIN el nombre de ruta/handler — "app entera" es un balde único
        // por IP, no un balde por endpoint (que es el default de la lib).
        generateKey: (_context, tracker, name) => `throttle:${name}:${tracker}`,
        throttlers: [
          {
            name: "default",
            limit: configService.get("THROTTLE_GLOBAL_LIMIT", { infer: true }),
            ttl: configService.get("THROTTLE_GLOBAL_TTL_SEC", { infer: true }) * 1000,
          },
        ],
        storage,
      }),
    }),
    // f1-auth U2: registro de tenant+owner + verificación de email.
    AuditModule,
    MailModule,
    TenantsModule,
    AuthModule,
    // F1-LOCALE-05: PATCH /me (cambio de locale del propio user).
    // F1-RBAC-03/04/05: CRUD de usuarios/roles + catálogo de permisos.
    UsersModule,
    RolesModule,
    PermissionsModule,
  ],
  controllers: [HealthController, I18nDemoController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // f1-auth AD-7: el throttle tiene que pegar ANTES de gastar ciclos
    // verificando firmas RS256 — por eso ThrottlerGuard va PRIMERO en este
    // array (el orden de múltiples APP_GUARD es el orden del array, Nest
    // los ejecuta en secuencia).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Secure by default (f1-auth AD-8): TODO endpoint requiere JWT válido
    // salvo @Public() explícito. JwtAuthGuard resuelve TokenService desde
    // AuthModule (importado arriba, lo exporta desde U3) — no se declara acá.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // F1-RBAC-01: autorización, DESPUÉS de la autenticación — lee los
    // permisos de claims ya verificados (firma + epoch). Sin
    // @RequirePermissions un endpoint solo exige estar logueado.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // F1-SCOPE-03 (remediación CRITICAL C1/C2, verify-report `sdd/f1-scope`):
    // interceptor global, NO middleware — corre DESPUÉS de ThrottlerGuard y
    // JwtAuthGuard, así que lee `req.user` (firma + epoch YA verificados) en
    // vez de decodificar el token crudo. Ver el docblock de
    // `WarehouseScopeInterceptor` para el detalle de por qué un middleware
    // acá era explotable (cross-tenant read + amplificación de DB inmune al
    // throttling) y NO volver a esa forma. Se registra dos veces a
    // propósito: como provider normal (retornable/testeable vía
    // `app.get(WarehouseScopeInterceptor)`) y como `APP_INTERCEPTOR` para
    // que Nest lo enganche global — `useExisting` reusa la MISMA instancia
    // singleton en ambos casos.
    WarehouseScopeInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: WarehouseScopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  // F1-LOCALE-02: LocaleResolverMiddleware corre en TODA request ('*'),
  // antes que los guards — necesario porque decodifica el claim `locale`
  // del Bearer token sin depender de que JwtAuthGuard ya haya poblado
  // req.user (los middlewares siempre corren antes que los guards). Solo
  // alimenta UX (idioma de la respuesta), no una decisión de negocio.
  // F1-TENANT-01: mismo patrón para el claim `tenantId`. Solo alimenta
  // observabilidad del request (queda en el log estructurado); la única
  // fuente de confianza para RLS sigue siendo
  // PrismaService.withTenantContext, nunca este middleware — NO decide
  // nada, no abre contexto RLS ni hace queries.
  // F1-SCOPE-03: YA NO vive acá. Ver `WarehouseScopeInterceptor` (arriba, en
  // `providers`) — a diferencia de locale/tenantId, esto SÍ alimenta una
  // decisión de negocio (`req.scope`), y por eso no puede depender de claims
  // sin verificar como los middlewares de arriba.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LocaleResolverMiddleware, TenantContextMiddleware).forRoutes("*");
  }
}
