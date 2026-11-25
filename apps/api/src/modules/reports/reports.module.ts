import { Module } from "@nestjs/common";
import { CostModule } from "../cost/cost.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ProductsModule } from "../products/products.module";
import { CatalogExportService } from "./catalog-export.service";
import { DashboardControlService } from "./dashboard-control.service";
import { DashboardInventoryService } from "./dashboard-inventory.service";
import { DashboardKpisService } from "./dashboard-kpis.service";
import { DashboardPaymentsService } from "./dashboard-payments.service";
import { DashboardProductsService } from "./dashboard-products.service";
import { DashboardSeriesService } from "./dashboard-series.service";
import { ItemsRankingService } from "./items-ranking.service";
import { ItemsReportService } from "./items-report.service";
import { ItemsReportExportService } from "./items-report-export.service";
import { KardexExportService } from "./kardex-export.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { SalesExportService } from "./sales-export.service";
import { SalesLinesExportService } from "./sales-lines-export.service";
import { SalesLinesReportService } from "./sales-lines-report.service";
import { SalesReportService } from "./sales-report.service";
import { ShiftPdfService } from "./shift-pdf.service";
import { ShiftsExportService } from "./shifts-export.service";
import { ShiftsReportService } from "./shifts-report.service";
import { StockExportService } from "./stock-export.service";
import { StockReportService } from "./stock-report.service";
import { TaxExportService } from "./tax-export.service";
import { TaxReportService } from "./tax-report.service";

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
    DashboardControlService,
    ReportsService,
    StockReportService,
    StockExportService,
    SalesReportService,
    SalesExportService,
    SalesLinesReportService,
    SalesLinesExportService,
    ShiftsReportService,
    ShiftsExportService,
    ShiftPdfService,
    TaxReportService,
    TaxExportService,
    CatalogExportService,
    KardexExportService,
    ItemsRankingService,
    ItemsReportService,
    ItemsReportExportService,
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
    DashboardControlService,
    SalesReportService,
    StockReportService,
    SalesExportService,
    StockExportService,
    ShiftsReportService,
    ShiftsExportService,
    ShiftPdfService,
    TaxReportService,
    TaxExportService,
    SalesLinesReportService,
    SalesLinesExportService,
    // F10-RPT-03: el reporte por artículo, para que el expediente lo reuse.
    ItemsRankingService,
    ItemsReportService,
    ItemsReportExportService,
  ],
})
export class ReportsModule {}
