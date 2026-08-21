import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { CashboxService } from "./cashbox.service";
import { LookupService } from "./lookup.service";
import { PosController } from "./pos.controller";
import { QuotesService } from "./quotes.service";
import { SalesService } from "./sales.service";

/**
 * El punto de venta (Fase 4). Arranca con el TURNO — sin él no hay venta que
 * pueda saber de qué almacén descuenta.
 */
@Module({
  imports: [InventoryModule],
  controllers: [PosController],
  providers: [CashboxService, SalesService, LookupService, QuotesService],
  exports: [CashboxService, SalesService, LookupService, QuotesService],
})
export class PosModule {}
