import { UnprocessableEntityException } from "@nestjs/common";
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

  // F4-TAX-19: la siembra del catálogo fiscal vive en TaxSettingsService; acá
  // solo importa que se llame con la MISMA tx y que se audite lo sembrado.
  const taxSettings = { sembrar: jest.fn().mockResolvedValue(null) };

  const hasher = { hash: jest.fn(async (p: string) => `hash(${p})`), verify: jest.fn() };
  const service = new TenantProfileService(
    prisma as never,
    auditService,
    taxSettings as never,
    hasher,
  );
  return { service, prisma, auditService, tx, taxSettings, hasher };
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
      discountCodeSetAt: null,
      discountMaxPercent: null,
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
        discountCodeSetAt: null,
        discountMaxPercent: null,
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
        discountCodeSetAt: null,
        discountMaxPercent: null,
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
        discountCodeSetAt: null,
        discountMaxPercent: null,
      },
    });

    await expect(service.completeOnboarding(ACTOR, {})).resolves.toMatchObject({
      onboarded: true,
      monthlySalesGoal: null,
      discountCodeSetAt: null,
      discountMaxPercent: null,
    });
    await expect(service.completeOnboarding(ACTOR, {})).resolves.toMatchObject({
      onboarded: true,
      monthlySalesGoal: null,
      discountCodeSetAt: null,
      discountMaxPercent: null,
    });
  });
});

/**
 * F4-TAX-18 — la provincia o el estado viajan CON el país: un país que no la
 * usa la deja en null, y una región se valida contra el país del body o, si
 * no viene, contra el guardado. La semántica (422) vive acá y no en el DTO
 * porque el DTO no ve el país guardado.
 */
describe("TenantProfileService.update — la provincia o el estado (F4-TAX-18)", () => {
  const meta = { ip: "1.2.3.4", userAgent: "jest" };

  it("país y región válidos van juntos al update", async () => {
    const { service, tx } = buildService();
    await service.update(ACTOR, { country: "CA", region: "BC" }, meta);
    expect(tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { country: "CA", region: "BC" } }),
    );
  });

  it("cambiar de país sin región la limpia: la región vieja no sobrevive a otro país", async () => {
    const { service, tx } = buildService();
    await service.update(ACTOR, { country: "MX" }, meta);
    expect(tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { country: "MX", region: null } }),
    );
  });

  it("una región para un país que no la usa, o ajena al país, rebota con 422", async () => {
    const { service } = buildService();
    await expect(service.update(ACTOR, { country: "MX", region: "BC" }, meta)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.update(ACTOR, { country: "CA", region: "TX" }, meta)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("la región sola se valida contra el país GUARDADO", async () => {
    const { service, tx } = buildService({ tenantRow: { id: "tenant-1", country: "CA" } });
    await expect(service.update(ACTOR, { region: "TX" }, meta)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await service.update(ACTOR, { region: "ON" }, meta);
    expect(tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { region: "ON" } }),
    );
  });

  it("el DTO acepta region en null y rechaza la cadena vacía", () => {
    expect(updateTenantSchema.safeParse({ region: null }).success).toBe(true);
    expect(updateTenantSchema.safeParse({ region: "" }).success).toBe(false);
    expect(updateTenantSchema.safeParse({ region: "BC" }).success).toBe(true);
  });
});

describe("TenantProfileService.completeOnboarding — la siembra fiscal (F4-TAX-19)", () => {
  const meta = { ip: "1.2.3.4", userAgent: "jest" };

  it("siembra el catálogo del país y la región DENTRO de la misma tx, y audita los códigos", async () => {
    const { service, tx, taxSettings, auditService } = buildService({
      tenantRow: { id: "tenant-1", country: "CA", region: "BC", onboarded: false },
    });
    taxSettings.sembrar.mockResolvedValue({ mode: "excluded", codes: ["GST_PST", "GST_ONLY"] });

    await service.completeOnboarding(ACTOR, meta);

    expect(taxSettings.sembrar).toHaveBeenCalledWith(tx, "tenant-1", "CA", "BC");
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "tenant.taxes.seeded",
        resourceType: "tenant",
        resourceId: "tenant-1",
        after: { country: "CA", region: "BC", mode: "excluded", codes: ["GST_PST", "GST_ONLY"] },
      }),
    );
    // La siembra va ANTES de marcar el onboarding: el bloque que vuelve ya
    // trae el modo sembrado.
    const ordenSiembra = taxSettings.sembrar.mock.invocationCallOrder[0] ?? 0;
    const ordenUpdate = tx.tenant.update.mock.invocationCallOrder[0] ?? 0;
    expect(ordenSiembra).toBeLessThan(ordenUpdate);
  });

  it("con el catálogo ya sembrado (segunda vez) no audita ninguna siembra", async () => {
    const { service, taxSettings, auditService } = buildService({
      tenantRow: { id: "tenant-1", country: "MX", region: null, onboarded: true },
    });
    taxSettings.sembrar.mockResolvedValue(null);

    await service.completeOnboarding(ACTOR, meta);

    const acciones = (auditService.record as jest.Mock).mock.calls.map(
      (c: unknown[]) => (c[1] as { action: string }).action,
    );
    expect(acciones).toEqual(["tenant.onboarded"]);
  });
});

/** F4-DISC — el PIN de descuentos se guarda hasheado y nunca en claro, ni en la bitácora. */
describe("TenantProfileService.update con el PIN de descuentos (F4-DISC)", () => {
  const META = { ip: "1.2.3.4", userAgent: "jest" };
  it("hashea el PIN, guarda la fecha y audita solo «[set]»", async () => {
    const { service, tx, auditService, hasher } = buildService();
    await service.update(
      ACTOR,
      updateTenantSchema.parse({ discountCode: "4321", discountMaxPercent: 20 }),
      META,
    );
    expect(hasher.hash).toHaveBeenCalledWith("4321");
    const data = tx.tenant.update.mock.calls[0][0].data;
    expect(data.discountCodeHash).toBe("hash(4321)");
    expect(data.discountCodeSetAt).toBeInstanceOf(Date);
    expect(data.discountMaxPercent).toBe(20);
    expect(data.discountCode).toBeUndefined();
    const entrada = jest.mocked(auditService.record).mock.calls[0]?.[1];
    expect(entrada?.after).toMatchObject({ discountCode: "[set]" });
    expect(JSON.stringify(entrada?.after)).not.toContain("4321");
  });

  it("null quita el PIN: hash y fecha en null, sin hashear nada", async () => {
    const { service, tx, hasher } = buildService();
    await service.update(ACTOR, updateTenantSchema.parse({ discountCode: null }), META);
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(tx.tenant.update.mock.calls[0][0].data).toMatchObject({
      discountCodeHash: null,
      discountCodeSetAt: null,
    });
  });
});
