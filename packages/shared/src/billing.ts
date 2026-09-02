import { z } from "zod";
import { localCalendarDate, startOfDayUtc } from "./day-range";
import { scaledInteger } from "./decimal-text";
import { moduleKeySchema } from "./modules";
import { MONEY_DECIMALS } from "./money";

/**
 * F7-SHARED — contratos y matemática pura del sistema de suscripciones.
 *
 * ── El ancla es la pieza crítica ────────────────────────────────────────
 *
 * El día del mes al que se ancla el cobro (`anchor_day`) se fija con el
 * PRIMER pago y nunca se recalcula. El próximo vencimiento se deriva de la
 * FECHA del vencimiento anterior, no del instante en que arranca el período:
 * el período que sigue a un vencimiento del 28-feb arranca el 1-mar, y si el
 * cálculo partiera de ahí, "mes siguiente" sería abril — la cadena correcta
 * del cliente del 31 es 31-ene → 28-feb → 31-mar (recorta en meses cortos y
 * VUELVE al ancla cuando el mes lo permite).
 *
 * ── Fechas versus instantes ─────────────────────────────────────────────
 *
 * `addBillingPeriod` opera sobre fechas del calendario del NEGOCIO
 * (`YYYY-MM-DD`) y es pura: sin zona horaria, sin `Date`. La traducción a
 * instantes UTC es de `dueInstant`/`graceEndsAt`, que siguen el criterio de
 * límite ABIERTO de `day-range`: "vence el 5" significa que el 5 completo es
 * hábil y el instante devuelto es el arranque del 6 local — el cron degrada
 * con `due_at <= now()` sin perder el último milisegundo del día.
 */

