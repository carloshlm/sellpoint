import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchaseLinesService } from "./purchase-lines.service";
import { PurchasePdfService } from "./purchase-pdf.service";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

/**
 * F9-PURCH — Compras: la factura del proveedor y su puente a la entrada de
 * inventario. Incluido desde Pro (`MODULE_MIN_PLAN`); sin el módulo, su
 * controller responde 402.
 *
 * Importa `InventoryModule` para anular el borrador de entrada dentro de la
 * MISMA transacción (`cancelDraftWithinTx`). La dependencia va en un solo
 * sentido: el inventario no sabe que Compras existe — solo guarda un par
 * opaco (`source_module`/`source_ref`).
 */
@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchaseLinesService, PurchasePdfService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
