import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PosModule } from "../pos/pos.module";
import { TenantsModule } from "../tenants/tenants.module";
import { CustomersService } from "./customers.service";
import { ReceptionCustomersController } from "./reception-customers.controller";
import { ReceptionSaleHook } from "./reception-sale.hook";
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
  // `PosModule` para registrar el gancho de venta (F9-RECEP-26, ley 31): el
  // módulo importa el POS; el POS nunca importa a Recepción.
  imports: [AuditModule, TenantsModule, PosModule],
  controllers: [
    ReceptionCustomersController,
    ReceptionTurnsController,
    ReceptionSettingsController,
  ],
  providers: [
    CustomersService,
    TurnsService,
    TurnTicketService,
    ReceptionSettingsService,
    ReceptionSaleHook,
  ],
  exports: [CustomersService, TurnsService],
})
export class ReceptionModule {}
