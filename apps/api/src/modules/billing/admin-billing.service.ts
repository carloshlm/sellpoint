import { Injectable, NotFoundException } from "@nestjs/common";
import { type PlanFeatures, planFeaturesSchema, scaledInteger } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

export interface AdminTenantRow {
  tenantId: string;
  tenantName: string;
  country: string | null;
  planCode: string;
  planName: string;
  status: string;
  billingCycle: string | null;
  dueAt: Date | null;
  lastPaymentAt: Date | null;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  maxUsers?: number | null;
  maxWarehouses?: number | null;
  dailySalesLimit?: number | null;
  features?: unknown;
  /** El anual se deriva SIEMPRE (mensual × 10): el CHECK de la base lo exige. */
  prices?: { country: string; currency: string; priceMonthly: string }[];
}

/** Centavos → texto decimal, sin IEEE-754 (mismo criterio que shared). */
function centsToText(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * F7-ADMIN — la vista y las palancas del dueño de la plataforma.
 *
 * Las LECTURAS cross-tenant pasan por `withBillingAdminContext` (la única
 * puerta, acotada a las 4 tablas de billing); los nombres de los negocios
 * salen de `tenants`, que no lleva RLS. Las MUTACIONES de suscripciones
 * viven en `BillingService` (por tenant, con su contexto); acá solo quedan
 * las del CATÁLOGO (`plans`/`plan_prices`, sin RLS, cliente base).
 *
 * El MRR se calcula desde los PAGOS VIGENTES y por MONEDA: dinero real
 * comprometido — un trial no aporta, un anual aporta su doceava parte, y
 * sumar MXN con USD daría un número que no existe.
 */
@Injectable()
export class AdminBillingService {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants() {
    const { subs, pagosVigentes } = await this.prisma.withBillingAdminContext(async (tx) => {
      const subs = await tx.tenantSubscription.findMany({
        include: {
          plan: true,
          payments: {
            where: { status: "recorded" },
            orderBy: { paidAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      });
      const pagosVigentes = await tx.subscriptionPayment.findMany({
        where: { status: "recorded", periodEnd: { gt: new Date() } },
        select: { amount: true, currency: true, billingCycle: true, periodEnd: true },
      });
      return { subs, pagosVigentes };
    });

    // `tenants` no lleva RLS: los nombres se leen con el cliente base.
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: subs.map((s) => s.tenantId) } },
      select: { id: true, name: true, country: true },
    });
    const porId = new Map(tenants.map((t) => [t.id, t]));

    const rows: AdminTenantRow[] = subs.map((sub) => ({
      tenantId: sub.tenantId,
      tenantName: porId.get(sub.tenantId)?.name ?? sub.tenantId,
      country: porId.get(sub.tenantId)?.country ?? null,
      planCode: sub.plan.code,
      planName: sub.plan.name,
      status: sub.status,
      billingCycle: sub.billingCycle,
      dueAt: sub.dueAt,
      lastPaymentAt: sub.payments[0]?.paidAt ?? null,
    }));

    const mrrCents = new Map<string, number>();
    for (const pago of pagosVigentes) {
      const cents = scaledInteger(String(pago.amount), 2);
      const mensualizado = pago.billingCycle === "yearly" ? cents / 12 : cents;
      mrrCents.set(pago.currency, (mrrCents.get(pago.currency) ?? 0) + mensualizado);
    }
    const mrrByCurrency = Object.fromEntries(
      [...mrrCents.entries()].map(([currency, cents]) => [currency, centsToText(cents)]),
    );

    return { tenants: rows, mrrByCurrency };
  }

  async getTenantDetail(tenantId: string) {
    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!subscription) {
        throw new NotFoundException({ message: "billing.subscription_not_found" });
      }
      const payments = await tx.subscriptionPayment.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { paidAt: "desc" },
        take: 50,
      });
      const activeDiscount = await tx.tenantDiscount.findFirst({
        where: { tenantId, isActive: true },
      });
      return { subscription, payments, activeDiscount };
    });
  }

  /**
   * F7-ADMIN-06: qué inventariar al subir a un plan CON control de stock —
   * los negativos que la venta sin existencias dejó documentados.
   */
  async negativeStockWarnings(tenantId: string) {
    const filas = await this.prisma.withTenantContext(tenantId, (tx) =>
      tx.stockByWarehouse.findMany({
        where: { tenantId, quantity: { lt: 0 } },
        include: { product: { select: { sku: true } }, warehouse: { select: { name: true } } },
      }),
    );
    return filas.map((f) => ({
      sku: f.product.sku,
      warehouse: f.warehouse.name,
      quantity: String(f.quantity),
    }));
  }

  listPlans() {
    return this.prisma.plan.findMany({
      include: { prices: { orderBy: { country: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  /**
   * F7-ADMIN-05: la matriz se edita SIN migración — pero no sin red. Las
   * features pasan por el schema estricto (un typo revienta, no se guarda)
   * y el precio anual se deriva siempre del mensual (× 10, el CHECK de la
   * base no admite otra cosa). Los entitlements cacheados de los tenants de
   * ese plan expiran con su TTL (≤ 5 min): no hay invalidación por plan a
   * propósito — un DEL masivo exigiría indexar tenants por plan en Redis y
   * ese peso no paga con este tamaño.
   */
  async updatePlan(code: string, input: UpdatePlanInput) {
    const features =
      input.features === undefined ? undefined : planFeaturesSchema.parse(input.features);

    const plan = await this.prisma.plan.update({
      where: { code },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
        ...(input.maxWarehouses !== undefined ? { maxWarehouses: input.maxWarehouses } : {}),
        ...(input.dailySalesLimit !== undefined ? { dailySalesLimit: input.dailySalesLimit } : {}),
        ...(features !== undefined ? { features: features as PlanFeatures } : {}),
      },
    });

    for (const price of input.prices ?? []) {
      const yearly = centsToText(scaledInteger(price.priceMonthly, 2) * 10);
      await this.prisma.planPrice.upsert({
        where: { planId_country: { planId: plan.id, country: price.country } },
        create: {
          planId: plan.id,
          country: price.country,
          currency: price.currency,
          priceMonthly: price.priceMonthly,
          priceYearly: yearly,
        },
        update: {
          currency: price.currency,
          priceMonthly: price.priceMonthly,
          priceYearly: yearly,
        },
      });
    }

    return plan;
  }
}
