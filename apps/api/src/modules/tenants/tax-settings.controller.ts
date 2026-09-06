import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { type UpdateTaxSettingsDto, updateTaxSettingsSchema } from "./dto/tax-settings.dto";
import { TaxSettingsService } from "./tax-settings.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/** F4-TAX-09 — los impuestos son configuración del NEGOCIO: misma llave que «Datos del negocio». */
@ApiTags("tenants")
@Controller("tenants/me/taxes")
export class TaxSettingsController {
  constructor(private readonly settings: TaxSettingsService) {}

  /**
   * Leer no exige `tenants:manage`: el selector «Impuesto» del alta de
   * productos, servicios y estudios lo necesita cualquiera que edite el
   * catálogo, y la lista de tasas no es un secreto del negocio.
   */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions("tenants:manage")
  update(
    @Body(new ZodValidationPipe(updateTaxSettingsSchema, "tenants.invalid_body"))
    dto: UpdateTaxSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.settings.save(user, dto, metaFrom(request));
  }

  @Delete("groups/:code")
  @RequirePermissions("tenants:manage")
  removeGroup(@Param("code") code: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.settings.removeGroup(user, code.toUpperCase(), metaFrom(request));
  }
}
