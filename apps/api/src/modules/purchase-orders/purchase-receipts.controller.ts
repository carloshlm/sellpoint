import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { UuidParam } from "../../common/http/uuid-param.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresFeature } from "../billing/decorators/requires-feature.decorator";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import {
  type CancelPurchaseReceiptDto,
  cancelPurchaseReceiptSchema,
  type ReplacePurchaseReceiptLinesDto,
  replacePurchaseReceiptLinesSchema,
  type UpdatePurchaseReceiptDto,
  updatePurchaseReceiptSchema,
} from "./dto/purchase-receipt.dto";
import { PurchaseReceiptsService } from "./purchase-receipts.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-PO-07 — las recepciones, ANIDADAS bajo su orden: una recepción no existe
 * sin ella. Mismo módulo y mismos permisos que la orden.
 */
@ApiTags("purchase-orders")
// F9-PLANLIST-01: el módulo Compras abre la puerta (Pro); planear con
// órdenes y recibir en partes es de Plus. Los dos en AND: sin módulo, 402
// hasta para leer; con módulo y sin el flag, se lee lo que hubo y no se
// crea nada nuevo.
@RequiresFeature("purchase_orders")
@RequiresModule("purchases")
@Controller("purchase-orders/:orderId/receipts")
export class PurchaseReceiptsController {
  constructor(private readonly receipts: PurchaseReceiptsService) {}

  @Get()
  @RequirePermissions("purchases:read")
  list(@UuidParam("orderId") orderId: string, @CurrentUser() user: AuthUser) {
    return this.receipts.list(user, orderId);
  }

  @Get(":receiptId")
  @RequirePermissions("purchases:read")
  detail(
    @UuidParam("orderId") orderId: string,
    @UuidParam("receiptId") receiptId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receipts.detail(user, orderId, receiptId);
  }

  /** Nace prellenada con lo pendiente de la orden. */
  @Post()
  @RequirePermissions("purchases:manage")
  create(
    @UuidParam("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.createDraft(user, orderId, metaFrom(request));
  }

  @Patch(":receiptId")
  @RequirePermissions("purchases:manage")
  update(
    @UuidParam("orderId") orderId: string,
    @UuidParam("receiptId") receiptId: string,
    @Body(new ZodValidationPipe(updatePurchaseReceiptSchema, "purchase_orders.invalid_body"))
    dto: UpdatePurchaseReceiptDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.updateHeader(user, orderId, receiptId, dto, metaFrom(request));
  }

  @Put(":receiptId/lines")
  @RequirePermissions("purchases:manage")
  replaceLines(
    @UuidParam("orderId") orderId: string,
    @UuidParam("receiptId") receiptId: string,
    @Body(new ZodValidationPipe(replacePurchaseReceiptLinesSchema, "purchase_orders.invalid_body"))
    dto: ReplacePurchaseReceiptLinesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.replaceLines(user, orderId, receiptId, dto, metaFrom(request));
  }

  @Post(":receiptId/confirm")
  @HttpCode(200)
  @RequirePermissions("purchases:manage")
  confirm(
    @UuidParam("orderId") orderId: string,
    @UuidParam("receiptId") receiptId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.confirm(user, orderId, receiptId, metaFrom(request));
  }

  @Post(":receiptId/cancel")
  @HttpCode(200)
  @RequirePermissions("purchases:cancel")
  cancel(
    @UuidParam("orderId") orderId: string,
    @UuidParam("receiptId") receiptId: string,
    @Body(new ZodValidationPipe(cancelPurchaseReceiptSchema, "purchase_orders.invalid_body"))
    dto: CancelPurchaseReceiptDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.cancel(user, orderId, receiptId, dto, metaFrom(request));
  }
}
