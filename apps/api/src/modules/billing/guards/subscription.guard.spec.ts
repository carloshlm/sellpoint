import type { ExecutionContext } from "@nestjs/common";
import { ALLOWED_IN_FREE_TIER_KEY } from "../decorators/allowed-in-free-tier.decorator";
import { CHECK_PLAN_LIMIT_KEY } from "../decorators/check-plan-limit.decorator";
import { REQUIRES_FEATURE_KEY } from "../decorators/requires-feature.decorator";
import { REQUIRES_MODULE_KEY } from "../decorators/requires-module.decorator";
import { SubscriptionGuard } from "./subscription.guard";

/**
 * F7-GUARD-03 — el guard que hace cumplir el plan en cada request.
 *
 * El orden de las reglas importa y estos tests lo fijan:
 *  1. escapes (@Public, sin user, @AllowedInFreeTier) — pasan SIN resolver
 *     entitlements (cero roundtrips en lo que no aplica);
 *  2. GET/HEAD pasan siempre — el free tier VE todo, incluida la historia
 *     de módulos que su plan ya no incluye;
 *  3. free tier + método mutante → 402 read_only (el mensaje del ESTADO);
 *  4. @RequiresFeature en mutantes → 402 feature_not_in_plan;
 *  5. @CheckPlanLimit al crear → cuenta contra max_* → 402 al tope.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";

const ENTITLEMENTS_PLUS = {
  planCode: "plus",
  writeAccess: true,
  stockControl: true,
  maxUsers: 20,
  maxWarehouses: 10,
  features: { lots: true, quotes: true, movements: true },
};

const ENTITLEMENTS_BASIC = {
  planCode: "basic",
  writeAccess: true,
  stockControl: false,
  maxUsers: 3,
  maxWarehouses: 1,
  features: { lots: false, quotes: false, movements: false },
};

const ENTITLEMENTS_FREE = {
  planCode: "free",
  writeAccess: false,
  stockControl: false,
  maxUsers: 1,
  maxWarehouses: 1,
  features: { lots: false, quotes: false, movements: false },
};

describe("SubscriptionGuard (F7-GUARD-03)", () => {
  let metadata: Record<string, unknown>;
  let reflector: { getAllAndOverride: jest.Mock };
  let entitlements: { resolve: jest.Mock };
  let tx: { user: { count: jest.Mock }; warehouse: { count: jest.Mock } };
  let prisma: { withTenantContext: jest.Mock };
  let guard: SubscriptionGuard;

  const contexto = (method: string, user: unknown = { tenantId: TENANT }): ExecutionContext =>
    ({
      getHandler: () => "handler",
      getClass: () => "class",
      switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    metadata = {};
    reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    };
    entitlements = { resolve: jest.fn().mockResolvedValue(ENTITLEMENTS_PLUS) };
    tx = {
      user: { count: jest.fn().mockResolvedValue(0) },
      warehouse: { count: jest.fn().mockResolvedValue(0) },
    };
    prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    guard = new SubscriptionGuard(reflector as any, entitlements as any, prisma as any);
  });

  describe("los escapes no gastan un solo roundtrip", () => {
    it("@Public pasa sin resolver", async () => {
      metadata.isPublic = true;
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });

    it("sin request.user pasa (el JwtAuthGuard ya decidió)", async () => {
      // `null` y no `undefined`: undefined activaría el default del helper.
      await expect(guard.canActivate(contexto("POST", null))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });

    it("@AllowedInFreeTier pasa sin resolver", async () => {
      metadata[ALLOWED_IN_FREE_TIER_KEY] = true;
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });

    it("GET pasa sin resolver: el free tier VE todo", async () => {
      await expect(guard.canActivate(contexto("GET"))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });
  });

  describe("solo-lectura del free tier", () => {
    it("free tier + POST → 402 billing.read_only", async () => {
      entitlements.resolve.mockResolvedValue(ENTITLEMENTS_FREE);
      await expect(guard.canActivate(contexto("POST"))).rejects.toMatchObject({
        status: 402,
        response: { message: "billing.read_only" },
      });
    });

    it("plan de pago + POST sin metadata pasa", async () => {
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
    });
  });

  describe("features del plan", () => {
    it("Basic + mutante con @RequiresFeature('lots') → 402 feature_not_in_plan", async () => {
      entitlements.resolve.mockResolvedValue(ENTITLEMENTS_BASIC);
      metadata[REQUIRES_FEATURE_KEY] = "lots";
      await expect(guard.canActivate(contexto("PATCH"))).rejects.toMatchObject({
        status: 402,
        response: {
          message: "billing.feature_not_in_plan",
          args: { feature: "lots", planCode: "basic" },
        },
      });
    });

    it("Plus con el flag prendido pasa", async () => {
      metadata[REQUIRES_FEATURE_KEY] = "lots";
      await expect(guard.canActivate(contexto("PATCH"))).resolves.toBe(true);
    });
  });

  /**
   * F9-MOD-06 — un módulo vertical nunca estuvo en un plan público y es 90 %%
   * lectura: apagado, se apaga ENTERO, también los GET. Los datos no se
   * borran; reactivar los devuelve. Y el chequeo no cuesta un roundtrip de
   * más a nadie: solo resuelve entitlements si el decorador está presente.
   */
  describe("módulos por tenant (@RequiresModule)", () => {
    it("módulo apagado → 402 module_not_enabled en POST", async () => {
      entitlements.resolve.mockResolvedValue({ ...ENTITLEMENTS_PLUS, modules: [] });
      metadata[REQUIRES_MODULE_KEY] = "reception";
      await expect(guard.canActivate(contexto("POST"))).rejects.toMatchObject({
        status: 402,
        response: { message: "billing.module_not_enabled", args: { module: "reception" } },
      });
    });

    it("módulo apagado → 402 TAMBIÉN en GET: se apaga entero, no solo la escritura", async () => {
      entitlements.resolve.mockResolvedValue({ ...ENTITLEMENTS_PLUS, modules: [] });
      metadata[REQUIRES_MODULE_KEY] = "reception";
      await expect(guard.canActivate(contexto("GET"))).rejects.toMatchObject({
        status: 402,
        response: { message: "billing.module_not_enabled" },
      });
    });

    it("módulo prendido pasa, en GET y en POST", async () => {
      entitlements.resolve.mockResolvedValue({ ...ENTITLEMENTS_PLUS, modules: ["reception"] });
      metadata[REQUIRES_MODULE_KEY] = "reception";
      await expect(guard.canActivate(contexto("GET"))).resolves.toBe(true);
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
    });

    it("sin el decorador, un GET sigue sin resolver entitlements", async () => {
      await expect(guard.canActivate(contexto("GET"))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });

    it("@Public y @AllowedInFreeTier siguen ganando aunque el handler exija módulo", async () => {
      metadata[REQUIRES_MODULE_KEY] = "reception";
      metadata[ALLOWED_IN_FREE_TIER_KEY] = true;
      await expect(guard.canActivate(contexto("GET"))).resolves.toBe(true);
      expect(entitlements.resolve).not.toHaveBeenCalled();
    });
  });

  describe("límites al crear", () => {
    it("Basic con 3 usuarios no crea el cuarto: 402 user_limit_reached", async () => {
      entitlements.resolve.mockResolvedValue(ENTITLEMENTS_BASIC);
      metadata[CHECK_PLAN_LIMIT_KEY] = "users";
      tx.user.count.mockResolvedValue(3);
      await expect(guard.canActivate(contexto("POST"))).rejects.toMatchObject({
        status: 402,
        response: { message: "billing.user_limit_reached", args: { limit: 3 } },
      });
    });

    it("bajo el límite pasa", async () => {
      entitlements.resolve.mockResolvedValue(ENTITLEMENTS_BASIC);
      metadata[CHECK_PLAN_LIMIT_KEY] = "users";
      tx.user.count.mockResolvedValue(2);
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
    });

    it("Basic con su único almacén no crea el segundo", async () => {
      entitlements.resolve.mockResolvedValue(ENTITLEMENTS_BASIC);
      metadata[CHECK_PLAN_LIMIT_KEY] = "warehouses";
      tx.warehouse.count.mockResolvedValue(1);
      await expect(guard.canActivate(contexto("POST"))).rejects.toMatchObject({
        status: 402,
        response: { message: "billing.warehouse_limit_reached", args: { limit: 1 } },
      });
    });

    it("max NULL (Premium) crea sin tope y sin contar", async () => {
      entitlements.resolve.mockResolvedValue({ ...ENTITLEMENTS_PLUS, maxUsers: null });
      metadata[CHECK_PLAN_LIMIT_KEY] = "users";
      await expect(guard.canActivate(contexto("POST"))).resolves.toBe(true);
      expect(tx.user.count).not.toHaveBeenCalled();
    });
  });
});
