import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  MODULE_KEYS,
  type ModuleKey,
  type PlanCode,
  type PlanFeatures,
  planFeaturesSchema,
} from "@sellpoint/shared";
import type { Redis } from "ioredis";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../../infrastructure/redis/redis.tokens";

/**
 * Lo que el plan del tenant le permite HOY. Es lo que consumen el
 * SubscriptionGuard, el gate de ventas del POS y los emisores hacia el
 * front — por eso las fechas van como ISO strings: el objeto viaja tal
 * cual por Redis (JSON) y por HTTP sin doble conversión.
 */
export interface Entitlements {
  planCode: PlanCode;
  planName: string;
  status: string;
  billingCycle: "monthly" | "yearly" | null;
  writeAccess: boolean;
  stockControl: boolean;
  dailySalesLimit: number | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  features: PlanFeatures;
  /**
   * F9-MOD-03 — los módulos avanzados activos por encima del plan. Van
   * ATADOS al plan efectivo: un negocio que cayó a free no los conserva
   * aunque sus filas sigan en `tenant_modules` (reactivar los devuelve).
   */
  modules: ModuleKey[];
  trialEndsAt: string | null;
  dueAt: string | null;
  graceEndsAt: string | null;
}

const CACHE_TTL_SECONDS = 300;

type PlanRow = {
  code: string;
  name: string;
  maxUsers: number | null;
  maxWarehouses: number | null;
  dailySalesLimit: number | null;
  writeAccess: boolean;
  stockControl: boolean;
  features: unknown;
};

/**
 * F7-CORE-01/02 — el resolver del plan efectivo, con su caché.
 *
 * ── La regla única ──────────────────────────────────────────────────────
 *
 *   trialing | active | past_due → el plan de la suscripción
 *   free | canceled | SIN fila   → el plan `free` (fail-closed con WARN)
 *
 * `canceled` cae a free sin mirar fechas porque a ese estado solo se llega
 * cuando el período pagado ya venció: cancelar con período vivo deja
 * `cancel_at_period_end=true` con el status intacto (ver BillingService).
 *
 * ── El caché ────────────────────────────────────────────────────────────
 *
 * Redis `entitlements:{tenantId}`, TTL 300s, con DEL explícito en todo
 * cambio de plan/estado/pago (BillingService y el cron). NO va en el JWT: un
 * access token de 15 minutos conservaría el plan viejo después de la
 * degradación de las 3 AM. Y si Redis se cae, el fallback es POSTGRES —
 * mismo criterio que PermEpochService: jamás "todo permitido".
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async resolve(tenantId: string): Promise<Entitlements> {
    const key = `entitlements:${tenantId}`;

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as Entitlements;
      }
    } catch (error) {
      this.warnRedis("leer", key, error);
    }

    const entitlements = await this.resolveFromDb(tenantId);

    try {
      await this.redis.set(key, JSON.stringify(entitlements), "EX", CACHE_TTL_SECONDS);
    } catch (error) {
      this.warnRedis("escribir", key, error);
    }

    return entitlements;
  }

  /** DEL explícito: lo llama todo cambio de plan/estado/pago y el cron. */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.del(`entitlements:${tenantId}`);
    } catch (error) {
      this.warnRedis("invalidar", `entitlements:${tenantId}`, error);
    }
  }

  private async resolveFromDb(tenantId: string): Promise<Entitlements> {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const sub = await tx.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });

      if (!sub) {
        // Tenant anterior a F7 sin backfill, o un bug de provisioning: no se
        // regala acceso — se degrada a free y se deja rastro.
        this.logger.warn(`Tenant ${tenantId} sin fila de suscripción: resolviendo plan free`);
        const freePlan = await tx.plan.findUniqueOrThrow({ where: { code: "free" } });
        return this.toEntitlements(freePlan as PlanRow, "free", null, null, null, null, []);
      }

      const planVivo =
        sub.status === "trialing" || sub.status === "active" || sub.status === "past_due";
      const planEfectivo = planVivo
        ? (sub.plan as PlanRow)
        : ((await tx.plan.findUniqueOrThrow({ where: { code: "free" } })) as PlanRow);
      // Los módulos solo se conceden con el plan VIVO: caer a free los apaga
      // sin borrar nada.
      const modules = planVivo ? await this.resolveModules(tx, tenantId) : [];

      return this.toEntitlements(
        planEfectivo,
        sub.status,
        (sub.billingCycle as "monthly" | "yearly" | null) ?? null,
        sub.trialEndsAt,
        sub.dueAt,
        sub.graceEndsAt,
        modules,
      );
    });
  }

  /**
   * Las filas de `tenant_modules` filtradas contra el catálogo: una clave que
   * ya no existe en `MODULE_KEYS` (módulo retirado) se descarta con WARN —
   * la suscripción de nadie revienta por una fila huérfana.
   */
  private async resolveModules(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<ModuleKey[]> {
    const filas = await tx.tenantModule.findMany({
      where: { tenantId },
      select: { moduleKey: true },
      orderBy: { moduleKey: "asc" },
    });
    const conocidas = new Set<string>(MODULE_KEYS);
    const modules: ModuleKey[] = [];
    for (const { moduleKey } of filas) {
      if (conocidas.has(moduleKey)) {
        modules.push(moduleKey as ModuleKey);
      } else {
        this.logger.warn(
          `Tenant ${tenantId} tiene el módulo «${moduleKey}», que ya no está en el catálogo: se ignora`,
        );
      }
    }
    return modules;
  }

  private toEntitlements(
    plan: PlanRow,
    status: string,
    billingCycle: "monthly" | "yearly" | null,
    trialEndsAt: Date | null,
    dueAt: Date | null,
    graceEndsAt: Date | null,
    modules: ModuleKey[],
  ): Entitlements {
    return {
      planCode: plan.code as PlanCode,
      planName: plan.name,
      status,
      billingCycle,
      writeAccess: plan.writeAccess,
      stockControl: plan.stockControl,
      dailySalesLimit: plan.dailySalesLimit,
      maxUsers: plan.maxUsers,
      maxWarehouses: plan.maxWarehouses,
      // Zod y no un cast: un JSONB con basura revienta acá, en un lugar con
      // nombre, no como un `undefined` silencioso en el guard.
      features: planFeaturesSchema.parse(plan.features),
      modules,
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      dueAt: dueAt?.toISOString() ?? null,
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
    };
  }

  private warnRedis(accion: string, key: string, error: unknown): void {
    this.logger.warn(
      `Redis inalcanzable al ${accion} ${key}, fail-open a Postgres: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
