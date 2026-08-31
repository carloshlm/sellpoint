import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { updateTenantSchema } from "./dto/update-tenant.dto";
import { TenantProfileService } from "./tenant-profile.service";

const ACTOR: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: ["tenants:manage"],
  locale: "es",
};

function buildService(overrides?: {
  tenantRow?: Record<string, unknown>;
  updatedRow?: Record<string, unknown>;
}) {
  const tenantRow = overrides?.tenantRow ?? {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
  };
  const updatedRow = overrides?.updatedRow ?? tenantRow;

  const tx = {
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(tenantRow),
      update: jest.fn().mockResolvedValue(updatedRow),
    },
  };

  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const service = new TenantProfileService(prisma as never, auditService);
  return { service, prisma, auditService, tx };
}

describe("TenantProfileService.getProfile (F1-WEB-ONBOARD)", () => {
  // 01.1: la migración aditiva de `address`/`template_choice` es nullable —
  // un tenant creado ANTES de la migración no debe romper el service.
  it("tenant preexistente sin address/template_choice (legacy) no rompe el service — ambos quedan null", async () => {
    const { service } = buildService({
      tenantRow: {
        id: "tenant-1",
        name: "Acme",
        legalName: "Acme SA",
        taxId: "RFC123",
        timezone: "America/Mexico_City",
        currency: "MXN",
        onboarded: false,
        address: null,
        templateChoice: null,
      },
    });

    const result = await service.getProfile(ACTOR);

    expect(result.address).toBeNull();
    expect(result.templateChoice).toBeNull();
    expect(result).toEqual({
      id: "tenant-1",
      name: "Acme",
      legalName: "Acme SA",
      taxId: "RFC123",
      address: null,
      timezone: "America/Mexico_City",
      currency: "MXN",
      templateChoice: null,
      onboarded: false,
      monthlySalesGoal: null,
    });
  });

  it("F7-POS-05: el PATCH acepta y persiste sellWithoutStock (el schema lo deja pasar)", async () => {
    const parsed = updateTenantSchema.parse({ sellWithoutStock: true });
    expect(parsed).toEqual({ sellWithoutStock: true });
  });

  it("resuelve dentro de withTenantContext(actor.tenantId)", async () => {
    const { service, prisma } = buildService();

    await service.getProfile(ACTOR);

    expect(prisma.withTenantContext).toHaveBeenCalledWith("tenant-1", expect.any(Function));
  });
});

describe("TenantProfileService.update (F1-WEB-ONBOARD)", () => {
  it("actualización parcial: solo los campos enviados van al update y se audita tenant.updated", async () => {
    const { service, tx, auditService } = buildService({
      updatedRow: {
        id: "tenant-1",
        name: "Acme SA de CV",
        legalName: "Acme SA de CV",
        taxId: "RFC123",
        address: "Av. Siempre Viva 123",
        timezone: "America/Mexico_City",
        currency: "MXN",
        templateChoice: null,
        onboarded: false,
        monthlySalesGoal: null,
      },
    });

    const result = await service.update(
      ACTOR,
      { legalName: "Acme SA de CV", address: "Av. Siempre Viva 123" },
      { ip: "1.2.3.4", userAgent: "jest" },
    );

    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: { legalName: "Acme SA de CV", address: "Av. Siempre Viva 123" },
      select: expect.any(Object),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        action: "tenant.updated",
        resourceType: "tenant",
        resourceId: "tenant-1",
        ip: "1.2.3.4",
        userAgent: "jest",
      }),
    );
    expect(result.address).toBe("Av. Siempre Viva 123");
  });
});

describe("TenantProfileService.completeOnboarding (F1-WEB-ONBOARD)", () => {
  it("marca onboarded=true y audita tenant.onboarded", async () => {
    const { service, tx, auditService } = buildService({
      updatedRow: {
        id: "tenant-1",
        name: "Acme",
        legalName: null,
        taxId: null,
        phone: null,
        theme: null,
        address: null,
        timezone: "America/Mexico_City",
        currency: "MXN",
        templateChoice: null,
        onboarded: true,
        monthlySalesGoal: null,
      },
    });

    const result = await service.completeOnboarding(ACTOR, {});

    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: { onboarded: true },
      select: expect.any(Object),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "tenant.onboarded", tenantId: "tenant-1" }),
    );
    expect(result.onboarded).toBe(true);
  });

  // 01.13: idempotente — llamarlo 2 veces no rompe nada, sigue `true`.
  it("es idempotente: llamarlo con el tenant ya onboarded sigue devolviendo true sin error", async () => {
    const { service } = buildService({
      tenantRow: {
        id: "tenant-1",
        name: "Acme",
        legalName: null,
        taxId: null,
        phone: null,
        theme: null,
        address: null,
        timezone: "America/Mexico_City",
        currency: "MXN",
        templateChoice: null,
        onboarded: true,
      },
      updatedRow: {
        id: "tenant-1",
        name: "Acme",
        legalName: null,
        taxId: null,
        phone: null,
        theme: null,
        address: null,
        timezone: "America/Mexico_City",
        currency: "MXN",
        templateChoice: null,
        onboarded: true,
        monthlySalesGoal: null,
      },
    });

    await expect(service.completeOnboarding(ACTOR, {})).resolves.toMatchObject({
      onboarded: true,
      monthlySalesGoal: null,
    });
    await expect(service.completeOnboarding(ACTOR, {})).resolves.toMatchObject({
      onboarded: true,
      monthlySalesGoal: null,
    });
  });
});
