import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantCurrencyChangeableGuard } from "./guards/tenant-currency-changeable.guard";
import { TenantProfileService } from "./tenant-profile.service";
import { TenantTransactionsGate } from "./tenant-transactions.gate";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { TicketSettingsController } from "./ticket-settings.controller";
import { TicketSettingsService } from "./ticket-settings.service";

@Module({
  imports: [AuditModule],
  controllers: [TenantsController, TicketSettingsController],
  // F1-LOCALE-06: TenantTransactionsGate/TenantCurrencyChangeableGuard viven
  // acá porque son infra del dominio "tenants". F1-WEB-ONBOARD-01 los cablea
  // en `TenantsController` (PATCH /tenants/me).
  providers: [
    TenantsService,
    TenantProfileService,
    TenantTransactionsGate,
    TenantCurrencyChangeableGuard,
    TicketSettingsService,
  ],
  // F4-TICKETCFG: los tres papeles (ticket, turno, orden médica) leen la
  // configuración dentro de su propia transacción.
  exports: [
    TenantsService,
    TenantTransactionsGate,
    TenantCurrencyChangeableGuard,
    TicketSettingsService,
  ],
})
export class TenantsModule {}
