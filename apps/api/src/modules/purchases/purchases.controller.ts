import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import {
  type CancelPurchaseDto,
  type CreatePurchaseDto,
  cancelPurchaseSchema,
  createPurchaseSchema,
  type ListPurchasesQuery,
  listPurchasesQuerySchema,
  type ReplacePurchaseChargesDto,
  type ReplacePurchaseLinesDto,
  replacePurchaseChargesSchema,
  replacePurchaseLinesSchema,
  type UpdatePurchaseDto,
  type UpdateReceptionDto,
  updatePurchaseSchema,
  updateReceptionSchema,
} from "./dto/purchase.dto";
import { PurchaseLinesService } from "./purchase-lines.service";
import { PurchasePdfService } from "./purchase-pdf.service";
import { PurchasesService } from "./purchases.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F9-PURCH-05 — las compras. `@RequiresModule("purchases")` a nivel de CLASE:
 * sin el módulo (incluido desde Pro), el controller entero responde 402,
 * también las lecturas. `purchases:read` mira, `:manage` captura y confirma,
 * `:cancel` anula.
 */
@ApiTags("purchases")
@RequiresModule("purchases")
@Controller("purchases")
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly lines: PurchaseLinesService,
    private readonly pdf: PurchasePdfService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @RequirePermissions("purchases:read")
  list(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(listPurchasesQuerySchema, "purchases.invalid_query"))
    query: ListPurchasesQuery,
  ) {
    return this.purchases.list(user, scope, query);
  }

  /** El papel de la compra: lo que se archiva junto a la factura del proveedor. */
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
    return this.purchases.detail(user, id);
  }

  @Post()
  @RequirePermissions("purchases:manage")
  create(
    @Body(new ZodValidationPipe(createPurchaseSchema, "purchases.invalid_body"))
    dto: CreatePurchaseDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.purchases.createDraft(user, scope, dto, metaFrom(request));
  }

  /** Autoguardado de la cabecera del borrador. */
  @Patch(":id")
  @RequirePermissions("purchases:manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseSchema, "purchases.invalid_body"))
    dto: UpdatePurchaseDto,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Req() request: Request,
  ) {
    return this.purchases.updateHeader(user, scope, id, dto, metaFrom(request));
  }

  /** Lo único editable de una confirmada: cuándo llegó y con qué papel. */
  @Patch(":id/reception")
  @RequirePermissions("purchases:manage")
  reception(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateReceptionSchema, "purchases.invalid_body"))
    dto: UpdateReceptionDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.purchases.updateReception(user, id, dto, metaFrom(request));
  }

  /** Las líneas van en BLOQUE: cada guardado recompone los impuestos. */
  @Put(":id/lines")
  @RequirePermissions("purchases:manage")
  replaceLines(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replacePurchaseLinesSchema, "purchases.invalid_body"))
    dto: ReplacePurchaseLinesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.lines.replaceLines(user, id, dto, metaFrom(request));
  }

  @Put(":id/charges")
  @RequirePermissions("purchases:manage")
  replaceCharges(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replacePurchaseChargesSchema, "purchases.invalid_body"))
    dto: ReplacePurchaseChargesDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.lines.replaceCharges(user, id, dto, metaFrom(request));
  }

  @Post(":id/confirm")
  @HttpCode(200)
  @RequirePermissions("purchases:manage")
  confirm(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.purchases.confirm(user, id, metaFrom(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("purchases:cancel")
  cancel(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelPurchaseSchema, "purchases.invalid_body"))
    dto: CancelPurchaseDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.purchases.cancel(user, id, dto, metaFrom(request));
  }

  /**
   * El puente. Exige los DOS permisos en AND: sin `inventory:movement`,
   * `purchases:manage` sería un camino lateral para acuñar entradas de
   * inventario a nombre de quien solo debía capturar facturas.
   */
  @Post(":id/entry-draft")
  @HttpCode(201)
  @RequirePermissions("purchases:manage", "inventory:movement")
  entryDraft(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
  ) {
    return this.purchases.createEntryDraft(user, scope, id);
  }
}
