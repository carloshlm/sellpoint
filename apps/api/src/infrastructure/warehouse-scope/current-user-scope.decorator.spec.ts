import type { ExecutionContext } from "@nestjs/common";
import { currentUserScopeFactory } from "./current-user-scope.decorator";

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("currentUserScopeFactory — @CurrentUserScope() (F1-SCOPE-04)", () => {
  it("devuelve req.scope cuando WarehouseScopeInterceptor ya corrió", () => {
    const scope = { warehouseIds: ["w1", "w2"] };
    const ctx = contextWithRequest({ scope });

    expect(currentUserScopeFactory(undefined, ctx)).toEqual(scope);
  });

  it("Admin: devuelve warehouseIds: 'all'", () => {
    const ctx = contextWithRequest({ scope: { warehouseIds: "all" } });

    expect(currentUserScopeFactory(undefined, ctx)).toEqual({ warehouseIds: "all" });
  });

  it("sin req.scope (interceptor no corrió): fail-closed a warehouseIds: []", () => {
    const ctx = contextWithRequest({});

    expect(currentUserScopeFactory(undefined, ctx)).toEqual({ warehouseIds: [] });
  });
});
