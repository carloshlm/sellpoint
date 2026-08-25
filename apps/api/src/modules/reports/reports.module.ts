import { Module } from "@nestjs/common";
import { CostModule } from "../cost/cost.module";
import { ProductsModule } from "../products/products.module";
import { CatalogExportService } from "./catalog-export.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { SalesExportService } from "./sales-export.service";
import { SalesReportService } from "./sales-report.service";
import { StockExportService } from "./stock-export.service";
import { StockReportService } from "./stock-report.service";

/**
 * El módulo de reportes de la Fase 5. Nace con el catálogo del hub y va
 * sumando endpoints (stock, ventas, kardex, exports directos) a medida que
 * avanzan los módulos F5-STK, F5-SALES, F5-KDX y F5-CAT.
 */
@Module({
  imports: [CostModule, ProductsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    StockReportService,
    StockExportService,
    SalesReportService,
    SalesExportService,
    CatalogExportService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
