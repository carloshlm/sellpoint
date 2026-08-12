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

  const tx = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(currentUser),
      update: jest.fn().mockResolvedValue(updatedUser),
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
