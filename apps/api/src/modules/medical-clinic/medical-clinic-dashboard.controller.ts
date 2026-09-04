import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type DashboardPeriod, dashboardPeriodSchema } from "../reports/dashboard-period";
import { MedicalClinicDashboardService } from "./medical-clinic-dashboard.service";

/**
 * F9-CLINIC-30 — el tablero del consultorio.
 *
 * Con `medical_clinic:read`: quien puede ver los catálogos puede ver qué se
 * vendió de ellos. El alcance por almacén no aplica — una orden médica es del
 * consultorio, no de una bodega.
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic/dashboard")
export class MedicalClinicDashboardController {
  constructor(private readonly dashboard: MedicalClinicDashboardService) {}

  @Get("top")
  @RequirePermissions("medical_clinic:read")
  top(
    @CurrentUser() user: AuthUser,
    @Query("period", new ZodValidationPipe(dashboardPeriodSchema, "medical_clinic.invalid_query"))
    period: DashboardPeriod,
  ) {
    return this.dashboard.top(user, period);
  }
}
