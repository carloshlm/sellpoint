import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { CostModule } from "../cost/cost.module";
import { BarcodeCatalogService } from "./barcode-catalog.service";
import { BarcodeContributionService } from "./barcode-contribution.service";
import { CompositionService } from "./composition.service";
import { ImportService } from "./import.service";
import { PresentationsService } from "./presentations.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { QuickAddService } from "./quick-add.service";

// F2-PROD / F2-PRESENT / F2-BOM viven en el MISMO módulo: presentaciones y
// composición no existen sin un producto y sus rutas cuelgan de él.
//
// `BillingModule` desde F10-MANFIX-06: encender el control por lote es de
// Plus, y ese candado depende del CUERPO (la casilla), no de la ruta, así que
// lo revisan el alta, la edición y la importación con `EntitlementsService`.
@Module({
  imports: [AuditModule, BillingModule, CostModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    PresentationsService,
    CompositionService,
    ImportService,
    BarcodeCatalogService,
    BarcodeContributionService,
    QuickAddService,
  ],
  // `ImportService` sale del módulo desde F5-CAT-03: el reporte de catálogo
  // reusa su `catalogRows` para que las columnas no diverjan de la plantilla.
  exports: [ProductsService, CompositionService, ImportService],
})
export class ProductsModule {}
