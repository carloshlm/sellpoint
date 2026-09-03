import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type UpdateSettingsDto, updateSettingsSchema } from "./dto/settings.dto";
import { SettingsService } from "./settings.service";

/**
 * F9-CLINIC-22 — la configuración del consultorio es configuración del
 * NEGOCIO: misma llave que «Datos del negocio» (`tenants:manage`), y solo con
 * el módulo activo.
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic/settings")
export class MedicalClinicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions("tenants:manage")
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Put()
  @RequirePermissions("tenants:manage")
  update(
    @Body(new ZodValidationPipe(updateSettingsSchema, "medical_clinic.invalid_body"))
    dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.settings.update(user, dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
