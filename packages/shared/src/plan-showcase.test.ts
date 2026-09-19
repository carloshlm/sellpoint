import { describe, expect, it } from "vitest";
import { planFeaturesSchema } from "./billing";
import { MODULE_MIN_PLAN } from "./plan-modules";
import {
  PLAN_LIMITS,
  PLAN_LINES,
  PUBLISHED_PLANS,
  planIncludesLine,
  planStepLines,
} from "./plan-showcase";

// F11-SITE-PLANS-01 — la lista comercial de planes, en un solo lugar: la leen
// la vitrina de la aplicación y el sitio público.
describe("lista comercial de planes", () => {
  it("son las 17 líneas de la vitrina, sin repetir ninguna", () => {
    expect(PLAN_LINES).toHaveLength(17);
    expect(new Set(PLAN_LINES.map((line) => line.key)).size).toBe(17);
  });

  it("se cuenta como escalera: el plan mínimo nunca baja, salvo la excepción pactada", () => {
    // Carlos (2026-09-15): las órdenes de compra van PEGADAS a Compras aunque
    // sean de Plus. Es la única línea que rompe la escalera, y a propósito.
    const rank = { free: 0, basic: 1, pro: 2, plus: 3, premium: 4 };
    const ranks = PLAN_LINES.filter((line) => line.key !== "purchase_orders").map(
      (line) => rank[line.minPlan],
    );
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const orders = PLAN_LINES.findIndex((line) => line.key === "purchase_orders");
    expect(PLAN_LINES[orders - 1]?.key).toBe("purchases");
  });

  it("un módulo dice el mismo plan mínimo que MODULE_MIN_PLAN", () => {
    for (const line of PLAN_LINES) {
      if (line.kind === "module") expect(line.minPlan, line.key).toBe(MODULE_MIN_PLAN[line.key]);
    }
  });

  it("toda línea de tipo feature es un flag real de plan.features (o stockControl)", () => {
    const flags = Object.keys(planFeaturesSchema.shape);
    for (const line of PLAN_LINES) {
      if (line.kind === "feature" && line.key !== "stockControl") {
        expect(flags, line.key).toContain(line.key);
      }
    }
  });

  it("se publican Basic, Pro y Plus; Free y Premium no son tarjetas", () => {
    expect([...PUBLISHED_PLANS]).toEqual(["basic", "pro", "plus"]);
    expect(PLAN_LIMITS.basic).toEqual({ users: 3, warehouses: 1 });
    expect(PLAN_LIMITS.pro).toEqual({ users: 6, warehouses: 4 });
    expect(PLAN_LIMITS.plus).toEqual({ users: 20, warehouses: 10 });
  });

  it("un plan incluye una línea si alcanza su plan mínimo", () => {
    expect(planIncludesLine("basic", "pos")).toBe(true);
    expect(planIncludesLine("basic", "stockControl")).toBe(false);
    expect(planIncludesLine("pro", "stockControl")).toBe(true);
    expect(planIncludesLine("pro", "lots")).toBe(false);
    expect(planIncludesLine("plus", "lots")).toBe(true);
    expect(planIncludesLine("plus", "custom_modules")).toBe(false);
  });

  it("cada tarjeta lista SOLO lo que su escalón agrega («Todo lo de Basic, más…»)", () => {
    expect(planStepLines("basic").map((line) => line.key)).toEqual([
      "pos",
      "cashShift",
      "ticket",
      "reports",
      "reports_export",
      "expenses",
    ]);
    expect(planStepLines("pro").map((line) => line.key)).toEqual([
      "stockControl",
      "movements",
      "transfers",
      "quotes",
      "compositions",
      "purchases",
    ]);
    expect(planStepLines("plus").map((line) => line.key)).toEqual([
      "purchase_orders",
      "lots",
      "custom_fields",
      "custom_roles",
    ]);
  });
});
