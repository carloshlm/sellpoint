import { describe, expect, it } from "vitest";
import { planGap, readConstLiteral, readPlanTable } from "./plans.js";

const SHOWCASE = `
import type { PlanCode, PlanFeatures } from "./billing";
import { PLAN_RANK } from "./plan-modules";

/** La lista comercial. */
export const PLAN_LINES = [
  { key: "pos", kind: "feature", minPlan: "free" },
  { key: "expenses", kind: "module", minPlan: "basic" },
  { key: "movements", kind: "feature", minPlan: "pro" },
  { key: "lots", kind: "feature", minPlan: "plus" },
] as const satisfies readonly PlanLine[];
`;

const PLAN_MODULES = `
import type { PlanCode } from "./billing";
export const PLAN_RANK: Record<PlanCode, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  plus: 3,
  premium: 4,
};
`;

const PLANS = readPlanTable(SHOWCASE, PLAN_MODULES);

describe("readConstLiteral", () => {
  it("lee un arreglo de objetos declarado con as const y satisfies", () => {
    expect(readConstLiteral(SHOWCASE, "PLAN_LINES")).toEqual([
      { key: "pos", kind: "feature", minPlan: "free" },
      { key: "expenses", kind: "module", minPlan: "basic" },
      { key: "movements", kind: "feature", minPlan: "pro" },
      { key: "lots", kind: "feature", minPlan: "plus" },
    ]);
  });

  it("dice qué constante no encontró", () => {
    expect(() => readConstLiteral(SHOWCASE, "PLAN_RANK")).toThrow(/PLAN_RANK/);
  });
});

describe("planGap", () => {
  it("un capítulo sin marca de plan no puede mostrar una pantalla de Pro", () => {
    expect(planGap(null, ["movements"], PLANS)).toEqual({ feature: "movements", minPlan: "pro" });
  });

  it("la marca del capítulo cubre su plan y los de abajo", () => {
    expect(planGap("Desde Pro", ["movements"], PLANS)).toBeNull();
    expect(planGap("En Plus (personalizados)", ["lots", "movements"], PLANS)).toBeNull();
    expect(planGap(null, [], PLANS)).toBeNull();
  });

  it("señala el feature del plan más alto que la marca no cubre", () => {
    expect(planGap("Desde Pro", ["movements", "lots"], PLANS)).toEqual({
      feature: "lots",
      minPlan: "plus",
    });
  });

  it("un feature que la lista no conoce se señala en vez de pasar callado", () => {
    expect(planGap("En Plus", ["teleport"], PLANS)).toEqual({ feature: "teleport", minPlan: null });
  });
});
