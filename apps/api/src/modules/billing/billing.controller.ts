import { Controller, Get, Query } from "@nestjs/common";
import { resolveMarket } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminBillingService } from "./admin-billing.service";
import { BillingService } from "./billing.service";
import { AllowedInFreeTier } from "./decorators/allowed-in-free-tier.decorator";

/**
 * F7-WEB-02 — la cara del billing hacia el TENANT (el backoffice del dueño
 * vive aparte, en admin-billing.controller).
 *
 * `GET /billing/plans` es `@Public()` a propósito: la pantalla de planes se
 * ve sin sesión (la landing futura la consumirá). Con sesión, el precio sale
 * del país del negocio; sin sesión, `?country=` con fallback US.
 */
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly adminBilling: AdminBillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get("plans")
  async listPlans(@CurrentUser() user: AuthUser | undefined, @Query("country") country?: string) {
    // Con sesión manda el MERCADO del negocio (país, o su moneda si el
    // tenant es anterior al onboarding); sin sesión, el `?country=` de la
    // landing con `US` como default internacional. La resolución vive en
    // `resolveMarket` — la MISMA que usa el cobro, para que nadie vea un
    // precio y termine pagando otro.
    let resolved = country?.toUpperCase() ?? "US";
    if (user) {
      // `tenants` no lleva RLS: la lectura del país va con el cliente base.
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { country: true, currency: true },
      });
      resolved = tenant ? resolveMarket(tenant) : resolved;
    }
    return this.billing.listPublicPlans(resolved);
  }

  /**
   * El detalle propio: MISMA data que el detalle del backoffice, porque es
   * SU tenant — suscripción, historial de pagos y cupón vigente. El free
   * tier también entra (`@AllowedInFreeTier`): ver qué debe y qué planes hay
   * es justo lo que necesita para volver.
   */
  @AllowedInFreeTier()
  @RequirePermissions("tenants:manage")
  @Get("me")
  getMyBilling(@CurrentUser() user: AuthUser) {
    return this.adminBilling.getTenantDetail(user.tenantId);
  }
}
