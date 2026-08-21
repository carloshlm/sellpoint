import { Module } from "@nestjs/common";
import { CashboxService } from "./cashbox.service";
import { PosController } from "./pos.controller";

/**
 * El punto de venta (Fase 4). Arranca con el TURNO — sin él no hay venta que
 * pueda saber de qué almacén descuenta.
 */
@Module({
  controllers: [PosController],
  providers: [CashboxService],
  exports: [CashboxService],
})
export class PosModule {}
