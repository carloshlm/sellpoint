import type { PlanCode } from "./billing";
import { MODULE_KEYS, type ModuleKey } from "./modules";

/**
 * F9-PLANMOD-01 — la escalera de planes y la clase «módulo de plan».
 *
 * Hay dos clases de módulo (Carlos, 2026-09-10):
 * - el vertical PACTADO (`reception`, `medical_clinic`): `minPlan: null`,
 *   solo existe por una fila en `tenant_modules` y activarlo fuerza Premium
 *   con precio pactado (LEY 4 de F9);
 * - el módulo DE PLAN (`expenses` desde Basic, `purchases` desde Pro): se
 *   incluye solo con el plan contratado, y puede pactarse como add-on a un
 *   plan menor sin tocar el plan.
 *
 * Vive en su propio archivo porque `billing.ts` ya importa `modules.ts`: un
 * `PlanCode` dentro de `modules.ts` sería un ciclo. Este archivo importa de
 * los dos y nadie lo importa de vuelta.
 */
export const PLAN_RANK: Record<PlanCode, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  plus: 3,
  premium: 4,
};

/** ¿`planCode` cubre un módulo cuyo plan mínimo es `minPlan`? `null` = solo se pacta. */
export function planCovers(planCode: PlanCode, minPlan: PlanCode | null): boolean {
  if (minPlan === null) {
    return false;
  }
  return PLAN_RANK[planCode] >= PLAN_RANK[minPlan];
}

export const MODULE_MIN_PLAN: Record<ModuleKey, PlanCode | null> = {
  reception: null,
  medical_clinic: null,
  purchases: "pro",
  expenses: "basic",
};

export function planIncludesModule(planCode: PlanCode, moduleKey: ModuleKey): boolean {
  return planCovers(planCode, MODULE_MIN_PLAN[moduleKey]);
}

/** Los módulos que el plan incluye, en el orden del catálogo (determinista). */
export function planModules(planCode: PlanCode): ModuleKey[] {
  return MODULE_KEYS.filter((key) => planIncludesModule(planCode, key));
}
