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
    periodEnd: string;
  }[];
  activeDiscount: {
    kind: string;
    amount: string | null;
    maxPeriods: number | null;
    appliedPeriods: number;
  } | null;
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
  }[];
  mrrByCurrency: Record<string, string>;
}

export async function getAdminTenants(): Promise<AdminTenants> {
  const { data } = await api.get<AdminTenants>("/admin/billing/tenants");
  return data;
}

export interface RecordPaymentInput {
  billingCycle: "monthly" | "yearly";
  method: "transfer" | "cash" | "card" | "other" | "courtesy";
  paidAt: string;
  planCode?: string;
  amountReceived?: string;
  notes?: string;
}

export async function recordPayment(tenantId: string, input: RecordPaymentInput) {
  const { data } = await api.post(`/admin/billing/tenants/${tenantId}/payments`, input);
  return data;
}
