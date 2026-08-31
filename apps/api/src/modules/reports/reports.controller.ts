import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CatalogExportService } from "./catalog-export.service";
import { DashboardKpisService } from "./dashboard-kpis.service";
import { type DirectExportQueryDto, directExportQuerySchema } from "./dto/direct-export.dto";
import { type KardexExportQueryDto, kardexExportQuerySchema } from "./dto/kardex-export.dto";
import {
  type SalesExportQueryDto,
  type SalesReportQueryDto,
  salesExportQuerySchema,
  salesReportQuerySchema,
} from "./dto/sales-report.dto";
import {
  type StockExportQueryDto,
  type StockReportQueryDto,
  stockExportQuerySchema,
  stockReportQuerySchema,
} from "./dto/stock-report.dto";
import { KardexExportService } from "./kardex-export.service";
import { ReportsService } from "./reports.service";
import { SalesExportService } from "./sales-export.service";
import { SalesReportService } from "./sales-report.service";
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
    private readonly salesReport: SalesReportService,
    private readonly salesExport: SalesExportService,
    private readonly catalogExport: CatalogExportService,
    private readonly kardexExport: KardexExportService,
    private readonly dashboardKpis: DashboardKpisService,
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

  /**
   * F5-SALES-01: las ventas para ANALIZAR.
   *
   * No reemplaza a `GET /pos/sales`, que es el mostrador: aquel pide
   * `pos:view` y NO aplica alcance —la cajera busca el ticket que el cliente
   * trae en la mano—; éste pide `reports:read` y sí lo aplica.
   */
  /**
   * F5-DASH-03 — los cuatro números de arriba del dashboard. Sin query: el
   * período es SIEMPRE «hoy y este mes» del negocio; los widgets con filtro
   * de período tienen sus propios endpoints (F5-DASH-05/07).
   */
  @Get("dashboard/kpis")
  @RequirePermissions("reports:read")
  dashboardKpisEndpoint(@CurrentUser() user: AuthUser, @CurrentUserScope() scope: UserScope) {
    return this.dashboardKpis.kpis(user, scope);
  }

  @Get("sales")
  @RequirePermissions("reports:read")
  sales(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(salesReportQuerySchema, "reports.invalid_query"))
    query: SalesReportQueryDto,
  ) {
    return this.salesReport.list(user, scope, query);
  }

  /** F5-SALES-02: las mismas ventas en Excel. */
  @Get("sales/export")
  @RequirePermissions("reports:read")
  async salesExportFile(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(salesExportQuerySchema, "reports.invalid_query"))
    query: SalesExportQueryDto,
    @Res() response: Response,
  ) {
    const file = await this.salesExport.build(user, scope, query);
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  /**
   * F5-CAT-01/02/03 — los tres exports DIRECTOS.
   *
   * Existen porque el permiso de sus listados es de EDICIÓN (`users:manage`,
   * `products:manage`) y un Viewer que solo lee se quedaba sin poder bajar su
   * propio catálogo. Exportar es leer.
   */
  @Get("users/export")
  @RequirePermissions("reports:read")
  async usersExportFile(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(directExportQuerySchema, "reports.invalid_query"))
    query: DirectExportQueryDto,
    @Res() response: Response,
  ) {
    this.descargar(response, await this.catalogExport.users(user, query.format));
  }

  @Get("warehouses/export")
  @RequirePermissions("reports:read")
  async warehousesExportFile(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(directExportQuerySchema, "reports.invalid_query"))
    query: DirectExportQueryDto,
    @Res() response: Response,
  ) {
    this.descargar(response, await this.catalogExport.warehouses(user, scope, query.format));
  }

  @Get("products/export")
  @RequirePermissions("reports:read")
  async productsExportFile(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(directExportQuerySchema, "reports.invalid_query"))
    query: DirectExportQueryDto,
    @Res() response: Response,
  ) {
    this.descargar(response, await this.catalogExport.products(user, query.format));
  }

  /**
   * F5-KDX-01: el kardex de un producto en Excel.
   *
   * Reusa `kardex.service.list`, así que el saldo del archivo es EL MISMO que
   * el de la pantalla — no hay una segunda implementación de la window
   * function que un día diga otra cosa.
   */
  @Get("kardex/:productId/export")
  @RequirePermissions("reports:read")
  async kardexExportFile(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("productId") productId: string,
    @Query(new ZodValidationPipe(kardexExportQuerySchema, "reports.invalid_query"))
    query: KardexExportQueryDto,
    @Res() response: Response,
  ) {
    const { format, ...filtros } = query;
    this.descargar(
      response,
      await this.kardexExport.build(user, scope, productId, filtros, format),
    );
  }

  /** Un solo lugar arma la descarga: siete endpoints repitiéndola era ruido. */
  private descargar(
    response: Response,
    file: { body: Buffer; contentType: string; filename: string },
  ) {
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
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
