import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ModuleKey, PlanFeatures } from "@sellpoint/shared";
import { PrismaService } from "../../../infrastructure/prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import type { AuthUser } from "../../auth/types/auth-user";
import { ALLOWED_IN_FREE_TIER_KEY } from "../decorators/allowed-in-free-tier.decorator";
import {
  CHECK_PLAN_LIMIT_KEY,
  type PlanLimitDimension,
} from "../decorators/check-plan-limit.decorator";
import { REQUIRES_FEATURE_KEY } from "../decorators/requires-feature.decorator";
import { REQUIRES_MODULE_KEY } from "../decorators/requires-module.decorator";
import { EntitlementsService } from "../entitlements.service";
import { PlanRequiredException } from "../plan-required.exception";

type AuthenticatedRequest = { method: string; user?: AuthUser };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * F7-GUARD-03: el 4º APP_GUARD — después de Throttler, JwtAuth y
 * Permissions. Primero "quién eres", luego "tu rol lo permite", al final
 * "tu plan lo incluye": así un 403 de permisos nunca se disfraza de 402 de
 * plan, y este guard no gasta un roundtrip en requests que ya iban a
 * rebotar por rol.
 *
 * Orden interno (fijado por tests):
 *  1. Escapes SIN resolver entitlements: @Public, ausencia de request.user
 *     (el JwtAuthGuard ya decidió) y @AllowedInFreeTier — la lista corta de
 *     lo que se opera sin plan (vender, caja, perfil, billing/backoffice).
 *  1b. @RequiresModule (F9-MOD-06): un módulo vertical apagado responde 402
 *     TAMBIÉN en GET — nunca estuvo en un plan público, no hay historia
 *     «ya pagada» que respetar. Solo resuelve entitlements si el decorador
 *     está presente.
 *  2. GET/HEAD pasan siempre: el free tier VE todo, incluida la historia de
 *     módulos que su plan ya no incluye (un ex-Pro degradado sigue leyendo
 *     su kardex). Los checks de abajo son solo para MUTANTES.
 *  3. `write_access` apagado (free) → 402 read_only — el mensaje del ESTADO,
 *     antes que el de features, porque es el que explica la situación.
 *  4. @RequiresFeature: el flag apagado en la matriz del plan → 402.
 *  5. @CheckPlanLimit: cuenta lo existente contra max_* SOLO al crear (un
 *     downgrade jamás suspende usuarios ni borra almacenes). Los invited
 *     ocupan asiento; los suspendidos no. NULL = ilimitado, ni se cuenta.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(ALLOWED_IN_FREE_TIER_KEY, targets)) {
      return true;
    }

    // F9-MOD-06: el módulo se exige ANTES del escape de lectura. Un módulo
    // vertical apagado se apaga entero (también los GET), y el chequeo solo
    // paga un roundtrip cuando el decorador está presente.
    const moduleKey = this.reflector.getAllAndOverride<ModuleKey | undefined>(
      REQUIRES_MODULE_KEY,
      targets,
    );
    if (moduleKey) {
      const conModulos = await this.entitlements.resolve(request.user.tenantId);
      if (!conModulos.modules.includes(moduleKey)) {
        throw new PlanRequiredException("billing.module_not_enabled", { module: moduleKey });
      }
    }

    if (!MUTATING_METHODS.has(request.method)) {
      return true;
    }

    const entitlements = await this.entitlements.resolve(request.user.tenantId);

    if (!entitlements.writeAccess) {
      throw new PlanRequiredException("billing.read_only");
    }

    const feature = this.reflector.getAllAndOverride<keyof PlanFeatures | undefined>(
      REQUIRES_FEATURE_KEY,
      targets,
    );
    if (feature && !entitlements.features[feature]) {
      throw new PlanRequiredException("billing.feature_not_in_plan", {
        feature,
        planCode: entitlements.planCode,
      });
    }

    const dimension = this.reflector.getAllAndOverride<PlanLimitDimension | undefined>(
      CHECK_PLAN_LIMIT_KEY,
      targets,
    );
    if (dimension) {
      await this.assertUnderLimit(request.user.tenantId, dimension, entitlements);
    }

    return true;
  }

  private async assertUnderLimit(
    tenantId: string,
    dimension: PlanLimitDimension,
    entitlements: { maxUsers: number | null; maxWarehouses: number | null },
  ): Promise<void> {
    const limit = dimension === "users" ? entitlements.maxUsers : entitlements.maxWarehouses;
    if (limit === null) {
      return;
    }

    const current = await this.prisma.withTenantContext(tenantId, (tx) =>
      dimension === "users"
        ? tx.user.count({ where: { tenantId, status: { not: "suspended" } } })
        : tx.warehouse.count({ where: { tenantId, isActive: true } }),
    );

    if (current >= limit) {
      throw new PlanRequiredException(
        dimension === "users" ? "billing.user_limit_reached" : "billing.warehouse_limit_reached",
        { limit },
      );
    }
  }
}
