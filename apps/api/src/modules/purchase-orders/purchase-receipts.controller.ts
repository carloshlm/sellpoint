import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
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
@RequiresModule("purchases")
@Controller("purchase-orders/:orderId/receipts")
export class PurchaseReceiptsController {
  constructor(private readonly receipts: PurchaseReceiptsService) {}

  @Get()
  @RequirePermissions("purchases:read")
  list(@Param("orderId") orderId: string, @CurrentUser() user: AuthUser) {
    return this.receipts.list(user, orderId);
  }

  @Get(":receiptId")
  @RequirePermissions("purchases:read")
  detail(
    @Param("orderId") orderId: string,
    @Param("receiptId") receiptId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.receipts.detail(user, orderId, receiptId);
  }

  /** Nace prellenada con lo pendiente de la orden. */
  @Post()
  @RequirePermissions("purchases:manage")
  create(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.createDraft(user, orderId, metaFrom(request));
  }

  @Patch(":receiptId")
  @RequirePermissions("purchases:manage")
  update(
    @Param("orderId") orderId: string,
    @Param("receiptId") receiptId: string,
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
    @Param("orderId") orderId: string,
    @Param("receiptId") receiptId: string,
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
    @Param("orderId") orderId: string,
    @Param("receiptId") receiptId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.confirm(user, orderId, receiptId, metaFrom(request));
  }

  @Post(":receiptId/cancel")
  @HttpCode(200)
  @RequirePermissions("purchases:cancel")
  cancel(
    @Param("orderId") orderId: string,
    @Param("receiptId") receiptId: string,
    @Body(new ZodValidationPipe(cancelPurchaseReceiptSchema, "purchase_orders.invalid_body"))
    dto: CancelPurchaseReceiptDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.receipts.cancel(user, orderId, receiptId, dto, metaFrom(request));
  }
}
