import { describe, expect, it } from "vitest";
import { PLAN_CODES } from "./billing";
import { MODULE_KEYS } from "./modules";
import {
  MODULE_MIN_PLAN,
  PLAN_RANK,
  planCovers,
  planIncludesModule,
  planModules,
} from "./plan-modules";

/**
 * F9-PLANMOD-01 — la escalera de planes y la clase «módulo de plan»: un
 * módulo con plan mínimo se INCLUYE con el plan; uno con `null` solo se
 * pacta (Recepción, Consultorio). Compras desde Pro, Gastos desde Basic
 * (Carlos, 2026-09-10).
 */
describe("la escalera de planes (F9-PLANMOD-01)", () => {
  it("PLAN_RANK es estrictamente creciente en el orden de PLAN_CODES", () => {
    const rangos = PLAN_CODES.map((code) => PLAN_RANK[code]);
    for (let i = 1; i < rangos.length; i += 1) {
      expect(rangos[i]).toBeGreaterThan(rangos[i - 1] as number);
    }
  });

  it("planCovers: el mismo plan o uno mayor cubre; uno menor no; null nunca", () => {
    expect(planCovers("pro", "pro")).toBe(true);
    expect(planCovers("plus", "pro")).toBe(true);
    expect(planCovers("basic", "pro")).toBe(false);
    expect(planCovers("premium", null)).toBe(false);
  });
});

describe("los módulos incluidos por plan", () => {
  it("todo módulo del catálogo tiene su plan mínimo declarado (o null)", () => {
    expect(Object.keys(MODULE_MIN_PLAN).sort()).toEqual([...MODULE_KEYS].sort());
    expect(MODULE_MIN_PLAN.reception).toBeNull();
    expect(MODULE_MIN_PLAN.medical_clinic).toBeNull();
    expect(MODULE_MIN_PLAN.expenses).toBe("basic");
    expect(MODULE_MIN_PLAN.purchases).toBe("pro");
  });

  it("Basic incluye Gastos y no Compras; Pro incluye los dos; free ninguno", () => {
    expect(planIncludesModule("basic", "expenses")).toBe(true);
    expect(planIncludesModule("basic", "purchases")).toBe(false);
    expect(planIncludesModule("pro", "purchases")).toBe(true);
    expect(planIncludesModule("free", "expenses")).toBe(false);
    expect(planIncludesModule("premium", "reception")).toBe(false);
  });

  it("planModules devuelve los incluidos en el orden del catálogo", () => {
    expect(planModules("plus")).toEqual(["purchases", "expenses"]);
    expect(planModules("basic")).toEqual(["expenses"]);
    expect(planModules("free")).toEqual([]);
  });
});
