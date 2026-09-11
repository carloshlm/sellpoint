import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PurchaseOrderPdfService } from "./purchase-order-pdf.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";

/**
 * F9-PO — Órdenes de compra y recepciones: el compromiso con el proveedor y
 * el papel del andén. Vive bajo el módulo Compras (mismo `@RequiresModule` y
 * mismos permisos) y se enciende por negocio (`tenants.uses_purchase_orders`).
 *
 * No importa `PurchasesModule`: la composición fiscal que comparte con la
 * compra son funciones de módulo (`armarCompraConGrupos`, `gruposPorCodigo`),
 * no services inyectados.
 */
@Module({
  imports: [AuditModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PurchaseOrderPdfService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
