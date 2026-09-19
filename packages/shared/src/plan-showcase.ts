import type { PlanCode, PlanFeatures } from "./billing";
import type { ModuleKey } from "./modules";
import { PLAN_RANK } from "./plan-modules";

/**
 * F11-SITE-PLANS-01 — la lista COMERCIAL de planes: qué línea se anuncia, en
 * qué orden y desde qué plan es verdad. Una sola fuente para la vitrina de la
 * aplicación (`plans-modal.tsx`) y para el sitio público (`apps/site`): sin
 * esto, el día que una funcionalidad cambie de plan el sitio promete algo que
 * la aplicación ya no da.
 *
 * La VERDAD de cada flag sigue siendo la tabla `plans` (sus `features`, su
 * `stock_control`, sus límites). Aquí vive su espejo comercial, y
 * `plan-showcase.integration.spec.ts` del API falla si se separan.
 *
 * Tres clases de línea (Carlos, 2026-09-15):
 *  · `feature`: un flag de `plan.features` (o la columna `stockControl`).
 *  · `module`: un módulo de plan (`MODULE_MIN_PLAN`).
 *  · `always`: algo que TODOS los planes traen (turno de caja, ticket con
 *    logo); `premium`: lo que solo él ofrece.
 */
export type PlanLine =
  | { key: keyof PlanFeatures | "stockControl"; kind: "feature"; minPlan: PlanCode }
  | { key: ModuleKey; kind: "module"; minPlan: PlanCode }
  | { key: "cashShift" | "ticket"; kind: "always"; minPlan: "free" }
  | { key: "custom_modules"; kind: "premium"; minPlan: "premium" };

/**
 * Contada como escalera: primero todo lo de Basic, luego lo que agrega Pro,
 * luego Plus, y al final lo que solo Premium trae. Leída de arriba abajo, cada
 * bloque es un plan.
 */
export const PLAN_LINES = [
  { key: "pos", kind: "feature", minPlan: "free" },
  { key: "cashShift", kind: "always", minPlan: "free" },
  { key: "ticket", kind: "always", minPlan: "free" },
  { key: "reports", kind: "feature", minPlan: "basic" },
  { key: "reports_export", kind: "feature", minPlan: "basic" },
  { key: "expenses", kind: "module", minPlan: "basic" },
  { key: "stockControl", kind: "feature", minPlan: "pro" },
  { key: "movements", kind: "feature", minPlan: "pro" },
  { key: "transfers", kind: "feature", minPlan: "pro" },
  { key: "quotes", kind: "feature", minPlan: "pro" },
  { key: "compositions", kind: "feature", minPlan: "pro" },
  { key: "purchases", kind: "module", minPlan: "pro" },
  // Carlos (2026-09-15): las órdenes van PEGADAS a Compras aunque sean de un
  // plan más alto. Se leen juntas —comprar y planear la compra— y separarlas
  // por el escalón obligaba a buscar la segunda seis renglones más abajo.
  { key: "purchase_orders", kind: "feature", minPlan: "plus" },
  { key: "lots", kind: "feature", minPlan: "plus" },
  { key: "custom_fields", kind: "feature", minPlan: "plus" },
  { key: "custom_roles", kind: "feature", minPlan: "plus" },
  { key: "custom_modules", kind: "premium", minPlan: "premium" },
] as const satisfies readonly PlanLine[];

/** Una de las 17 líneas, exacta: quien traduce la lista tiene que cubrirlas TODAS. */
export type ShowcaseLine = (typeof PLAN_LINES)[number];
export type PlanLineKey = ShowcaseLine["key"];

/**
 * Los planes que se anuncian como tarjeta. Free no es un producto (es a donde
 * cae una cuenta vencida) y Premium se pacta: va como franja aparte.
 */
export const PUBLISHED_PLANS = ["basic", "pro", "plus"] as const;
export type PublishedPlan = (typeof PUBLISHED_PLANS)[number];

/** Los dos límites que sí venden. Espejo de `plans.max_users` y `max_warehouses`. */
export const PLAN_LIMITS: Record<PublishedPlan, { users: number; warehouses: number }> = {
  basic: { users: 3, warehouses: 1 },
  pro: { users: 6, warehouses: 4 },
  plus: { users: 20, warehouses: 10 },
};

export function planIncludesLine(planCode: PlanCode, key: PlanLineKey): boolean {
  const line = PLAN_LINES.find((candidate) => candidate.key === key);
  return line !== undefined && PLAN_RANK[planCode] >= PLAN_RANK[line.minPlan];
}

/**
 * Lo que una tarjeta LISTA: solo lo que su escalón agrega sobre el plan
 * publicado anterior («Todo lo de Basic, más…»). Basic, el primero, lista
 * también lo que ya traía Free.
 */
export function planStepLines(planCode: PublishedPlan): ShowcaseLine[] {
  const previous = PUBLISHED_PLANS[PUBLISHED_PLANS.indexOf(planCode) - 1];
  const floor = previous === undefined ? -1 : PLAN_RANK[previous];
  return PLAN_LINES.filter(
    (line) => PLAN_RANK[line.minPlan] > floor && PLAN_RANK[line.minPlan] <= PLAN_RANK[planCode],
  );
}
