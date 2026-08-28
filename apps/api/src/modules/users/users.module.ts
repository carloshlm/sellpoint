import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";
import { MailModule } from "../mail/mail.module";
import { UserInvitationService } from "./user-invitation.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UsersAdminController } from "./users-admin.controller";
import { UsersAdminService } from "./users-admin.service";
import { WarehouseScopeService } from "./warehouse-scope.service";

// F1-RBAC-03: UsersAdminController/-Service (CRUD admin bajo /users) viven
// en el MISMO módulo que UsersController/-Service (PATCH /me, self-service)
// — comparten dominio (tabla `users`) pero NO estado ni lógica.
//
// Gap S1: `users -> auth` (por AuthRepository/OneTimeTokenService, que
// AuthModule exporta) es una dirección NUEVA y no cierra ciclo — auth no
// importa users. Es deliberado: la emisión del token de invitación reusa el
// ÚNICO lugar con queries de auth en vez de duplicar el SQL de
// `password_reset_tokens` acá.
@Module({
  imports: [AuditModule, AuthModule, MailModule, BillingModule],
  controllers: [UsersController, UsersAdminController],
  providers: [UsersService, UsersAdminService, UserInvitationService, WarehouseScopeService],
})
export class UsersModule {}
