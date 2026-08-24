import { Controller, Get, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type StockExportQueryDto,
  type StockReportQueryDto,
  stockExportQuerySchema,
  stockReportQuerySchema,
} from "./dto/stock-report.dto";
import { ReportsService } from "./reports.service";
import { StockExportService } from "./stock-export.service";
import { StockReportService } from "./stock-report.service";

/**
 * F5-CORE-03 — la puerta de `reports:read`.
 *
 * El permiso vive en producción desde la migración `20260821180000` y hasta
 * hoy NINGÚN endpoint lo exigía: lo delató `permissions-catalog.spec.ts`
 * buscando huérfanos. Un permiso sin puerta no se puede ejercer ni probar, y
 * este controller es la primera.
 *
 * **Sin `UserScope` en el catálogo, a propósito.** El alcance por almacén
 * acota DATOS de almacén y acá no hay ninguno: la lista de reportes es la
 * misma para todo el tenant. Los endpoints que sí traen datos —`/reports/stock`
 * (F5-STK-01), `/reports/sales` (F5-SALES-01)— lo reciben y lo aplican; pedirlo
 * acá sería un parámetro decorativo que insinúa un filtrado que no ocurre.
 */
@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly stockReport: StockReportService,
    private readonly stockExport: StockExportService,
  ) {}

  @Get()
  @RequirePermissions("reports:read")
  catalog() {
    return this.reportsService.catalog();
  }

  /**
   * F5-STK-01 y F5-STK-05: el stock por almacén, y con `detail=lots` el
   * detalle por lote y ubicación. Un modo del mismo endpoint y no uno aparte
   * porque son los mismos filtros sobre el mismo stock, mirado con más
   * resolución.
   */
  @Get("stock")
  @RequirePermissions("reports:read")
  stock(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(stockReportQuerySchema, "reports.invalid_query"))
    query: StockReportQueryDto,
  ) {
    return query.detail === "lots"
      ? this.stockReport.listLots(user, scope, query)
      : this.stockReport.list(user, scope, query);
  }

  /** F5-STK-02: lo mismo en Excel, con los MISMOS filtros. */
  @Get("stock/export")
  @RequirePermissions("reports:read")
  async stockExportFile(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(stockExportQuerySchema, "reports.invalid_query"))
    query: StockExportQueryDto,
    @Res() response: Response,
  ) {
    const file = await this.stockExport.build(user, scope, query);
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }
}
