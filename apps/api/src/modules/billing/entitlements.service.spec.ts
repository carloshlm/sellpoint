import type { PlanFeatures } from "@sellpoint/shared";
import { EntitlementsService } from "./entitlements.service";

/**
 * F7-CORE-01/02 — el resolver de entitlements y su caché.
 *
 * La regla única del resolver:
 *   trialing | active | past_due → el plan de la suscripción
 *   free | canceled | SIN fila   → el plan `free` (fail-closed)
 *
 * Y la del caché: Redis con TTL, invalidación explícita, y si Redis se cae
 * el fallback es POSTGRES — jamás "todo permitido".
 */
const FEATURES_PLUS: PlanFeatures = {
  pos: true,
  compositions: true,
  quotes: true,
  movements: true,
  transfers: true,
  lots: true,
  custom_fields: true,
  custom_roles: true,
  reports: true,
  reports_export: true,
};

const FEATURES_FREE: PlanFeatures = {
  pos: true,
  compositions: false,
  quotes: false,
  movements: false,
  transfers: false,
  lots: false,
  custom_fields: false,
  custom_roles: false,
  reports: false,
  reports_export: false,
};

const PLAN_PLUS = {
  id: "plan-plus",
  code: "plus",
  name: "Plus",
  maxUsers: 20,
  maxWarehouses: 10,
  dailySalesLimit: null,
  writeAccess: true,
  stockControl: true,
  features: FEATURES_PLUS,
};

const PLAN_FREE = {
  id: "plan-free",
  code: "free",
  name: "Free",
  maxUsers: 1,
  maxWarehouses: 1,
  dailySalesLimit: 10,
  writeAccess: false,
  stockControl: false,
  features: FEATURES_FREE,
};

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("EntitlementsService (F7-CORE-01/02)", () => {
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let tx: {
    tenantSubscription: { findUnique: jest.Mock };
    plan: { findUniqueOrThrow: jest.Mock };
  };
  let prisma: { withTenantContext: jest.Mock };
  let service: EntitlementsService;

  const conSuscripcion = (status: string, extra: Record<string, unknown> = {}) => {
    tx.tenantSubscription.findUnique.mockResolvedValue({
      status,
      trialEndsAt: null,
      dueAt: null,
      graceEndsAt: null,
      plan: PLAN_PLUS,
      ...extra,
    });
  };

  beforeEach(() => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    tx = {
      tenantSubscription: { findUnique: jest.fn() },
      plan: { findUniqueOrThrow: jest.fn().mockResolvedValue(PLAN_FREE) },
    };
    prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new EntitlementsService(prisma as any, redis as any);
  });

  describe("la regla del resolver", () => {
    it.each(["trialing", "active", "past_due"])(
      "%s usa el plan de la suscripción",
      async (status) => {
        conSuscripcion(status);
        const e = await service.resolve(TENANT);
        expect(e.planCode).toBe("plus");
        expect(e.status).toBe(status);
        expect(e.writeAccess).toBe(true);
        expect(e.features.lots).toBe(true);
      },
    );

    it.each(["free", "canceled"])(
      "%s cae al plan free aunque la suscripción apunte a otro",
      async (status) => {
        conSuscripcion(status);
        const e = await service.resolve(TENANT);
        expect(e.planCode).toBe("free");
        expect(e.status).toBe(status);
        expect(e.writeAccess).toBe(false);
        expect(e.dailySalesLimit).toBe(10);
      },
    );

    it("un tenant SIN fila de suscripción cae al plan free — fail-closed, nunca acceso total", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(null);
      const e = await service.resolve(TENANT);
      expect(e.planCode).toBe("free");
      expect(e.status).toBe("free");
      expect(e.writeAccess).toBe(false);
    });

    it("un JSONB de features corrupto revienta (Zod), no degrada a undefined silencioso", async () => {
      conSuscripcion("active", { plan: { ...PLAN_PLUS, features: { pos: true, lotes: true } } });
      await expect(service.resolve(TENANT)).rejects.toThrow();
    });

    it("expone las fechas del ciclo como ISO strings para el guard y el front", async () => {
      conSuscripcion("trialing", { trialEndsAt: new Date("2026-09-11T06:00:00.000Z") });
      const e = await service.resolve(TENANT);
      expect(e.trialEndsAt).toBe("2026-09-11T06:00:00.000Z");
      expect(e.dueAt).toBeNull();
    });
  });

  describe("el caché", () => {
    it("la segunda llamada sale de Redis sin tocar la base", async () => {
      conSuscripcion("active");
      const primera = await service.resolve(TENANT);
      expect(redis.set).toHaveBeenCalledWith(
        `entitlements:${TENANT}`,
        expect.any(String),
        "EX",
        300,
      );

      redis.get.mockResolvedValue(JSON.stringify(primera));
      const segunda = await service.resolve(TENANT);
      expect(segunda).toEqual(primera);
      expect(prisma.withTenantContext).toHaveBeenCalledTimes(1);
    });

    it("invalidate borra la key y la siguiente lectura vuelve a la base", async () => {
      await service.invalidate(TENANT);
      expect(redis.del).toHaveBeenCalledWith(`entitlements:${TENANT}`);
    });

    it("con Redis caído resuelve desde Postgres — fail-open a la BASE, no a 'todo permitido'", async () => {
      redis.get.mockRejectedValue(new Error("ECONNREFUSED"));
      redis.set.mockRejectedValue(new Error("ECONNREFUSED"));
      conSuscripcion("free");
      const e = await service.resolve(TENANT);
      expect(e.planCode).toBe("free");
      expect(e.writeAccess).toBe(false);
    });

    it("con Redis caído invalidate no lanza (el cambio de plan no puede fallar por el caché)", async () => {
      redis.del.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(service.invalidate(TENANT)).resolves.toBeUndefined();
    });
  });
});
