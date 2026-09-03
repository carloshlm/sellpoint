import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CustomersService } from "./customers.service";
import { ReceptionCustomersController } from "./reception-customers.controller";
import { ReceptionTurnsController } from "./reception-turns.controller";
import { TurnTicketService } from "./turn-ticket.service";
import { TurnsService } from "./turns.service";

/**
 * F9-RECEP — Recepción, el primer módulo vertical: el registro de clientes y
 * los turnos del día. Se activa por negocio desde el backoffice (F9-MOD); sin
 * el módulo, sus dos controllers responden 402.
 */
@Module({
  imports: [AuditModule],
  controllers: [ReceptionCustomersController, ReceptionTurnsController],
  providers: [CustomersService, TurnsService, TurnTicketService],
  exports: [CustomersService, TurnsService],
})
export class ReceptionModule {}
