import { Injectable, NotFoundException } from "@nestjs/common";
import { MODULE_KEYS, type ModuleKey } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

export interface TenantOverview {
  tenant: {
    name: string;
    country: string | null;
    currency: string;
    timezone: string;
    onboarded: boolean;
  };
  users: { active: number; invited: number; suspended: number };
  counts: { products: number; services: number; subcatalogs: number; warehouses: number };
  subscription: {
    planCode: string;
    planName: string | null;
    /** `none` cuando el negocio nunca tuvo suscripción (mismo criterio que el backoffice de cobros). */
    status: string;
    billingCycle: string | null;
    dueAt: string | null;
    customPrice: string | null;
  };
  modules: ModuleKey[];
}

/**
 * F9-ADMIN-02 — el resumen de UN negocio para el expediente del backoffice.
 *
 * `tenants` no lleva RLS y se lee con el cliente base; todo lo demás va en
 * UN `withTenantContext(tenantId de la URL)`: son tablas de negocio y el
 * bypass de billing no las abre (a propósito).
 */
@Injectable()
export class AdminTenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string): Promise<TenantOverview> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, country: true, currency: true, timezone: true, onboarded: true },
    });
    if (!tenant) {
      throw new NotFoundException({ message: "billing.tenant_not_found" });
    }

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const [
        active,
        invited,
        suspended,
        products,
        services,
        subcatalogs,
        warehouses,
        sub,
        modulos,
      ] = await Promise.all([
        tx.user.count({ where: { tenantId, status: "active" } }),
        tx.user.count({ where: { tenantId, status: "invited" } }),
        tx.user.count({ where: { tenantId, status: "suspended" } }),
        tx.product.count({ where: { tenantId } }),
        tx.service.count({ where: { tenantId } }),
        // Subcatálogos = los catálogos que el negocio creó; los de sistema
        // (productos, almacenes, servicios) no son suyos.
        tx.catalog.count({ where: { tenantId, isSystem: false } }),
        tx.warehouse.count({ where: { tenantId, isActive: true } }),
        tx.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } }),
        tx.tenantModule.findMany({
          where: { tenantId },
          select: { moduleKey: true },
          orderBy: { moduleKey: "asc" },
        }),
      ]);
      const conocidas = new Set<string>(MODULE_KEYS);
      return {
        tenant,
        users: { active, invited, suspended },
        counts: { products, services, subcatalogs, warehouses },
        subscription: sub
          ? {
              planCode: sub.plan.code,
              planName: sub.plan.name,
              status: sub.status,
              billingCycle: sub.billingCycle ?? null,
              dueAt: sub.dueAt?.toISOString() ?? null,
              customPrice: sub.customPrice === null ? null : String(sub.customPrice),
            }
          : {
              planCode: "free",
              planName: null,
              status: "none",
              billingCycle: null,
              dueAt: null,
              customPrice: null,
            },
        modules: modulos.map((m) => m.moduleKey).filter((k): k is ModuleKey => conocidas.has(k)),
      };
    });
  }

  /** El nombre del negocio como parte de un nombre de archivo. */
  async fileSlug(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const base = (tenant?.name ?? "negocio")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "negocio";
  }
}
