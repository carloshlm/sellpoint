import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { UuidParam } from "../../common/http/uuid-param.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresFeature } from "../billing/decorators/requires-feature.decorator";
import { type ListTransfersQueryDto, listTransfersQuerySchema } from "./dto/transfers-query.dto";
import { TransfersService } from "./transfers.service";

/** Una justificación de dos letras no es una justificación. */
const cancelTransferSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

@ApiTags("inventory")
@RequiresFeature("transfers")
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /**
   * `inventory:read` y no `inventory:movement`: mirar qué está en tránsito es
   * leer. Confirmar la recepción —que sí mueve stock— es otra puerta.
   *
   * Los parámetros basura se descartan en vez de reventar: un listado es lo
   * primero que abre alguien, y un 400 por un `page=abc` en un enlace viejo
   * sería una pared en la puerta. Los ids no: un almacén mal formado es 400
   * `common.invalid_id` (F10-MANFIX-20). Lo decide el DTO
   * (`dto/transfers-query.dto.ts`).
   */
  @Get()
  @RequirePermissions("inventory:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listTransfersQuerySchema, "inventory.invalid_body"))
    query: ListTransfersQueryDto,
  ) {
    return this.transfers.list(user, scope, query);
  }

  @Get(":id")
  @RequirePermissions("inventory:read")
  detail(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @UuidParam("id") id: string,
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
    @UuidParam("id") id: string,
  ) {
    return this.transfers.createReceiptDraft(user, scope, id);
  }

  /**
   * `inventory:manage` y no `inventory:movement`: cancelar es una decisión de
   * gestión. Quien mueve mercancía todos los días no debería poder borrar un
   * traspaso de un clic.
   */
  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("inventory:manage")
  cancel(
    @CurrentUser() user: AuthUser,
    @UuidParam("id") id: string,
    @Body(new ZodValidationPipe(cancelTransferSchema, "inventory.invalid_body"))
    dto: z.infer<typeof cancelTransferSchema>,
    @Req() request: Request,
  ) {
    return this.transfers.cancel(user, id, dto.reason, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
