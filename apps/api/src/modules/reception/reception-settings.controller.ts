import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type UpdateReceptionSettingsDto, updateReceptionSettingsSchema } from "./dto/settings.dto";
import { ReceptionSettingsService } from "./reception-settings.service";

/**
 * F9-RECEP-17 — la configuración de Recepción.
 *
 * LEER la puede cualquiera que vea el módulo (`reception:read`): la palabra y
 * las entradas del menú se pintan en la pantalla de la recepcionista, no solo
 * en la del admin. CAMBIARLA es configuración del NEGOCIO: la misma llave que
 * «Datos del negocio» (`tenants:manage`).
 */
@ApiTags("reception")
@RequiresModule("reception")
@Controller("reception/settings")
export class ReceptionSettingsController {
  constructor(private readonly settings: ReceptionSettingsService) {}

  @Get()
  @RequirePermissions("reception:read")
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions("tenants:manage")
  update(
    @Body(new ZodValidationPipe(updateReceptionSettingsSchema, "reception.invalid_body"))
    dto: UpdateReceptionSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.settings.update(user, dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
