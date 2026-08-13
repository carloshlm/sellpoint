import { getScope } from "./request-warehouse-scope";

describe("getScope (F1-SCOPE-04)", () => {
  it("devuelve req.scope cuando el interceptor ya corrió", () => {
    const scope = { warehouseIds: ["w1"] };
    expect(getScope({ scope })).toBe(scope);
  });

  it("sin req.scope -> fail-closed a warehouseIds: [] (NUNCA 'all')", () => {
    expect(getScope({})).toEqual({ warehouseIds: [] });
  });
});
