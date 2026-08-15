import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantCurrencyChangeableGuard } from "./guards/tenant-currency-changeable.guard";
import { TenantProfileService } from "./tenant-profile.service";
import { TenantTransactionsGate } from "./tenant-transactions.gate";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [AuditModule],
  controllers: [TenantsController],
  // F1-LOCALE-06: TenantTransactionsGate/TenantCurrencyChangeableGuard viven
  // acá porque son infra del dominio "tenants". F1-WEB-ONBOARD-01 los cablea
  // en `TenantsController` (PATCH /tenants/me).
  providers: [
    TenantsService,
    TenantProfileService,
    TenantTransactionsGate,
    TenantCurrencyChangeableGuard,
  ],
  exports: [TenantsService, TenantTransactionsGate, TenantCurrencyChangeableGuard],
})
export class TenantsModule {}
