import { Body, Controller, Get, Param, Patch, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { normalizeLotCode } from "@sellpoint/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { InventoryExportService } from "./inventory-export.service";
import { LotsService } from "./lots.service";

/**
 * F3-LOTS-02 — las dos consultas de lotes.
 *
 * Viven en el módulo de INVENTARIO aunque sus rutas cuelguen de `/products` y
 * `/warehouses`: lo que devuelven es saldo, no catálogo. Ponerlas en los
 * controllers de esos módulos obligaría a inyectarles un servicio de
 * inventario y ataría dos módulos por una sola pantalla.
 *
 * El permiso es `inventory:read` y no `products:read` por lo mismo: quien
 * puede ver el catálogo no necesariamente puede ver cuánto hay.
 */
/**
 * El código de lote entra NORMALIZADO: mayúsculas y dígitos. `product_lots`
 * tiene `@@unique([productId, lotCode])`, así que `STM01` y `stm01` serían dos
 * lotes distintos del mismo producto — existencias partidas y FEFO tratándolos
 * por separado. Se hace acá y no solo en la pantalla porque cualquier otro
 * camino al API (una importación, otro cliente) se saltaría la regla.
 *
 * El `min(1)` va DESPUÉS del transform a propósito: `"---"` normaliza a vacío,
 * y eso tiene que ser un 400 —«ese código no sirve»— y no un lote sin nombre.
 */
function lotCodeField() {
  return z.string().trim().max(64).transform(normalizeLotCode).pipe(z.string().min(1).max(64));
}

/**
 * Los dos campos que un lote mal cargado necesita corregir. `expiresAt`
 * `nullish` a propósito: `null` es "este lote no vence", que es distinto de
 * "no lo toques" (`undefined`).
 */
const updateLotSchema = z.object({
  lotCode: lotCodeField().optional(),
  expiresAt: z.iso.date().nullish(),
});

@ApiTags("inventory")
@Controller()
export class LotsController {
  constructor(
    private readonly lots: LotsService,
    private readonly exports: InventoryExportService,
  ) {}

  @Get("products/:id/lots")
  @RequirePermissions("inventory:read")
  productLots(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
    @Query("withStock") withStock?: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    return this.lots.listProductLots(user, scope, id, {
      withStock: withStock === "true",
      warehouseId: warehouseId === "" ? undefined : warehouseId,
    });
  }

  /**
   * Lo que está por vencerse. `days` es un número de días, no una fecha: la
   * pantalla ofrece 7/30/90 y así el cliente no tiene que calcular nada.
   */
  /**
   * F5-EXP-01: lo mismo en Excel. `inventory:read` y no `reports:read`: es la
   * misma lectura de la pantalla en otro formato.
   */
  @Get("inventory/expiring/export")
  @RequirePermissions("inventory:read")
  async expiringExport(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Res() response: Response,
    @Query("days") days?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("format") format?: string,
  ) {
    const parsed = Number(days);
    const file = await this.exports.expiring(
      user,
      scope,
      {
        days: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 30,
        ...(warehouseId !== undefined && warehouseId !== "" ? { warehouseId } : {}),
      },
      format === "csv" ? "csv" : "xlsx",
    );
    response
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }

  @Get("inventory/expiring")
  @RequirePermissions("inventory:read")
  expiring(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query("days") days?: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    const parsed = Number(days);
    return this.lots.listExpiring(user, scope, {
      // 30 días es el default del tablero. Un `days` basura cae acá y no en un
      // 500: pedir "próximos a vencer" sin decir cuántos días es razonable.
      days: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 30,
      warehouseId: warehouseId === "" ? undefined : warehouseId,
    });
  }

  @Get("warehouses/:id/locations")
  @RequirePermissions("inventory:read")
  warehouseLocations(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
  ) {
    return this.lots.listWarehouseLocations(user, scope, id);
  }

  /**
   * `inventory:movement` y no `inventory:read`: corregir una caducidad
   * REORDENA de qué partida sale la próxima venta. Es una operación de
   * inventario, aunque parezca una edición de catálogo.
   */
  @Patch("products/:id/lots/:lotId")
  @RequirePermissions("inventory:movement")
  updateLot(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("lotId") lotId: string,
    @Body(new ZodValidationPipe(updateLotSchema, "inventory.invalid_body"))
    dto: z.infer<typeof updateLotSchema>,
    @Req() request: Request,
  ) {
    return this.lots.updateLot(user, id, lotId, dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
