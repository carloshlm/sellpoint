import { Body, Controller, Get, HttpCode, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { TenantCurrencyChangeable } from "./decorators/tenant-currency-changeable.decorator";
import { type UpdateTenantDto, updateTenantSchema } from "./dto/update-tenant.dto";
import { TenantProfileService } from "./tenant-profile.service";

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

/**
 * F1-WEB-ONBOARD-01. Perfil del tenant PROPIO — gateado por `tenants:manage`
 * (D4 del design: "configurar el negocio" no es tarea de Manager, ver
 * `role-catalog.ts` MANAGER_EXCLUDED_CODES). `currency` en el PATCH pasa
 * ADEMÁS por `TenantCurrencyChangeableGuard` (F1-LOCALE-06).
 */
@ApiTags("tenants")
@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantProfileService: TenantProfileService) {}

  @Get("me")
  @RequirePermissions("tenants:manage")
  getMyTenant(@CurrentUser() user: AuthUser) {
    return this.tenantProfileService.getProfile(user);
  }

  @Patch("me")
  @RequirePermissions("tenants:manage")
  @TenantCurrencyChangeable()
  updateMyTenant(
    @Body(new ZodValidationPipe(updateTenantSchema, "tenants.invalid_body")) dto: UpdateTenantDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.tenantProfileService.update(user, dto, metaFrom(request));
  }

  // 200, no 201: transición de estado sobre un recurso existente (mismo
  // criterio que `UsersAdminController.suspend`).
  @Post("me/complete-onboarding")
  @HttpCode(200)
  @RequirePermissions("tenants:manage")
  completeOnboarding(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.tenantProfileService.completeOnboarding(user, metaFrom(request));
  }
}
