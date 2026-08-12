import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantCurrencyChangeableGuard } from "./guards/tenant-currency-changeable.guard";
import { TenantTransactionsGate } from "./tenant-transactions.gate";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [AuditModule],
  // F1-LOCALE-06: TenantTransactionsGate/TenantCurrencyChangeableGuard viven
  // acá porque son infra del dominio "tenants", listos para el endpoint de
  // update de tenant que trae F1-TENANT.
  providers: [TenantsService, TenantTransactionsGate, TenantCurrencyChangeableGuard],
  exports: [TenantsService, TenantTransactionsGate, TenantCurrencyChangeableGuard],
})
export class TenantsModule {}
