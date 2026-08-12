import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UsersAdminController } from "./users-admin.controller";
import { UsersAdminService } from "./users-admin.service";

// F1-RBAC-03: UsersAdminController/-Service (CRUD admin bajo /users) viven
// en el MISMO módulo que UsersController/-Service (PATCH /me, self-service)
// — comparten dominio (tabla `users`) pero NO estado ni lógica.
@Module({
  imports: [AuditModule],
  controllers: [UsersController, UsersAdminController],
  providers: [UsersService, UsersAdminService],
})
export class UsersModule {}
