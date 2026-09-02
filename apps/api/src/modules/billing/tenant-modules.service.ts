import { Injectable, NotFoundException } from "@nestjs/common";
import { MODULE_KEYS, type ModuleKey } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BillingService } from "./billing.service";
import { EntitlementsService } from "./entitlements.service";

export interface EnableModuleInput {
  moduleKey: ModuleKey;
  /** El precio pactado del Premium. Obligatorio si el negocio no es Premium todavía (lo exige `changePlan`). */
  customPrice?: string;
  notes?: string | null;
  reason: string;
  changedBy?: string;
}

export interface DisableModuleInput {
  moduleKey: ModuleKey;
  reason: string;
  changedBy?: string;
}

/**
 * F9-MOD-04 — activar y desactivar módulos avanzados por negocio, desde el
 * backoffice.
 *
 * ── Activar ⇒ Premium con precio pactado ────────────────────────────────
 *
 * Un módulo vertical no está en ningún plan público: quien lo tiene es
 * Premium, con un precio pactado uno a uno. Por eso `enable` delega en
 * `BillingService.changePlan` cuando el plan vigente no es Premium — la
 * invariante «plan sin precio publicado exige `custom_price`» (422
 * `billing.custom_price_required`) vive ahí y NO se duplica acá. Si falla,
 * no queda fila de módulo.
 *
 * ── Desactivar NO degrada el plan ───────────────────────────────────────
 *
 * El cliente pagó Premium por un período; bajarlo automáticamente le
 * quitaría features y límites a mitad de período sin decisión comercial. El
 * plan y el precio se ajustan a mano con el PATCH de suscripción.
 *
 * ── Dos transacciones, a propósito ──────────────────────────────────────
 *
 * `changePlan` y la fila del módulo son dos transacciones. Un fallo entre
 * medias deja al negocio en Premium sin módulo: visible en el expediente y
 * corregible reintentando. Hacerlo atómico exigiría partir `changePlan`, el
 * corazón probado de F7, y no vale la pena para una operación manual del
 * dueño.
 */
@Injectable()
export class TenantModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly auditService: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(tenantId: string): Promise<ModuleKey[]> {
    return this.prisma.withTenantContext(tenantId, (tx) => this.listIn(tx, tenantId));
  }

  async enable(tenantId: string, input: EnableModuleInput): Promise<ModuleKey[]> {
    const sub = await this.prisma.withTenantContext(tenantId, (tx) =>
      tx.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    );
    if (!sub) {
      // No se inventa la suscripción desde acá: sus fechas y su estado
      // saldrían de la nada. Primero se le registra un plan o un pago.
      throw new NotFoundException({ message: "billing.subscription_not_found" });
    }

    if (sub.plan.code !== "premium") {
      await this.billing.changePlan(tenantId, {
        planCode: "premium",
        customPrice: input.customPrice,
        reason: input.reason,
        changedBy: input.changedBy,
      });
    } else if (input.customPrice !== undefined) {
      await this.billing.changePlan(tenantId, {
        customPrice: input.customPrice,
        reason: input.reason,
        changedBy: input.changedBy,
      });
    }

    const cambio = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const existente = await tx.tenantModule.findUnique({
        where: { tenantId_moduleKey: { tenantId, moduleKey: input.moduleKey } },
      });
      if (existente) {
        return false;
      }
      await tx.tenantModule.create({
        data: {
          tenantId,
          moduleKey: input.moduleKey,
          enabledBy: input.changedBy,
          notes: input.notes ?? null,
        },
      });
      await this.auditService.record(tx, {
        tenantId,
        userId: input.changedBy,
        action: "tenant_module.enabled",
        resourceType: "tenant_module",
        resourceId: input.moduleKey,
        // El actor es el dueño de la plataforma, un usuario de OTRO tenant:
        // quien lea este audit no lo va a encontrar en su tabla de usuarios.
        after: { moduleKey: input.moduleKey, reason: input.reason, actor: { platformAdmin: true } },
      });
      return true;
    });

    if (cambio) {
      await this.entitlements.invalidate(tenantId);
    }
    return this.list(tenantId);
  }

  async disable(tenantId: string, input: DisableModuleInput): Promise<ModuleKey[]> {
    const cambio = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const { count } = await tx.tenantModule.deleteMany({
        where: { tenantId, moduleKey: input.moduleKey },
      });
      if (count === 0) {
        return false;
      }
      await this.auditService.record(tx, {
        tenantId,
        userId: input.changedBy,
        action: "tenant_module.disabled",
        resourceType: "tenant_module",
        resourceId: input.moduleKey,
        before: { moduleKey: input.moduleKey },
        after: { reason: input.reason, actor: { platformAdmin: true } },
      });
      return true;
    });

    if (cambio) {
      await this.entitlements.invalidate(tenantId);
    }
    return this.list(tenantId);
  }

  /** Las filas filtradas contra el catálogo: una clave retirada no se lista. */
  private async listIn(tx: Prisma.TransactionClient, tenantId: string): Promise<ModuleKey[]> {
    const filas = await tx.tenantModule.findMany({
      where: { tenantId },
      select: { moduleKey: true },
      orderBy: { moduleKey: "asc" },
    });
    const conocidas = new Set<string>(MODULE_KEYS);
    return filas.map((f) => f.moduleKey).filter((k): k is ModuleKey => conocidas.has(k));
  }
}
