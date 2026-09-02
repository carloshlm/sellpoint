import { Injectable } from "@nestjs/common";
import {
  computeChargeAmount,
  MODULE_KEYS,
  type ModuleKey,
  type PlanFeatures,
  planFeaturesSchema,
  resolveMarket,
  scaledInteger,
} from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

export interface AdminTenantRow {
  tenantId: string;
  tenantName: string;
  country: string | null;
  /** La moneda del negocio: por la que se filtra y en la que se le cobra. */
  currency: string;
  /**
   * La zona del NEGOCIO, para que el backoffice pinte la fecha de cobro de
   * cada uno en su propia zona y no en la de quien mira la tabla.
   */
  timezone: string;
  /**
   * Lo que ESTE negocio pagaría por CADA plan vendible, con su cupón vigente
   * ya aplicado y en la moneda de su mercado.
   *
   * Va en la fila porque el formulario de cobro exige cuadrar la cuenta, y
   * cuadrarla sin ver el número sería pedirle al dueño que saque
   * calculadora. Y va por PLAN —no solo el vigente— por dos razones: el
   * formulario deja cambiar de plan en el mismo acto, y un negocio SIN
   * suscripción no tiene plan vigente del cual sacar precio (Carlos,
   * 2026-08-29: «cuando un usuario no tiene un plan asignado no funciona el
   * autocompletado»).
   */
  charges: { planCode: string; monthly: string; yearly: string; currency: string }[];
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

    // La lista parte de los NEGOCIOS y no de las suscripciones (`tenants` no
    // lleva RLS, se lee con el cliente base). Al revés —que era como estaba—
    // los negocios anteriores a la Fase 7 desaparecían del backoffice, y son
    // EXACTAMENTE a los que hay que cobrarles: 8 de 10 en producción
    // (Carlos, 2026-08-29).
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        country: true,
        currency: true,
        timezone: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const subPorTenant = new Map(subs.map((s) => [s.tenantId, s]));

    // El plan que el sistema le aplica HOY a quien no tiene suscripción: el
    // mismo `free` del resolver, para que la tabla no mienta sobre lo que el
    // cliente está viviendo.
    const planFree = await this.prisma.plan.findUniqueOrThrow({ where: { code: "free" } });

    // Los precios de TODOS los planes en UNA query: el cargo de cada negocio
    // se arma en memoria (una tabla de 50 negocios no puede costar 100 viajes).
    const planes = await this.prisma.plan.findMany({ include: { prices: true } });
    const descuentos = await this.prisma.withBillingAdminContext((tx) =>
      tx.tenantDiscount.findMany({ where: { isActive: true } }),
    );
    const cuponPorTenant = new Map(descuentos.map((d) => [d.tenantId, d]));

