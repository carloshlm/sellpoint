import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { MailModule } from "../mail/mail.module";
import { TenantsModule } from "../tenants/tenants.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthEmailThrottlerGuard } from "./guards/auth-email-throttler.guard";
import { AuthRepository } from "./repositories/auth.repository";
import { OneTimeTokenService } from "./services/one-time-token.service";
import { RefreshTokenService } from "./services/refresh-token.service";
import { TokenService } from "./services/token.service";

// f1-auth design §2: auth → tenants, auth → mail, auth → audit — nunca al
// revés. TokenService se muda ACÁ desde U3 (login lo necesita para firmar) y
// se EXPORTA porque AppModule lo sigue inyectando en JwtAuthGuard (APP_GUARD
// global) — Nest resuelve esa dependencia vía el import de AuthModule en
// AppModule, sin duplicar el provider.
@Module({
  imports: [TenantsModule, MailModule, AuditModule, BillingModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    OneTimeTokenService,
    RefreshTokenService,
    TokenService,
    AuthEmailThrottlerGuard,
  ],
  // AuthRepository + OneTimeTokenService se exportan para
  // `UserInvitationService` (gap S1, UsersModule): la invitación emite un
  // `PasswordResetToken` real y debe pasar por el MISMO repositorio y el
  // MISMO generador de tokens que forgot-password — nunca por SQL propio.
  exports: [TokenService, AuthRepository, OneTimeTokenService],
})
export class AuthModule {}
