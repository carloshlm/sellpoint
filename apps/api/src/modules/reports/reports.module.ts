import { Module } from "@nestjs/common";
import { CostModule } from "../cost/cost.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ProductsModule } from "../products/products.module";
import { CatalogExportService } from "./catalog-export.service";
import { DashboardInventoryService } from "./dashboard-inventory.service";
import { DashboardKpisService } from "./dashboard-kpis.service";
import { DashboardPaymentsService } from "./dashboard-payments.service";
import { DashboardProductsService } from "./dashboard-products.service";
import { DashboardSeriesService } from "./dashboard-series.service";
import { KardexExportService } from "./kardex-export.service";
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
  imports: [CostModule, ProductsModule, InventoryModule],
  controllers: [ReportsController],
  providers: [
    DashboardKpisService,
    DashboardSeriesService,
    DashboardProductsService,
    DashboardInventoryService,
    DashboardPaymentsService,
    ReportsService,
    StockReportService,
    StockExportService,
    SalesReportService,
    SalesExportService,
    CatalogExportService,
    KardexExportService,
  ],
  // F9-ADMIN-01: el expediente del backoffice reusa estos services con un
  // actor sintético (`admin/platform-actor.ts`).
  exports: [
    ReportsService,
    DashboardKpisService,
    DashboardSeriesService,
    DashboardProductsService,
    DashboardInventoryService,
    DashboardPaymentsService,
    SalesReportService,
    StockReportService,
    SalesExportService,
    StockExportService,
  ],
})
export class ReportsModule {}
