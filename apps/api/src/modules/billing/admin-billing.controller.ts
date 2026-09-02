import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { type ModuleKey, moduleKeySchema } from "@sellpoint/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminBillingService } from "./admin-billing.service";
import { BillingService } from "./billing.service";
import { BillingDailyJob } from "./billing-daily.job";
import { AllowedInFreeTier } from "./decorators/allowed-in-free-tier.decorator";
import {
  type EnableModuleDto,
  enableModuleSchema,
  type GrantDiscountDto,
  grantDiscountSchema,
  type PatchSubscriptionDto,
  patchSubscriptionSchema,
  type ReasonDto,
  type RecordPaymentDto,
  reasonSchema,
  recordPaymentSchema,
  type UpdatePlanDto,
  updatePlanSchema,
  type VoidPaymentDto,
  voidPaymentSchema,
} from "./dto/admin-billing.dto";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { TenantModulesService } from "./tenant-modules.service";

/**
 * F7-ADMIN — el backoffice del dueño de la plataforma.
 *
 * `PlatformAdminGuard` a nivel de CLASE: las cuatro llaves en AND en cada
 * request. `@AllowedInFreeTier()` también: administrar los planes no puede
 * depender de tener plan — si la propia suscripción del dueño venciera, el
 * backoffice es justo lo que no puede quedar afuera.
 */
@AllowedInFreeTier()
@UseGuards(PlatformAdminGuard)
@Controller("admin/billing")
export class AdminBillingController {
  constructor(
    private readonly adminBilling: AdminBillingService,
    private readonly billing: BillingService,
    private readonly dailyJob: BillingDailyJob,
    private readonly tenantModules: TenantModulesService,
  ) {}

  @Get("tenants")
  listTenants() {
    return this.adminBilling.listTenants();
  }

  @Get("tenants/:tenantId")
  getTenant(@Param("tenantId") tenantId: string) {
    return this.adminBilling.getTenantDetail(tenantId);
  }

  /** El corazón del cobro manual: registrar la transferencia recibida. */
  @Post("tenants/:tenantId/payments")
  recordPayment(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(recordPaymentSchema, "billing.invalid_body"))
    dto: RecordPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.recordPayment({ ...dto, tenantId, recordedBy: user.userId });
  }

  @Post("tenants/:tenantId/payments/:paymentId/void")
  voidPayment(
    @Param("tenantId") tenantId: string,
    @Param("paymentId") paymentId: string,
    @Body(new ZodValidationPipe(voidPaymentSchema, "billing.invalid_body")) dto: VoidPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.voidPayment(tenantId, paymentId, {
      reason: dto.reason,
      voidedBy: user.userId,
    });
  }

  /**
   * F7-ADMIN-06: al mover a un plan CON control de stock, la respuesta trae
   * `warnings.negativeStock` — la lista exacta de qué inventariar, cortesía
   * de los negativos que la venta sin existencias dejó documentados.
   */
  @Patch("tenants/:tenantId/subscription")
  async patchSubscription(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(patchSubscriptionSchema, "billing.invalid_body"))
    dto: PatchSubscriptionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const subscription = await this.billing.changePlan(tenantId, {
      ...dto,
      changedBy: user.userId,
    });
    const plan = await this.adminBilling
      .listPlans()
      .then((planes) => planes.find((p) => p.id === subscription.planId));
    const negativeStock = plan?.stockControl
      ? await this.adminBilling.negativeStockWarnings(tenantId)
      : [];
    return { subscription, warnings: { negativeStock } };
  }

  @Post("tenants/:tenantId/cancel")
  cancel(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(reasonSchema, "billing.invalid_body")) dto: ReasonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.cancel(tenantId, { reason: dto.reason, canceledBy: user.userId });
  }

  @Post("tenants/:tenantId/reactivate")
  reactivate(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(reasonSchema, "billing.invalid_body")) dto: ReasonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.reactivate(tenantId, { reason: dto.reason, reactivatedBy: user.userId });
  }

  @Post("tenants/:tenantId/discounts")
  grantDiscount(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(grantDiscountSchema, "billing.invalid_body"))
    dto: GrantDiscountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.grantDiscount(tenantId, { ...dto, createdBy: user.userId });
  }

  @Delete("tenants/:tenantId/discounts/:discountId")
  revokeDiscount(
    @Param("tenantId") tenantId: string,
    @Param("discountId") discountId: string,
    @Body(new ZodValidationPipe(reasonSchema, "billing.invalid_body")) dto: ReasonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.revokeDiscount(tenantId, discountId, {
      reason: dto.reason,
      revokedBy: user.userId,
    });
  }

  /**
   * F7-CRON-01: el barrido a demanda — para el runbook ("córrelo a mano y
   * mira qué movió") y para los e2e. Idempotente por construcción: correrlo
   * dos veces no degrada ni avisa dos veces.
   */
  /**
   * F9-MOD-05 — los módulos avanzados del negocio. Activar uno lo vuelve
   * Premium con precio pactado (lo hace `changePlan`); desactivar NO degrada
   * el plan. Ambos responden con la lista de módulos vigente.
   */
  @Post("tenants/:tenantId/modules")
  enableModule(
    @Param("tenantId") tenantId: string,
    @Body(new ZodValidationPipe(enableModuleSchema, "billing.invalid_body"))
    dto: EnableModuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tenantModules.enable(tenantId, { ...dto, changedBy: user.userId });
  }

  @Delete("tenants/:tenantId/modules/:moduleKey")
  disableModule(
    @Param("tenantId") tenantId: string,
    @Param("moduleKey", new ZodValidationPipe(moduleKeySchema, "billing.invalid_body"))
    moduleKey: ModuleKey,
    @Body(new ZodValidationPipe(reasonSchema, "billing.invalid_body")) dto: ReasonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tenantModules.disable(tenantId, {
      moduleKey,
      reason: dto.reason,
      changedBy: user.userId,
    });
  }

  @Post("jobs/run-daily")
  async runDaily() {
    await this.dailyJob.run(new Date());
    return { ok: true };
  }

  @Get("plans")
  listPlans() {
    return this.adminBilling.listPlans();
  }

  @Patch("plans/:code")
  updatePlan(
    @Param("code") code: string,
    @Body(new ZodValidationPipe(updatePlanSchema, "billing.invalid_body")) dto: UpdatePlanDto,
  ) {
    return this.adminBilling.updatePlan(code, dto);
  }
}
