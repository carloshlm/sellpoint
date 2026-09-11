import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { PurchasesService } from "../purchases/purchases.service";
import {
  type CancelPurchaseOrderDto,
  type CreatePurchaseFromReceiptsDto,
  type CreatePurchaseOrderDto,
  cancelPurchaseOrderSchema,
  createPurchaseFromReceiptsSchema,
  createPurchaseOrderSchema,
  type ListPurchaseOrdersQuery,
  listPurchaseOrdersQuerySchema,
  type ReplacePurchaseOrderLinesDto,
  replacePurchaseOrderLinesSchema,
  type UpdatePurchaseOrderDto,
  updatePurchaseOrderSchema,
} from "./dto/purchase-order.dto";
import { PurchaseOrderPdfService } from "./purchase-order-pdf.service";
import { PurchaseOrdersService } from "./purchase-orders.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-PO-04 — las órdenes de compra. Viven bajo el módulo Compras
 * (`@RequiresModule("purchases")`) y con SUS permisos: `purchases:read` mira,
 * `:manage` captura, emite y cierra, `:cancel` anula. El ajuste del negocio
 * («Usar órdenes de compra») lo exige el service, solo para crear.
 */
@ApiTags("purchase-orders")
@RequiresModule("purchases")
@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly pdf: PurchaseOrderPdfService,
    private readonly purchases: PurchasesService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @RequirePermissions("purchases:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema, "purchase_orders.invalid_query"))
    query: ListPurchaseOrdersQuery,
  ) {
    return this.orders.list(user, scope, query);
  }

  /** El papel que se manda al proveedor. */
  @Get(":id/document")
  @RequirePermissions("purchases:read")
  async document(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const lang = getLocale(request as Request & RequestWithLocale);
    const { body, filename } = await this.pdf.build(user, id, (key) =>
      this.i18n.translate(key, { lang }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${filename}"`)
      .send(body);
  }

  @Get(":id")
  @RequirePermissions("purchases:read")
  detail(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.orders.detail(user, id);
  }

  @Post()
  @RequirePermissions("purchases:manage")
  create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema, "purchase_orders.invalid_body"))
    dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.orders.createDraft(user, scope, dto, metaFrom(request));
  }

  @Patch(":id")
  @RequirePermissions("purchases:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema, "purchase_orders.invalid_body"))
    dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.orders.updateHeader(user, scope, id, dto, metaFrom(request));
  }

  @Put(":id/lines")
  @RequirePermissions("purchases:manage")
  replaceLines(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replacePurchaseOrderLinesSchema, "purchase_orders.invalid_body"))
    dto: ReplacePurchaseOrderLinesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.orders.replaceLines(user, id, dto, metaFrom(request));
  }

  @Post(":id/issue")
  @HttpCode(200)
  @RequirePermissions("purchases:manage")
  issue(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.orders.issue(user, id, metaFrom(request));
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermissions("purchases:manage")
  close(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.orders.close(user, id, metaFrom(request));
  }

  @Post(":id/lines/:lineNo/close-short")
  @HttpCode(200)
  @RequirePermissions("purchases:manage")
  closeLineShort(
    @Param("id") id: string,
    @Param("lineNo", ParseIntPipe) lineNo: number,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.orders.closeLineShort(user, id, lineNo, metaFrom(request));
  }

  /**
   * F9-PO-09 — «Registrar compra de lo recibido»: la compra nace de las
   * recepciones confirmadas y sin factura de esta orden. Vive en el service
   * de Compras (es una compra); acá solo se expone bajo la orden.
   */
  @Post(":id/purchases")
  @HttpCode(201)
  @RequirePermissions("purchases:manage")
  createPurchase(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPurchaseFromReceiptsSchema, "purchase_orders.invalid_body"))
    dto: CreatePurchaseFromReceiptsDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.purchases.createFromReceipts(user, scope, id, dto.receiptIds, metaFrom(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("purchases:cancel")
  cancel(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelPurchaseOrderSchema, "purchase_orders.invalid_body"))
    dto: CancelPurchaseOrderDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.orders.cancel(user, id, dto, metaFrom(request));
  }
}
