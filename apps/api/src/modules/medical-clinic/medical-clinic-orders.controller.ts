import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { I18nService } from "nestjs-i18n";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type CreateOrderDto, createOrderSchema } from "./dto/orders.dto";
import { MedicalOrderPdfService } from "./medical-order-pdf.service";
import { MedicalOrdersService } from "./medical-orders.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/** F9-CLINIC-14/15/24 — las órdenes médicas de un expediente y su papel. */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic")
export class MedicalClinicOrdersController {
  constructor(
    private readonly orders: MedicalOrdersService,
    private readonly pdf: MedicalOrderPdfService,
    private readonly i18n: I18nService,
  ) {}

  @Post("records/:recordId/orders")
  @RequirePermissions("medical_clinic:attend")
  create(
    @Param("recordId") recordId: string,
    @Body(new ZodValidationPipe(createOrderSchema, "medical_clinic.invalid_body"))
    dto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.orders.create(user, recordId, dto, metaFrom(request));
  }

  @Get("records/:recordId/orders")
  @RequirePermissions("medical_clinic:attend")
  list(@Param("recordId") recordId: string, @CurrentUser() user: AuthUser) {
    return this.orders.list(user, recordId);
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  @RequirePermissions("medical_clinic:attend")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.orders.cancel(user, id, metaFrom(request));
  }

  /** El documento carta. Binario: el front lo baja con `responseType: 'blob'`. */
  @Get("orders/:id/document")
  @RequirePermissions("medical_clinic:attend")
  async document(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ) {
    const locale = getLocale(request);
    const file = await this.pdf.render(user, id, (key) =>
      this.i18n.translate(key, { lang: locale }),
    );
    response
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  }
}
