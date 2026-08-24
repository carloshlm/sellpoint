import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { MovementDirection, MovementReason } from "@sellpoint/shared";
import { MOVEMENT_DIRECTIONS, MOVEMENT_REASONS } from "@sellpoint/shared";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { KardexService } from "./kardex.service";

/**
 * El día del calendario tal como lo escribió el usuario (`YYYY-MM-DD`).
 *
 * NO se convierte a `Date` acá: traducir un día a instantes UTC depende de la
 * zona del NEGOCIO, y el controlador no la conoce. Antes se hacía
 * `new Date(raw)`, que lo interpretaba como medianoche UTC y dejaba fuera
 * todo lo del día en cualquier zona al oeste de Greenwich — el bug que
 * Carlos reportó el 2026-08-24. La conversión vive en el service, que sí
 * tiene el tenant a mano.
 */
function diaDelCalendario(raw?: string): string | undefined {
  return raw !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function entero(raw?: string): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/**
 * F3-KARDEX-01 — el kardex vive en el módulo de INVENTARIO aunque su ruta
 * cuelgue de `/products`: lo que devuelve es movimiento, no catálogo. Mismo
 * criterio —y mismo permiso `inventory:read`— que los lotes de F3-LOTS-02.
 */
@ApiTags("inventory")
@Controller()
export class KardexController {
  constructor(private readonly kardex: KardexService) {}

  @Get("products/:id/kardex")
  @RequirePermissions("inventory:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ) {
    // Los parámetros basura se descartan en vez de reventar: un kardex es lo
    // primero que alguien abre desde un link viejo.
    const direction = MOVEMENT_DIRECTIONS.includes(query.direction as MovementDirection)
      ? (query.direction as MovementDirection)
      : undefined;
    const reasonCode = MOVEMENT_REASONS.includes(query.reasonCode as MovementReason)
      ? (query.reasonCode as MovementReason)
      : undefined;

    return this.kardex.list(user, scope, id, {
      warehouseId: query.warehouseId || undefined,
      from: diaDelCalendario(query.from),
      to: diaDelCalendario(query.to),
      direction,
      reasonCode,
      lotId: query.lotId || undefined,
      page: entero(query.page),
      pageSize: entero(query.pageSize),
    });
  }

  @Get("products/:id/stock")
  @RequirePermissions("inventory:read")
  stock(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    return this.kardex.stock(user, scope, id, warehouseId || undefined);
  }

  /**
   * Stock que salió del origen y todavía nadie confirmó. El alcance mira el
   * ORIGEN: es mercancía de la que sigo siendo responsable.
   */
  @Get("inventory/in-transit")
  @RequirePermissions("inventory:read")
  inTransit(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query() query: Record<string, string>,
  ) {
    return this.kardex.inTransit(user, scope, {
      productId: query.productId || undefined,
      originWarehouseId: query.originWarehouseId || undefined,
    });
  }
}
