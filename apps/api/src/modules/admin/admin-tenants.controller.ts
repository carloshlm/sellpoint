import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  type DeleteTenantInput,
  deleteTenantSchema,
  type SuspendTenantInput,
  suspendTenantSchema,
} from "@sellpoint/shared";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { AllowedInFreeTier } from "../billing/decorators/allowed-in-free-tier.decorator";
import { PlatformAdminGuard } from "../billing/guards/platform-admin.guard";
import { DashboardInventoryService } from "../reports/dashboard-inventory.service";
import { DashboardKpisService } from "../reports/dashboard-kpis.service";
import { DashboardPaymentsService } from "../reports/dashboard-payments.service";
import { type DashboardPeriod, dashboardPeriodSchema } from "../reports/dashboard-period";
import { DashboardProductsService } from "../reports/dashboard-products.service";
import { DashboardSeriesService } from "../reports/dashboard-series.service";
import {
  type SalesExportQueryDto,
  type SalesReportQueryDto,
  salesExportQuerySchema,
  salesReportQuerySchema,
} from "../reports/dto/sales-report.dto";
import {
  type StockExportQueryDto,
  type StockReportQueryDto,
  stockExportQuerySchema,
  stockReportQuerySchema,
} from "../reports/dto/stock-report.dto";
import { SalesExportService } from "../reports/sales-export.service";
import { SalesReportService } from "../reports/sales-report.service";
import { StockExportService } from "../reports/stock-export.service";
import { StockReportService } from "../reports/stock-report.service";
import { UsersAdminService } from "../users/users-admin.service";
import { AdminTenantsService } from "./admin-tenants.service";
import { platformAdminActor, SCOPE_ALL } from "./platform-actor";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-ADMIN — el expediente de UN negocio en el backoffice: resumen, usuarios,
 * dashboard y reportes, espejo estructural de `/reports/*` bajo
 * `/admin/tenants/:tenantId/*` (por eso el web reusa sus hooks cambiando el
 * prefijo).
 *
 * `PlatformAdminGuard` y `@AllowedInFreeTier()` a nivel de CLASE, igual que
 * `AdminBillingController`. Todo lo que mira datos del negocio lo hace con
 * el actor sintético (`platformAdminActor`) y alcance total (`SCOPE_ALL`);
 * nunca con `@CurrentUserScope()`, que resolvería el alcance del admin en su
 * propio negocio.
 */
@ApiTags("admin")
@AllowedInFreeTier()
@UseGuards(PlatformAdminGuard)
@Controller("admin/tenants")
export class AdminTenantsController {
  constructor(
    private readonly tenants: AdminTenantsService,
    private readonly usersAdmin: UsersAdminService,
    private readonly dashboardKpis: DashboardKpisService,
    private readonly dashboardSeries: DashboardSeriesService,
    private readonly dashboardProducts: DashboardProductsService,
    private readonly dashboardInventory: DashboardInventoryService,
    private readonly dashboardPayments: DashboardPaymentsService,
    private readonly salesReport: SalesReportService,
    private readonly stockReport: StockReportService,
    private readonly salesExport: SalesExportService,
    private readonly stockExport: StockExportService,
  ) {}

  @Get(":tenantId/overview")
  overview(@Param("tenantId") tenantId: string, @CurrentUser() admin: AuthUser) {
    return this.tenants.overview(tenantId, admin);
  }

