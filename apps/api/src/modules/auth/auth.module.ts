import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../mail/mail.module";
import { TenantsModule } from "../tenants/tenants.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthRepository } from "./repositories/auth.repository";
import { OneTimeTokenService } from "./services/one-time-token.service";

// f1-auth design §2: auth → tenants, auth → mail, auth → audit — nunca al
// revés. TokenService/JwtAuthGuard (login, U3) siguen wireados directo en
// AppModule por ahora (U1); se mudan acá cuando login aterrice.
@Module({
  imports: [TenantsModule, MailModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, OneTimeTokenService],
})
export class AuthModule {}
