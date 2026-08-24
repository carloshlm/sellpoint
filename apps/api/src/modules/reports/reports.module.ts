import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * El módulo de reportes de la Fase 5. Nace con el catálogo del hub y va
 * sumando endpoints (stock, ventas, kardex, exports directos) a medida que
 * avanzan los módulos F5-STK, F5-SALES, F5-KDX y F5-CAT.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
