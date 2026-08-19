import { Body, Controller, Get, Param, Patch, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
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
 * Los dos campos que un lote mal cargado necesita corregir. `expiresAt`
 * `nullish` a propósito: `null` es "este lote no vence", que es distinto de
 * "no lo toques" (`undefined`).
 */
const updateLotSchema = z.object({
  lotCode: z.string().trim().min(1).max(64).optional(),
  expiresAt: z.iso.date().nullish(),
});

@ApiTags("inventory")
@Controller()
export class LotsController {
  constructor(private readonly lots: LotsService) {}

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
