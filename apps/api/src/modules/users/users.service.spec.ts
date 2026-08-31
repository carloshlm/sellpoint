import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { UsersService } from "./users.service";

const CURRENT_USER: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: [],
  locale: "es",
};

function buildService(overrides?: {
  currentUser?: Record<string, unknown> | null;
  updatedUser?: Record<string, unknown>;
  tenantRow?: Record<string, unknown>;
}) {
  const currentUser = overrides?.currentUser ?? {
    id: "user-1",
    email: "owner@example.com",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    status: "active",
    locale: "es",
  };

  const updatedUser =
    overrides?.updatedUser ?? ({ ...currentUser, locale: "en" } as Record<string, unknown>);

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
    monthlySalesGoal: null,
  };

  const tx = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(currentUser),
      update: jest.fn().mockResolvedValue(updatedUser),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(tenantRow),
    },
  };

  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const entitlements = {
    resolve: jest.fn().mockResolvedValue({
      planCode: "plus",
      planName: "Plus",
      status: "trialing",
      billingCycle: null,
      writeAccess: true,
      stockControl: true,
      dailySalesLimit: null,
      maxUsers: 20,
      maxWarehouses: 10,
      features: {
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
      },
      trialEndsAt: null,
      dueAt: null,
      graceEndsAt: null,
    }),
  };

  const service = new UsersService(prisma as never, auditService, entitlements as never);
  return { service, prisma, auditService, tx };
}

describe("UsersService.getMe (GET /me, F1-WEB-AUTH bootstrap)", () => {
  it("devuelve el shape que consume el front: datos frescos de DB + permissions del JWT", async () => {
    const { service, prisma, tx } = buildService();
    const jwtUser: AuthUser = { ...CURRENT_USER, permissions: ["products:read"] };

    const result = await service.getMe(jwtUser);

    expect(prisma.withTenantContext).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(tx.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastNamePaternal: true,
        lastNameMaternal: true,
        locale: true,
        defaultWarehouseId: true,
        isPlatformAdmin: true,
      },
    });
    expect(result).toEqual({
      id: "user-1",
      email: "owner@example.com",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      locale: "es",
      permissions: ["products:read"],
      tenant: {
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
        monthlySalesGoal: null,
      },
      // F7-WEB-01 (A1): MISMO shape que el otro emisor — ver
      // subscription.types.spec.ts para la matemática de daysLeft.
      subscription: expect.objectContaining({
        planCode: "plus",
        status: "trialing",
        daysLeft: null,
        writeAccess: true,
      }),
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("el locale sale de la DB, no del claim del JWT (PATCH /me pudo cambiarlo con el token ya emitido)", async () => {
    const { service } = buildService({
      currentUser: {
        id: "user-1",
        email: "owner@example.com",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        lastNameMaternal: null,
        status: "active",
        locale: "en",
      },
    });

    // El JWT dice "es" (claim viejo) pero la DB ya dice "en".
    const result = await service.getMe(CURRENT_USER);

    expect(result).toMatchObject({ locale: "en" });
  });
});

/**
 * "Tus datos" editable (Carlos, 2026-08-26): PATCH /users/me crece a nombre y
 * apellidos. El email NO: es la identidad de acceso (login + verificación) y
 * cambiarlo exige su propio flujo con re-verificación.
 */
describe("UsersService.updateMe (perfil propio, 2026-08-26)", () => {
  it("actualiza SOLO los campos presentes en el dto", async () => {
    const { service, tx } = buildService();

    await service.updateMe(CURRENT_USER, { firstName: "Ana María", lastNameMaternal: "Luna" }, {});

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: CURRENT_USER.userId },
      data: { firstName: "Ana María", lastNameMaternal: "Luna" },
    });
  });

  it("lastNameMaternal null lo BORRA (es opcional desde el registro)", async () => {
    const { service, tx } = buildService();

    await service.updateMe(CURRENT_USER, { lastNameMaternal: null }, {});

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: CURRENT_USER.userId },
      data: { lastNameMaternal: null },
    });
  });

  it("audita user.profile.updated con before/after SOLO de los campos tocados", async () => {
    const { service, auditService } = buildService();

    await service.updateMe(CURRENT_USER, { firstName: "Ana María" }, { ip: "1.2.3.4" });

    expect(auditService.record).toHaveBeenCalledWith(expect.anything(), {
      tenantId: CURRENT_USER.tenantId,
      userId: CURRENT_USER.userId,
      action: "user.profile.updated",
      resourceType: "user",
      resourceId: CURRENT_USER.userId,
      before: { firstName: "Ana" },
      after: { firstName: "Ana María" },
      ip: "1.2.3.4",
      userAgent: undefined,
    });
  });

  /** El contrato viejo no se rompe: un PATCH de SOLO locale audita como siempre. */
  it("con SOLO locale el action sigue siendo user.locale.updated", async () => {
    const { service, auditService } = buildService();

    await service.updateMe(CURRENT_USER, { locale: "en" }, {});

    expect(auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "user.locale.updated",
        before: { locale: "es" },
        after: { locale: "en" },
      }),
    );
  });
});

describe("UsersService.updateLocale (F1-LOCALE-05)", () => {
  it("actualiza users.locale dentro del contexto de tenant del user autenticado", async () => {
    const { service, prisma, tx } = buildService();

    await service.updateLocale(CURRENT_USER, "en", {});

    expect(prisma.withTenantContext).toHaveBeenCalledWith(
      CURRENT_USER.tenantId,
      expect.any(Function),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: CURRENT_USER.userId },
      data: { locale: "en" },
    });
  });

  it("devuelve el user actualizado sin passwordHash", async () => {
    const { service } = buildService();

    const result = await service.updateLocale(CURRENT_USER, "en", {});

    expect(result).toEqual({
      id: "user-1",
      email: "owner@example.com",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      status: "active",
      locale: "en",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("registra audit log con before/after de locale", async () => {
    const { service, auditService } = buildService();

    await service.updateLocale(CURRENT_USER, "en", { ip: "1.2.3.4", userAgent: "jest" });

    expect(auditService.record).toHaveBeenCalledWith(expect.anything(), {
      tenantId: CURRENT_USER.tenantId,
      userId: CURRENT_USER.userId,
      action: "user.locale.updated",
      resourceType: "user",
      resourceId: CURRENT_USER.userId,
      before: { locale: "es" },
      after: { locale: "en" },
      ip: "1.2.3.4",
      userAgent: "jest",
    });
  });

  it("no-op cuando el nuevo locale es igual al actual: igual persiste y audita (idempotente, sin lógica especial)", async () => {
    const { service, tx } = buildService({
      currentUser: {
        id: "user-1",
        email: "owner@example.com",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        lastNameMaternal: null,
        status: "active",
        locale: "es",
      },
      updatedUser: {
        id: "user-1",
        email: "owner@example.com",
        firstName: "Ana",
        lastNamePaternal: "Pérez",
        lastNameMaternal: null,
        status: "active",
        locale: "es",
      },
    });

    await service.updateLocale(CURRENT_USER, "es", {});

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: CURRENT_USER.userId },
      data: { locale: "es" },
    });
  });
});
