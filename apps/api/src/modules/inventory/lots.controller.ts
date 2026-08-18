import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
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

  @Get("warehouses/:id/locations")
  @RequirePermissions("inventory:read")
  warehouseLocations(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
  ) {
    return this.lots.listWarehouseLocations(user, scope, id);
  }
}
