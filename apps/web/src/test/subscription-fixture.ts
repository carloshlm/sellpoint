import type { SubscriptionBlock } from "@sellpoint/shared";

/**
 * F7-WEB-01 — el bloque de suscripción de los fixtures de test: un trial
 * Plus con todo prendido, el estado en que nace todo tenant. Los tests que
 * ejercitan free tier o features apagados construyen su propia variante con
 * spread sobre este.
 */
export const SUBSCRIPTION_PLUS: SubscriptionBlock = {
  planCode: "plus",
  planName: "Plus",
  status: "trialing",
  billingCycle: null,
  trialEndsAt: null,
  dueAt: null,
  graceEndsAt: null,
  daysLeft: 14,
  overdue: false,
  writeAccess: true,
  stockControl: true,
  dailySalesLimit: null,
  features: {
    pos: true,
    compositions: true,
    quotes: true,
    movements: true,
    transfers: true,
    lots: true,
    custom_fields: true,
    custom_roles: true,
    reports: true,
    reports_export: true,
  },
  modules: [],
};