    const rows: AdminTenantRow[] = tenants.map((tenant) => {
      const sub = subPorTenant.get(tenant.id);
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        charges: this.chargesDe(tenant, planes, cuponPorTenant.get(tenant.id) ?? null, sub ?? null),
        country: tenant.country,
        currency: tenant.currency,
        timezone: tenant.timezone,
        planCode: sub?.plan.code ?? planFree.code,
        planName: sub?.plan.name ?? planFree.name,
        // `none` es distinto de `free`: uno nunca tuvo suscripción, el otro
        // cayó al modo gratuito. Al dueño le cambia qué hacer con cada uno.
        status: sub?.status ?? "none",
        billingCycle: sub?.billingCycle ?? null,
        dueAt: sub?.dueAt ?? null,
        lastPaymentAt: sub?.payments[0]?.paidAt ?? null,
      };
    });

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

  /**
   * El expediente de un negocio. Un tenant SIN suscripción —los anteriores a
   * la Fase 7— responde su estado real (`none` sobre el plan `free`, que es
   * lo que el resolver le aplica hoy) en vez de un 404: el backoffice ahora
   * los lista, y su propio dueño abre "Mi plan" igual que cualquier otro.
   * Un 404 acá sería una pared en el lugar exacto donde hay que decidir qué
   * cobrarle.
   */
  /**
   * El precio de cada plan vendible para ESTE negocio: tarifa de su mercado
   * (o el `custom_price` pactado cuando el plan es el suyo y no publica
   * precio, que es el caso de Premium) menos su cupón vigente.
   *
   * Los planes sin precio para ese negocio simplemente no salen: un Premium
   * al que todavía no se le pactó precio no tiene nada que cobrar, y ofrecer
   * un cero sería peor que no ofrecer nada.
   */
  private chargesDe(
    tenant: { country: string | null; currency: string },
    planes: {
      id: string;
      code: string;
      isActive: boolean;
      prices: { country: string; currency: string; priceMonthly: unknown; priceYearly: unknown }[];
    }[],
    cupon: { kind: string; amount: unknown } | null,
    sub: { planId: string; customPrice: unknown } | null,
  ): { planCode: string; monthly: string; yearly: string; currency: string }[] {
    const market = resolveMarket(tenant);
    const discount = cupon
      ? {
          kind: cupon.kind as "fixed_amount" | "free",
          amount: cupon.amount === null ? null : String(cupon.amount),
        }
      : null;

    const filas: { planCode: string; monthly: string; yearly: string; currency: string }[] = [];
    for (const plan of planes) {
      // `free` no se vende: es a donde se cae, no algo que se cobre.
      if (!plan.isActive || plan.code === "free") {
        continue;
      }
      const price =
        plan.prices.find((p) => p.country === market) ??
        plan.prices.find((p) => p.country === "US") ??
        null;
      // El precio pactado solo aplica al plan que el negocio TIENE: es un
      // acuerdo con ese cliente sobre ese plan, no una tarifa general.
      const customPrice =
        sub && sub.planId === plan.id && sub.customPrice !== null ? String(sub.customPrice) : null;
      if (!price && customPrice === null) {
        continue;
      }
      const base = price
        ? { monthly: String(price.priceMonthly), yearly: String(price.priceYearly) }
        : null;
      filas.push({
        planCode: plan.code,
        monthly: computeChargeAmount({ price: base, cycle: "monthly", customPrice, discount }).net,
        yearly: computeChargeAmount({ price: base, cycle: "yearly", customPrice, discount }).net,
        currency: price?.currency ?? tenant.currency,
      });
    }
    return filas;
  }

  async getTenantDetail(tenantId: string) {
    // `tenants` no lleva RLS: la zona se lee con el cliente base.
    const { timezone } = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    });

    const detalle = await this.prisma.withTenantContext(tenantId, async (tx) => {
      const subscription = await tx.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!subscription) {
        return null;
      }
      const payments = await tx.subscriptionPayment.findMany({
        where: { subscriptionId: subscription.id },
        // Por fecha de pago y, a igual fecha, por captura más reciente (Carlos,
        // 2026-09-02): dos pagos del mismo día se leen del último al primero.
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: 50,
      });
      const activeDiscount = await tx.tenantDiscount.findFirst({
        where: { tenantId, isActive: true },
      });
      // F9-MOD-05: los módulos avanzados vigentes (solo claves del catálogo).
      const filasModulos = await tx.tenantModule.findMany({
        where: { tenantId },
        select: { moduleKey: true },
        orderBy: { moduleKey: "asc" },
      });
      const conocidas = new Set<string>(MODULE_KEYS);
      const modules = filasModulos
        .map((f) => f.moduleKey)
        .filter((k): k is ModuleKey => conocidas.has(k));
      return { subscription, payments, activeDiscount, modules };
    });

    if (detalle) {
      return { ...detalle, timezone };
    }

    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
    return {
      subscription: {
        tenantId,
        planId: plan.id,
        status: "none",
        billingCycle: null,
        anchorDay: null,
        trialEndsAt: null,
        servicePeriodStart: null,
        servicePeriodEnd: null,
        dueAt: null,
        graceEndsAt: null,
        customPrice: null,
        canceledAt: null,
        cancelAtPeriodEnd: false,
        notes: null,
        plan,
      },
      payments: [],
      activeDiscount: null,
      modules: [] as ModuleKey[],
      timezone,
    };
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
