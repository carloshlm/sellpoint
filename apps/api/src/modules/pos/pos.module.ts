import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { CostModule } from "../cost/cost.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ReportsModule } from "../reports/reports.module";
import { TenantsModule } from "../tenants/tenants.module";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { AuthorizationCodeService } from "./authorization-code.service";
import { CashMovementsService } from "./cash-movements.service";
import { CashboxService } from "./cashbox.service";
import { LookupService } from "./lookup.service";
import { PosController } from "./pos.controller";
import { QuotesService } from "./quotes.service";
import { SaleHooksRegistry } from "./sale-hooks";
import { SalesService } from "./sales.service";
import { TicketService } from "./ticket.service";

/**
 * El punto de venta (Fase 4). Arranca con el TURNO — sin él no hay venta que
 * pueda saber de qué almacén descuenta.
 *
 * `WarehousesModule` le presta `listScoped` a la lista de sucursales de la
 * caja (F10-MANFIX-08): la misma consulta, detrás de `pos:sell`.
 *
 * `AuditModule` por las entradas y los retiros de efectivo (F10-CASHMOV-02):
 * su alta y su anulación quedan en la bitácora, como los gastos. Es el mismo
 * módulo que importa Gastos; el POS no importa `ExpensesModule`.
 */
@Module({
  // ReportsModule por el PDF del cierre (Carlos, 2026-11-16): sale del mismo
  // detalle que el reporte de cierres.
  imports: [
    InventoryModule,
    BillingModule,
    CostModule,
    TenantsModule,
    WarehousesModule,
    ReportsModule,
    AuditModule,
  ],
  controllers: [PosController],
  // `SaleHooksRegistry` se EXPORTA para que un módulo vertical registre su
  // gancho de venta (ley 31): el módulo importa el POS, el POS no lo importa.
  providers: [
    CashboxService,
    CashMovementsService,
    AuthorizationCodeService,
    SalesService,
    LookupService,
    QuotesService,
    TicketService,
    SaleHooksRegistry,
  ],
  exports: [
    CashboxService,
    SalesService,
    LookupService,
    QuotesService,
    TicketService,
    SaleHooksRegistry,
  ],
})
export class PosModule {}
