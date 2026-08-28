import { Reflector } from "@nestjs/core";
import { PlanRequiredException } from "../plan-required.exception";
import { ALLOWED_IN_FREE_TIER_KEY, AllowedInFreeTier } from "./allowed-in-free-tier.decorator";
import { CHECK_PLAN_LIMIT_KEY, CheckPlanLimit } from "./check-plan-limit.decorator";
import { REQUIRES_FEATURE_KEY, RequiresFeature } from "./requires-feature.decorator";

/**
 * F7-GUARD-01/02 — la excepción 402 y los tres decoradores que el
 * SubscriptionGuard lee. Specs de metadata, patrón
 * require-permissions.decorator.
 */
describe("PlanRequiredException (F7-GUARD-01)", () => {
  it("es un 402 con clave i18n y args para el interceptor del front", () => {
    const e = new PlanRequiredException("billing.daily_sales_limit_reached", { limit: 10 });
    expect(e.getStatus()).toBe(402);
    expect(e.getResponse()).toEqual({
      message: "billing.daily_sales_limit_reached",
      args: { limit: 10 },
    });
  });

  it("los args son opcionales", () => {
    const e = new PlanRequiredException("billing.read_only");
    expect(e.getStatus()).toBe(402);
    expect(e.getResponse()).toEqual({ message: "billing.read_only" });
  });
});

describe("decoradores de billing (F7-GUARD-02)", () => {
  const reflector = new Reflector();

  it("@RequiresFeature declara el flag que el plan debe incluir", () => {
    class Dummy {
      @RequiresFeature("lots")
      handler() {}
    }
    expect(reflector.get(REQUIRES_FEATURE_KEY, Dummy.prototype.handler)).toBe("lots");
  });

  it("@AllowedInFreeTier marca el handler como operable sin plan", () => {
    class Dummy {
      @AllowedInFreeTier()
      handler() {}
    }
    expect(reflector.get(ALLOWED_IN_FREE_TIER_KEY, Dummy.prototype.handler)).toBe(true);
  });

  it("@CheckPlanLimit declara la dimensión que se cuenta al crear", () => {
    class Dummy {
      @CheckPlanLimit("users")
      handler() {}
    }
    expect(reflector.get(CHECK_PLAN_LIMIT_KEY, Dummy.prototype.handler)).toBe("users");
  });
});
