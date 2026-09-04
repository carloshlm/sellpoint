import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantsModule } from "../tenants/tenants.module";
import { CustomersService } from "./customers.service";
import { ReceptionCustomersController } from "./reception-customers.controller";
import { ReceptionSettingsController } from "./reception-settings.controller";
import { ReceptionSettingsService } from "./reception-settings.service";
import { ReceptionTurnsController } from "./reception-turns.controller";
import { TurnTicketService } from "./turn-ticket.service";
import { TurnsService } from "./turns.service";

/**
 * F9-RECEP — Recepción, el primer módulo vertical: el registro de clientes y
 * los turnos del día. Se activa por negocio desde el backoffice (F9-MOD); sin
 * el módulo, sus dos controllers responden 402.
 */
@Module({
  imports: [AuditModule, TenantsModule],
  controllers: [
    ReceptionCustomersController,
    ReceptionTurnsController,
    ReceptionSettingsController,
  ],
  providers: [CustomersService, TurnsService, TurnTicketService, ReceptionSettingsService],
  exports: [CustomersService, TurnsService],
})
export class ReceptionModule {}