  /** F7-LIFECYCLE-03 — desactivar: el negocio deja de entrar; reversible. */
  @Post(":tenantId/suspend")
  @HttpCode(200)
  suspend(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(suspendTenantSchema, "admin.invalid_body"))
    body: SuspendTenantInput,
    @CurrentUser() admin: AuthUser,
    @Req() request: Request,
  ) {
    return this.tenants.suspend(admin, tenantId, body, metaFrom(request));
  }

  @Post(":tenantId/reactivate")
  @HttpCode(200)
  reactivate(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Req() request: Request,
  ) {
    return this.tenants.reactivate(admin, tenantId, metaFrom(request));
  }

  /**
   * F7-LIFECYCLE-05 — eliminar un negocio desactivado hace ≥ 30 días. El
   * cuerpo lleva el nombre exacto y la contraseña del PROPIO administrador.
   */
  @Delete(":tenantId")
  @HttpCode(200)
  purge(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(deleteTenantSchema, "admin.invalid_body")) body: DeleteTenantInput,
    @CurrentUser() admin: AuthUser,
    @Req() request: Request,
  ) {
    return this.tenants.purge(admin, tenantId, body, metaFrom(request));
  }

  // ── Usuarios (F9-ADMIN-03) ──────────────────────────────────────────────

  @Get(":tenantId/users")
  users(@Param("tenantId") tenantId: string, @CurrentUser() admin: AuthUser) {
    return this.usersAdmin.list(platformAdminActor(tenantId, admin));
  }

  /**
   * Las invariantes de `UsersAdminService` siguen mandando: el último admin
   * activo del negocio no se suspende (409). El audit del negocio registra al
   * dueño de la plataforma como actor — un usuario de OTRO tenant.
   */
  @Post(":tenantId/users/:userId/suspend")
  @HttpCode(200)
  suspendUser(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @CurrentUser() admin: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersAdmin.suspend(platformAdminActor(tenantId, admin), userId, metaFrom(request));
  }

  @Post(":tenantId/users/:userId/reactivate")
  @HttpCode(200)
  reactivateUser(
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @CurrentUser() admin: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersAdmin.reactivate(
      platformAdminActor(tenantId, admin),
      userId,
      metaFrom(request),
    );
  }

  // ── Dashboard (F9-ADMIN-04) ─────────────────────────────────────────────

  @Get(":tenantId/dashboard/kpis")
  kpis(@Param("tenantId") tenantId: string, @CurrentUser() admin: AuthUser) {
    return this.dashboardKpis.kpis(platformAdminActor(tenantId, admin), SCOPE_ALL);
  }

  @Get(":tenantId/dashboard/series")
  series(@Param("tenantId") tenantId: string, @CurrentUser() admin: AuthUser) {
    return this.dashboardSeries.series(platformAdminActor(tenantId, admin), SCOPE_ALL);
  }

  @Get(":tenantId/dashboard/products")
  products(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query("period", new ZodValidationPipe(dashboardPeriodSchema, "reports.invalid_query"))
    period: DashboardPeriod,
  ) {
    return this.dashboardProducts.products(platformAdminActor(tenantId, admin), SCOPE_ALL, period);
  }

  @Get(":tenantId/dashboard/inventory")
  inventory(@Param("tenantId") tenantId: string, @CurrentUser() admin: AuthUser) {
    return this.dashboardInventory.inventory(platformAdminActor(tenantId, admin), SCOPE_ALL);
  }

  @Get(":tenantId/dashboard/payment-methods")
  paymentMethods(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query("period", new ZodValidationPipe(dashboardPeriodSchema, "reports.invalid_query"))
    period: DashboardPeriod,
  ) {
    return this.dashboardPayments.paymentMethods(
      platformAdminActor(tenantId, admin),
      SCOPE_ALL,
      period,
    );
  }

  // ── Reportes (F9-ADMIN-05) ──────────────────────────────────────────────

  @Get(":tenantId/reports/sales")
  sales(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query(new ZodValidationPipe(salesReportQuerySchema, "reports.invalid_query"))
    query: SalesReportQueryDto,
  ) {
    return this.salesReport.list(platformAdminActor(tenantId, admin), SCOPE_ALL, query);
  }

  @Get(":tenantId/reports/stock")
  stock(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query(new ZodValidationPipe(stockReportQuerySchema, "reports.invalid_query"))
    query: StockReportQueryDto,
  ) {
    const actor = platformAdminActor(tenantId, admin);
    return query.detail === "lots"
      ? this.stockReport.listLots(actor, SCOPE_ALL, query)
      : this.stockReport.list(actor, SCOPE_ALL, query);
  }

  // ── Exportaciones (F9-ADMIN-13) ─────────────────────────────────────────

  @Get(":tenantId/reports/sales/export")
  async salesExportFile(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query(new ZodValidationPipe(salesExportQuerySchema, "reports.invalid_query"))
    query: SalesExportQueryDto,
    @Res() response: Response,
  ) {
    const file = await this.salesExport.build(
      platformAdminActor(tenantId, admin),
      SCOPE_ALL,
      query,
    );
    await this.descargar(response, tenantId, file);
  }

  @Get(":tenantId/reports/stock/export")
  async stockExportFile(
    @Param("tenantId") tenantId: string,
    @CurrentUser() admin: AuthUser,
    @Query(new ZodValidationPipe(stockExportQuerySchema, "reports.invalid_query"))
    query: StockExportQueryDto,
    @Res() response: Response,
  ) {
    const file = await this.stockExport.build(
      platformAdminActor(tenantId, admin),
      SCOPE_ALL,
      query,
    );
    await this.descargar(response, tenantId, file);
  }

  /** El archivo lleva el nombre del NEGOCIO, no el del admin que lo bajó. */
  private async descargar(
    response: Response,
    tenantId: string,
    file: { body: Buffer | string; contentType: string; filename: string },
  ) {
    const slug = await this.tenants.fileSlug(tenantId);
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${slug}-${file.filename}"`)
      .send(file.body);
  }
}
