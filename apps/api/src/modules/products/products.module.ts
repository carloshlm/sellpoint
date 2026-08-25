import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CostModule } from "../cost/cost.module";
import { CompositionService } from "./composition.service";
import { ImportService } from "./import.service";
import { PresentationsService } from "./presentations.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

// F2-PROD / F2-PRESENT / F2-BOM viven en el MISMO módulo: presentaciones y
// composición no existen sin un producto y sus rutas cuelgan de él.
@Module({
  imports: [AuditModule, CostModule],
  controllers: [ProductsController],
  providers: [ProductsService, PresentationsService, CompositionService, ImportService],
  // `ImportService` sale del módulo desde F5-CAT-03: el reporte de catálogo
  // reusa su `catalogRows` para que las columnas no diverjan de la plantilla.
  exports: [ProductsService, CompositionService, ImportService],
})
export class ProductsModule {}
