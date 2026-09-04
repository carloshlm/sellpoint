import { Body, Controller, Delete, Get, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type UpdateTicketSettingsDto,
  type UploadTicketLogoDto,
  updateTicketSettingsSchema,
  uploadTicketLogoSchema,
} from "./dto/ticket-settings.dto";
import { TicketSettingsService } from "./ticket-settings.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F4-TICKETCFG-04 — la configuración del ticket es configuración del
 * NEGOCIO: misma llave que «Datos del negocio» (`tenants:manage`).
 *
 * La imagen propia viaja en base64 dentro del JSON (`PUT logo`), como las
 * importaciones: cabe de sobra en el límite de 6 MB del body y no obliga a
 * meter multipart en un API que no lo usa en ningún otro lado.
 */
@ApiTags("tenants")
@Controller("tenants/me/ticket-settings")
export class TicketSettingsController {
  constructor(private readonly settings: TicketSettingsService) {}

  @Get()
  @RequirePermissions("tenants:manage")
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions("tenants:manage")
  update(
    @Body(new ZodValidationPipe(updateTicketSettingsSchema, "tenants.invalid_body"))
    dto: UpdateTicketSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.settings.update(user, dto, metaFrom(request));
  }

  @Put("logo")
  @RequirePermissions("tenants:manage")
  setLogo(
    @Body(new ZodValidationPipe(uploadTicketLogoSchema, "tenants.invalid_body"))
    dto: UploadTicketLogoDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.settings.setLogo(user, dto.content, metaFrom(request));
  }

  @Delete("logo")
  @RequirePermissions("tenants:manage")
  clearLogo(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.settings.clearLogo(user, metaFrom(request));
  }
}
