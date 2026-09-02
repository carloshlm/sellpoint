import { UnprocessableEntityException } from "@nestjs/common";
import { TenantModulesService } from "./tenant-modules.service";

/**
 * F9-MOD-04 — activar y desactivar módulos avanzados por negocio.
 *
 * Las reglas que estos tests fijan:
 *  - activar un módulo vuelve al negocio PREMIUM con precio pactado, y eso lo
 *    hace `BillingService.changePlan` (la invariante del `custom_price` vive
 *    ahí y no se duplica acá): sin precio sobre un Plus → 422 y NO queda fila;
 *  - activar dos veces es idempotente: ni segunda fila ni segundo audit;
 *  - desactivar NO degrada el plan: bajar de Premium es una decisión
 *    comercial que se toma a mano con el PATCH de suscripción;
 *  - todo cambio real audita con la razón e invalida los entitlements UNA vez.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const ADMIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Mock = jest.Mock;

describe("TenantModulesService (F9-MOD-04)", () => {
  let tx: {
    tenantSubscription: { findUnique: Mock };
    tenantModule: { findMany: Mock; findUnique: Mock; create: Mock; deleteMany: Mock };
  };
  let prisma: { withTenantContext: Mock };
  let billing: { changePlan: Mock };
  let audit: { record: Mock };
  let entitlements: { invalidate: Mock };
  let service: TenantModulesService;

  const suscripcion = (code: string) => ({
    id: "sub-1",
    tenantId: TENANT,
    plan: { id: `plan-${code}`, code },
  });

  beforeEach(() => {
    tx = {
      tenantSubscription: { findUnique: jest.fn().mockResolvedValue(suscripcion("plus")) },
      tenantModule: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "tm-1", ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      withTenantContext: jest.fn((_tenantId: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    billing = { changePlan: jest.fn().mockResolvedValue({}) };
    audit = { record: jest.fn() };
    entitlements = { invalidate: jest.fn() };
    service = new TenantModulesService(
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      prisma as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      billing as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      audit as any,
      // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
      entitlements as any,
    );
  });

  describe("activar", () => {
    it("un Plus sin precio pactado rebota con el 422 de changePlan y NO queda fila", async () => {
      billing.changePlan.mockRejectedValue(
        new UnprocessableEntityException({ message: "billing.custom_price_required" }),
      );
      await expect(
        service.enable(TENANT, { moduleKey: "reception", reason: "deal" }),
      ).rejects.toMatchObject({ status: 422 });
      expect(tx.tenantModule.create).not.toHaveBeenCalled();
      expect(entitlements.invalidate).not.toHaveBeenCalled();
    });

    it("con precio pactado: pasa a premium por changePlan, crea la fila, audita e invalida UNA vez", async () => {
      tx.tenantModule.findMany.mockResolvedValue([{ moduleKey: "reception" }]);

      const modules = await service.enable(TENANT, {
        moduleKey: "reception",
        customPrice: "1250.00",
        notes: "pactado por teléfono",
        reason: "deal VIP",
        changedBy: ADMIN,
      });

      expect(billing.changePlan).toHaveBeenCalledWith(TENANT, {
        planCode: "premium",
        customPrice: "1250.00",
        reason: "deal VIP",
        changedBy: ADMIN,
      });
      expect(tx.tenantModule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT,
          moduleKey: "reception",
          enabledBy: ADMIN,
          notes: "pactado por teléfono",
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId: TENANT,
          userId: ADMIN,
          action: "tenant_module.enabled",
          resourceType: "tenant_module",
          resourceId: "reception",
          after: expect.objectContaining({
            moduleKey: "reception",
            reason: "deal VIP",
            actor: { platformAdmin: true },
          }),
        }),
      );
      expect(entitlements.invalidate).toHaveBeenCalledTimes(1);
      expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
      expect(modules).toEqual(["reception"]);
    });

    it("un negocio ya premium no pasa por changePlan si no trae precio nuevo", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(suscripcion("premium"));
      await service.enable(TENANT, { moduleKey: "reception", reason: "deal" });
      expect(billing.changePlan).not.toHaveBeenCalled();
      expect(tx.tenantModule.create).toHaveBeenCalled();
    });

    it("un premium con precio nuevo solo actualiza el precio, sin cambiar de plan", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(suscripcion("premium"));
      await service.enable(TENANT, {
        moduleKey: "reception",
        customPrice: "1500.00",
        reason: "sube el precio",
        changedBy: ADMIN,
      });
      expect(billing.changePlan).toHaveBeenCalledWith(TENANT, {
        customPrice: "1500.00",
        reason: "sube el precio",
        changedBy: ADMIN,
      });
    });

    it("activar dos veces es idempotente: ni segunda fila, ni segundo audit, ni invalidación", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(suscripcion("premium"));
      tx.tenantModule.findUnique.mockResolvedValue({ id: "tm-1", moduleKey: "reception" });
      await service.enable(TENANT, { moduleKey: "reception", reason: "otra vez" });
      expect(tx.tenantModule.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(entitlements.invalidate).not.toHaveBeenCalled();
    });

    it("un negocio sin suscripción → 404 billing.subscription_not_found, sin tocar el plan", async () => {
      tx.tenantSubscription.findUnique.mockResolvedValue(null);
      await expect(
        service.enable(TENANT, { moduleKey: "reception", reason: "deal" }),
      ).rejects.toMatchObject({
        status: 404,
        response: { message: "billing.subscription_not_found" },
      });
      expect(billing.changePlan).not.toHaveBeenCalled();
    });
  });

  describe("desactivar", () => {
    it("borra la fila, audita con la razón e invalida — y NO toca el plan", async () => {
      const modules = await service.disable(TENANT, {
        moduleKey: "reception",
        reason: "ya no lo usa",
        changedBy: ADMIN,
      });
      expect(tx.tenantModule.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, moduleKey: "reception" },
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "tenant_module.disabled",
          userId: ADMIN,
          before: expect.objectContaining({ moduleKey: "reception" }),
          after: expect.objectContaining({
            reason: "ya no lo usa",
            actor: { platformAdmin: true },
          }),
        }),
      );
      expect(entitlements.invalidate).toHaveBeenCalledTimes(1);
      expect(billing.changePlan).not.toHaveBeenCalled();
      expect(modules).toEqual([]);
    });

    it("desactivar lo que no estaba activo no audita ni invalida", async () => {
      tx.tenantModule.deleteMany.mockResolvedValue({ count: 0 });
      await service.disable(TENANT, { moduleKey: "reception", reason: "nada" });
      expect(audit.record).not.toHaveBeenCalled();
      expect(entitlements.invalidate).not.toHaveBeenCalled();
    });
  });

  describe("listar", () => {
    it("devuelve solo claves del catálogo, en orden", async () => {
      tx.tenantModule.findMany.mockResolvedValue([
        { moduleKey: "foo" },
        { moduleKey: "reception" },
      ]);
      await expect(service.list(TENANT)).resolves.toEqual(["reception"]);
    });
  });
});
