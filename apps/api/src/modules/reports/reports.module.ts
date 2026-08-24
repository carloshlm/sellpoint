import { Module } from "@nestjs/common";
import { CostModule } from "../cost/cost.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { StockExportService } from "./stock-export.service";
import { StockReportService } from "./stock-report.service";

/**
 * El módulo de reportes de la Fase 5. Nace con el catálogo del hub y va
 * sumando endpoints (stock, ventas, kardex, exports directos) a medida que
 * avanzan los módulos F5-STK, F5-SALES, F5-KDX y F5-CAT.
 */
@Module({
  imports: [CostModule],
  controllers: [ReportsController],
  providers: [ReportsService, StockReportService, StockExportService],
  exports: [ReportsService],
})
export class ReportsModule {}
