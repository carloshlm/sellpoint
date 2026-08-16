import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CompositionService } from "./composition.service";
import { PresentationsService } from "./presentations.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

// F2-PROD / F2-PRESENT / F2-BOM viven en el MISMO módulo: presentaciones y
// composición no existen sin un producto y sus rutas cuelgan de él.
@Module({
  imports: [AuditModule],
  controllers: [ProductsController],
  providers: [ProductsService, PresentationsService, CompositionService],
  exports: [ProductsService],
})
export class ProductsModule {}
