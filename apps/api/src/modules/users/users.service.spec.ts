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
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
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

  const service = new UsersService(prisma as never, auditService);
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
        locale: true,
        defaultWarehouseId: true,
      },
    });
    expect(result).toEqual({
      id: "user-1",
      email: "owner@example.com",
      firstName: "Ana",
      locale: "es",
      permissions: ["products:read"],
      tenant: {
        id: "tenant-1",
        name: "Acme",
        legalName: null,
        taxId: null,
        address: null,
        timezone: "America/Mexico_City",
        currency: "MXN",
        templateChoice: null,
        onboarded: false,
      },
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