export const PLAN_CODES = ["free", "basic", "pro", "plus", "premium"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "free",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

// SUBSCRIPTION_* porque el POS ya exporta PAYMENT_METHODS para las VENTAS:
// cómo paga el cliente final en caja y cómo paga el tenant su plan son dos
// catálogos distintos que evolucionan por separado.
export const SUBSCRIPTION_PAYMENT_METHODS = [
  "transfer",
  "cash",
  "card",
  "other",
  "courtesy",
] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const DISCOUNT_KINDS = ["fixed_amount", "free"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 10;

/**
 * La matriz de features del JSONB `plans.features`, cerrada con `strictObject`
 * y sin defaults: una key con typo o un flag ausente revienta al leer la fila
 * en tests, no como un `undefined` silencioso en producción. Cada flag es una
 * decisión de la matriz de planes, no algo que se hereda por omisión.
 */
export const planFeaturesSchema = z.strictObject({
  pos: z.boolean(),
  compositions: z.boolean(),
  quotes: z.boolean(),
  movements: z.boolean(),
  transfers: z.boolean(),
  lots: z.boolean(),
  custom_fields: z.boolean(),
  custom_roles: z.boolean(),
  reports: z.boolean(),
  reports_export: z.boolean(),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

/**
 * El bloque de suscripción que emiten `POST /auth/login` y `GET /me` hacia el
 * front (patrón A1: un tipo, un mapper, los emisores devuelven el mismo
 * shape). `daysLeft` viene calculado del server con la zona del tenant.
 */
export const subscriptionBlockSchema = z.object({
  planCode: z.enum(PLAN_CODES),
  planName: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
  billingCycle: z.enum(BILLING_CYCLES).nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  graceEndsAt: z.iso.datetime().nullable(),
  daysLeft: z.number().int().nullable(),
  /**
   * El vencimiento YA PASÓ y el sistema todavía no lo procesó: el barrido
   * corre una vez al día (3 AM) y hasta entonces el `status` sigue diciendo
   * `active`. Sin esta bandera el cliente no vería NADA entre que su pago
   * vence y que el cron lo mueve — justo cuando más falta hace avisarle
   * (Carlos, 2026-08-29).
   *
   * Es solo para AVISAR: el corte y los correos siguen siendo del cron.
   * Nadie pierde acceso por un reloj.
   */
  overdue: z.boolean(),
  writeAccess: z.boolean(),
  stockControl: z.boolean(),
  dailySalesLimit: z.number().int().positive().nullable(),
  features: planFeaturesSchema,
  /**
   * F9-MOD-01 — los módulos avanzados activos del negocio (por encima del
   * plan). REQUERIDO, sin default: un emisor que lo olvide rompe en el
   * parse y no en un menú que nunca aparece. Vacío para todos hasta que el
   * backoffice active el primero (F9-MOD-03 lo resuelve desde `tenant_modules`).
   */
  modules: z.array(moduleKeySchema),
});
export type SubscriptionBlock = z.infer<typeof subscriptionBlockSchema>;

/**
 * El día del mes (1-31) al que se ancla el cobro: el del calendario del
 * NEGOCIO en el instante del pago. Las 23:30 locales de CDMX ya son el día
 * siguiente en UTC — el ancla del cliente es el día que ÉL vivió al pagar.
 */
export function resolveAnchorDay(paidAt: Date, timeZone: string): number {
  return Number(localCalendarDate(timeZone, paidAt).slice(8, 10));
}

function daysInMonth(year: number, month: number): number {
  // Día 0 del mes siguiente = último día de este mes. En UTC: determinista.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIsoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * La fecha del PRÓXIMO vencimiento a partir de la fecha del vencimiento
 * anterior (o del día del primer pago). Pura de calendario: recibe y devuelve
 * `YYYY-MM-DD` del calendario del negocio.
 *
 *   addBillingPeriod("2026-08-05", "monthly", 5)  → "2026-09-05"
 *   addBillingPeriod("2026-08-05", "yearly",  5)  → "2027-08-05"
 *   addBillingPeriod("2026-01-31", "monthly", 31) → "2026-02-28"  ← recorta
 *   addBillingPeriod("2026-02-28", "monthly", 31) → "2026-03-31"  ← y VUELVE
 *   addBillingPeriod("2028-02-29", "yearly",  29) → "2029-02-28"
 */
export function addBillingPeriod(
  fromDueDate: string,
  cycle: BillingCycle,
  anchorDay: number,
): string {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError(`addBillingPeriod: anchorDay fuera de 1-31 (${anchorDay})`);
  }
  const [year, month] = fromDueDate.split("-").map(Number);
  if (!year || !month) {
    throw new RangeError(`addBillingPeriod: fecha inválida (${fromDueDate})`);
  }

  let targetYear = year;
  let targetMonth = month;
  if (cycle === "monthly") {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  } else {
    targetYear += 1;
  }

  return toIsoDate(
    targetYear,
    targetMonth,
    Math.min(anchorDay, daysInMonth(targetYear, targetMonth)),
  );
}

/**
 * El instante UTC en que un vencimiento se considera VENCIDO: el arranque del
 * día siguiente en la zona del negocio (límite abierto, criterio de
 * `day-range`). El día del vencimiento completo sigue siendo hábil.
 */
export function dueInstant(dueDate: string, timeZone: string): Date {
  const [year, month, day] = dueDate.split("-").map(Number);
  const siguiente = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return startOfDayUtc(siguiente.toISOString().slice(0, 10), timeZone);
}

/**
 * El instante en que EXPIRA la gracia: `GRACE_DAYS` días completos después
 * del día del vencimiento. Vence el 5 → gracia del 6 al 15 → este instante es
 * el arranque del 16 local, el "día 11" en que el cron degrada.
 */
export function graceEndsAt(dueDate: string, timeZone: string): Date {
  const [year, month, day] = dueDate.split("-").map(Number);
  const fin = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + GRACE_DAYS + 1));
  return startOfDayUtc(fin.toISOString().slice(0, 10), timeZone);
}

export interface ChargeInput {
  /** Precio publicado del plan para el mercado del tenant (`plan_prices`); null si el plan no publica (free/premium). */
  price: { monthly: string; yearly: string } | null;
  cycle: BillingCycle;
  /** Override por tenant (`tenant_subscriptions.custom_price`): ES el precio del período pactado, gana siempre. */
  customPrice: string | null;
  discount: { kind: DiscountKind; amount: string | null } | null;
}

export interface ChargeAmount {
  gross: string;
  discount: string;
  net: string;
}

/** Centavos (entero) → texto decimal con 2 posiciones, sin pasar por IEEE-754. */
function centsToText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Cuánto se cobra un período: bruto, descuento aplicado y neto, como texto
 * decimal (la cuenta se hace en centavos ENTEROS, criterio de `money`).
 *
 * La invariante de Premium vive aquí y no en la base (no hay CHECK
 * cross-tabla): un plan sin precio publicado exige `custom_price`.
 */
export function computeChargeAmount(input: ChargeInput): ChargeAmount {
  let grossCents: number;
  if (input.customPrice !== null) {
    grossCents = scaledInteger(input.customPrice, MONEY_DECIMALS);
  } else if (input.price !== null) {
    const base = input.cycle === "yearly" ? input.price.yearly : input.price.monthly;
    grossCents = scaledInteger(base, MONEY_DECIMALS);
  } else {
    throw new Error("computeChargeAmount: plan sin precio publicado exige customPrice");
  }

  let discountCents = 0;
  if (input.discount?.kind === "free") {
    discountCents = grossCents;
  } else if (input.discount?.kind === "fixed_amount") {
    // Piso en cero: un cupón mayor que el precio regala el período, jamás
    // genera un cobro negativo.
    discountCents = Math.min(scaledInteger(input.discount.amount, MONEY_DECIMALS), grossCents);
  }

  return {
    gross: centsToText(grossCents),
    discount: centsToText(discountCents),
    net: centsToText(grossCents - discountCents),
  };
}

/**
 * El MERCADO cuya tarifa le corresponde a un negocio: el país que decide
 * en qué moneda se le cobra y qué precios ve.
 *
 * El orden importa y es el de la confianza en el dato:
 *
 *  1. `country` — lo que el negocio eligió en su onboarding. Manda siempre.
 *  2. `currency` — el segundo mejor dato. Los tenants anteriores al
 *     onboarding tienen `country` en NULL pero SÍ tienen moneda: asumir
 *     Estados Unidos con un "MXN" escrito en su propia fila es peor que
 *     derivarlo.
 *  3. `US` — el default internacional, para quien no dice ni una cosa ni la
 *     otra.
 *
 * ⚠ Vive acá y no en cada llamador porque lo usan los DOS caminos: la
 * vitrina de planes (qué precio VE) y `resolvePrice` (cuánto se le COBRA).
 * Que divergieran sería mostrar un precio y cobrar otro.
 */
export function resolveMarket(tenant: {
  country?: string | null;
  currency?: string | null;
}): string {
  if (tenant.country) {
    return tenant.country.toUpperCase();
  }
  const porMoneda: Record<string, string> = { MXN: "MX", CAD: "CA", USD: "US" };
  return porMoneda[(tenant.currency ?? "").toUpperCase()] ?? "US";
}
