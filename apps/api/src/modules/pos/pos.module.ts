import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { CostModule } from "../cost/cost.module";
import { InventoryModule } from "../inventory/inventory.module";
import { TenantsModule } from "../tenants/tenants.module";
import { WarehousesModule } from "../warehouses/warehouses.module";
import { CashboxService } from "./cashbox.service";
import { LookupService } from "./lookup.service";
import { PosController } from "./pos.controller";
import { QuotesService } from "./quotes.service";
import { SalesService } from "./sales.service";
import { TicketService } from "./ticket.service";

/**
 * El punto de venta (Fase 4). Arranca con el TURNO — sin él no hay venta que
 * pueda saber de qué almacén descuenta.
 *
 * `WarehousesModule` le presta `listScoped` a la lista de sucursales de la
 * caja (F10-MANFIX-08): la misma consulta, detrás de `pos:sell`.
 */
@Module({
  imports: [InventoryModule, BillingModule, CostModule, TenantsModule, WarehousesModule],
  controllers: [PosController],
  providers: [CashboxService, SalesService, LookupService, QuotesService, TicketService],
  exports: [CashboxService, SalesService, LookupService, QuotesService, TicketService],
})
export class PosModule {}
