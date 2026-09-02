import type { PlanFeatures, SubscriptionBlock } from "@sellpoint/shared";
import { api } from "@/lib/api";

export type { SubscriptionBlock };

/**
 * F7-WEB-02/04 — el catálogo publicable de planes tal como lo emite
 * `GET /billing/plans`: el precio llega YA resuelto por el país del negocio
 * (con sesión) o por `?country=` (sin sesión) — el front jamás decide
 * monedas. Premium viene con `price: null`: su CTA es contactar.
 */
export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  /** Columna dura, fuera de `features`: es lo que separa a Basic de Pro. */
  stockControl: boolean;
  dailySalesLimit: number | null;
  features: Partial<PlanFeatures>;
  price: { currency: string; monthly: string; yearly: string } | null;
}

export async function getPlans(): Promise<PublicPlan[]> {
  const { data } = await api.get<PublicPlan[]>("/billing/plans");
  return data;
}

/** F7-WEB-09 — el detalle del propio negocio (GET /billing/me). */
export interface MyBilling {
  subscription: {
    status: string;
    billingCycle: string | null;
    dueAt: string | null;
    trialEndsAt: string | null;
    customPrice: string | null;
    plan: { code: string; name: string };
  };
  payments: {
    id: string;
    paidAt: string;
    amount: string;
    currency: string;
    method: string;
    billingCycle: string;
    planCode: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    grossAmount: string;
    discountAmount: string;
    notes: string | null;
    /** Cuándo se capturó el pago (no cuándo se pagó): el segundo criterio de orden. */
    createdAt: string;
    voidedAt: string | null;
    voidReason: string | null;
  }[];
  activeDiscount: {
    kind: string;
    amount: string | null;
    maxPeriods: number | null;
    appliedPeriods: number;
  } | null;
  /** La zona del negocio: sus fechas de cobro se leen en SU calendario. */
  timezone: string;
}

export async function getMyBilling(): Promise<MyBilling> {
  const { data } = await api.get<MyBilling>("/billing/me");
  return data;
}

/** F7-WEB-10 — la tabla del backoffice (GET /admin/billing/tenants). */
export interface AdminTenants {
  tenants: {
    tenantId: string;
    tenantName: string;
    country: string | null;
    planCode: string;
    planName: string;
    status: string;
    billingCycle: string | null;
    dueAt: string | null;
    lastPaymentAt: string | null;
    currency: string;
    timezone: string;
    /**
     * Lo que pagaría por CADA plan vendible, con su cupón ya aplicado. Por
     * plan y no solo por el vigente: el formulario deja cambiar de plan, y
     * un negocio sin suscripción no tiene ninguno del cual sacar precio.
     */
    charges: { planCode: string; monthly: string; yearly: string; currency: string }[];
  }[];
  mrrByCurrency: Record<string, string>;
}

export async function getAdminTenants(): Promise<AdminTenants> {
  const { data } = await api.get<AdminTenants>("/admin/billing/tenants");
  return data;
}

/**
 * El detalle de UN negocio para el backoffice (GET /admin/billing/tenants/:id)
 * — la misma forma que `GET /billing/me`, porque es el mismo dato visto por
 * el dueño de la plataforma en vez de por el dueño del negocio.
 */
export type AdminTenantDetail = MyBilling;

export async function getAdminTenantDetail(tenantId: string): Promise<AdminTenantDetail> {
  const { data } = await api.get<AdminTenantDetail>(`/admin/billing/tenants/${tenantId}`);
  return data;
}

export async function voidPayment(tenantId: string, paymentId: string, reason: string) {
  const { data } = await api.post(`/admin/billing/tenants/${tenantId}/payments/${paymentId}/void`, {
    reason,
  });
  return data;
}

export interface RecordPaymentInput {
  billingCycle: "monthly" | "yearly";
  method: "transfer" | "cash" | "card" | "other" | "courtesy";
  paidAt: string;
  planCode?: string;
  /** Obligatorio: lo que el cliente transfirió de verdad. */
  amountReceived: string;
  /** Lo perdonado en este pago; recibido + descuento = precio del plan. */
  discountAmount?: string;
  notes?: string;
}

export async function recordPayment(tenantId: string, input: RecordPaymentInput) {
  const { data } = await api.post(`/admin/billing/tenants/${tenantId}/payments`, input);
  return data;
}
