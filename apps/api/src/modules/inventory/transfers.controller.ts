import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TRANSFER_STATUSES } from "@sellpoint/shared";
import type { TransferStatus } from "../../generated/prisma/client";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { TransfersService } from "./transfers.service";

/** Una fecha de query string, o `undefined` si vino basura. */
function fecha(raw?: string): Date | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function entero(raw?: string): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

@ApiTags("inventory")
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /**
   * `inventory:read` y no `inventory:movement`: mirar qué está en tránsito es
   * leer. Confirmar la recepción —que sí mueve stock— es otra puerta.
   *
   * Los parámetros basura se descartan en vez de reventar: un listado es lo
   * primero que abre alguien, y un 400 por un `page=abc` en un enlace viejo
   * sería una pared en la puerta.
   */
  @Get()
  @RequirePermissions("inventory:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query() query: Record<string, string>,
  ) {
    const status = TRANSFER_STATUSES.includes(query.status as TransferStatus)
      ? (query.status as TransferStatus)
      : undefined;
    const direction =
      query.direction === "incoming" || query.direction === "outgoing"
        ? query.direction
        : undefined;

    return this.transfers.list(user, scope, {
      status,
      direction,
      originWarehouseId: query.originWarehouseId || undefined,
      destinationWarehouseId: query.destinationWarehouseId || undefined,
      from: fecha(query.from),
      to: fecha(query.to),
      olderThanDays: entero(query.olderThanDays),
      page: entero(query.page),
      pageSize: entero(query.pageSize),
    });
  }

  @Get(":id")
  @RequirePermissions("inventory:read")
  detail(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
  ) {
    return this.transfers.detail(user, scope, id);
  }

  /**
   * `inventory:movement` y no `inventory:read`: crear el borrador es el primer
   * paso de un movimiento, aunque todavía no mueva nada.
   */
  @Post(":id/receipt-draft")
  @HttpCode(201)
  @RequirePermissions("inventory:movement")
  receiptDraft(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Param("id") id: string,
  ) {
    return this.transfers.createReceiptDraft(user, scope, id);
  }
}
