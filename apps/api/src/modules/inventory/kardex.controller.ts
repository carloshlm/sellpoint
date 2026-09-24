import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { UuidParam } from "../../common/http/uuid-param.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type InTransitExportQueryDto,
  type InTransitQueryDto,
  inTransitExportQuerySchema,
  inTransitQuerySchema,
  type KardexQueryDto,
  kardexQuerySchema,
  type ProductStockQueryDto,
  productStockQuerySchema,
} from "./dto/kardex-query.dto";
import { InventoryExportService } from "./inventory-export.service";
import { KardexService } from "./kardex.service";

/**
 * F3-KARDEX-01 — el kardex vive en el módulo de INVENTARIO aunque su ruta
 * cuelgue de `/products`: lo que devuelve es movimiento, no catálogo. Mismo
 * criterio —y mismo permiso `inventory:read`— que los lotes de F3-LOTS-02.
 */
@ApiTags("inventory")
@Controller()
export class KardexController {
  constructor(
    private readonly kardex: KardexService,
    private readonly exports: InventoryExportService,
  ) {}

  /**
   * Los parámetros basura se descartan en vez de reventar —un kárdex es lo
   * primero que alguien abre desde un enlace viejo—, salvo los ids: un
   * almacén o un lote mal formado es 400 `common.invalid_id` (F10-MANFIX-20).
   * Todo eso lo decide el DTO (`dto/kardex-query.dto.ts`).
   */
  @Get("products/:id/kardex")
  @RequirePermissions("inventory:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @UuidParam("id") id: string,
    @Query(new ZodValidationPipe(kardexQuerySchema, "inventory.invalid_body"))
    query: KardexQueryDto,
  ) {
    return this.kardex.list(user, scope, id, query);
  }

  @Get("products/:id/stock")
  @RequirePermissions("inventory:read")
  stock(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @UuidParam("id") id: string,
    @Query(new ZodValidationPipe(productStockQuerySchema, "inventory.invalid_body"))
    query: ProductStockQueryDto,
  ) {
    return this.kardex.stock(user, scope, id, query.warehouseId);
  }

  /**
   * Stock que salió del origen y todavía nadie confirmó. El alcance mira el
   * ORIGEN: es mercancía de la que sigo siendo responsable.
   */
  /**
   * F5-EXP-02: lo mismo en Excel, pero SIN agrupar — el archivo se baja para
   * rastrear cada partida, no para saber el total.
   */
  @Get("inventory/in-transit/export")
  @RequirePermissions("inventory:read")
  async inTransitExport(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(inTransitExportQuerySchema, "inventory.invalid_body"))
    query: InTransitExportQueryDto,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const { format, ...filtros } = query;
    const file = await this.exports.inTransit(user, scope, filtros, format, getLocale(request));
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  @Get("inventory/in-transit")
  @RequirePermissions("inventory:read")
  inTransit(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(inTransitQuerySchema, "inventory.invalid_body"))
    query: InTransitQueryDto,
  ) {
    return this.kardex.inTransit(user, scope, query);
  }
}
