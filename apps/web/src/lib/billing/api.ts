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
