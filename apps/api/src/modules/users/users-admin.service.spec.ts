import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ClockPort } from "../../infrastructure/clock/clock.port";
import type { PermEpochService } from "../../infrastructure/redis/perm-epoch.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UserInvitationService } from "./user-invitation.service";
import { UsersAdminService } from "./users-admin.service";

const ACTOR: AuthUser = {
  userId: "actor-1",
  tenantId: "tenant-1",
  permissions: ["users:manage", "users:read"],
  locale: "es",
};

const NOW = new Date("2026-08-12T12:00:00Z");

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.0.0",
  });
}

// El mock de `role.findMany` sirve DOS consultas distintas con la misma tx:
// `resolveRoles()` (where.id.in — valida roleIds) y `assertTenantRetainsAdmin`
// del guard W2 (where SIN `id`, solo tenantId). Se distinguen por shape del
// `where`, igual que el mock de `permission.findMany` en roles.service.spec.
function defaultRoleFindMany(args: { where?: Record<string, unknown> }) {
  if (args?.where && "id" in args.where) {
    // permissions acotado a lo que ACTOR YA posee (users:manage) — el
    // default no debe disparar el guard W1b por accidente en los tests que
    // no lo ejercitan a propósito.
    return Promise.resolve([
      { id: "role-1", name: "Manager", permissions: [{ permission: { code: "users:manage" } }] },
    ]);
  }
  // Default W2: el tenant SIGUE teniendo un admin activo tras la mutación
  // — los tests dedicados a W2 pisan este mock para simular el lockout.
  return Promise.resolve([
    {
      permissions: [
        { permission: { code: "roles:manage" } },
        { permission: { code: "users:manage" } },
      ],
      users: [{ user: { status: "active" } }],
    },
  ]);
}

function buildService() {
  const role = {
    findMany: jest.fn(defaultRoleFindMany),
  };

  const user = {
    create: jest.fn().mockResolvedValue({
      id: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "invited",
      locale: "es",
    }),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };

  const userRole = {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  const tx = { role, user, userRole };

  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const permEpochService = {
    bumpUserEpoch: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermEpochService;
  const clock = { now: () => NOW } as unknown as ClockPort;
  const userInvitationService = {
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as UserInvitationService;

  const service = new UsersAdminService(
    prisma as never,
    auditService,
    permEpochService,
    clock,
    userInvitationService,
  );
  return { service, tx, auditService, permEpochService, userInvitationService };
}

describe("UsersAdminService.create (F1-RBAC-03)", () => {
  it("crea el user invited y le asigna los roles pedidos", async () => {
    const { service, tx } = buildService();

    const result = await service.create(
      ACTOR,
      {
        email: "nuevo@example.com",
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: ["role-1"],
      },
      {},
    );

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        email: "nuevo@example.com",
        status: "invited",
        locale: "es",
      }),
    });
    expect(tx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-2", roleId: "role-1" }],
    });
    expect(result).toEqual({
      id: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "invited",
      locale: "es",
      defaultWarehouseId: null,
      roles: [{ id: "role-1", name: "Manager" }],
    });
  });

  it("roleId de otro tenant (o inexistente) -> 400 users.invalid_role_ids, no crea nada", async () => {
    const { service, tx } = buildService();
    tx.role.findMany.mockResolvedValueOnce([]);

    await expect(
      service.create(
        ACTOR,
        { email: "x@example.com", firstName: "X", lastNamePaternal: "Y", roleIds: ["ajeno"] },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("email ya existente (unique GLOBAL, f1-auth D1) -> 409 users.email_taken", async () => {
    const { service, tx } = buildService();
    tx.user.create.mockRejectedValueOnce(uniqueViolation());

    await expect(
      service.create(
        ACTOR,
        { email: "dup@example.com", firstName: "X", lastNamePaternal: "Y", roleIds: ["role-1"] },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("UsersAdminService.create — gap S1: invitación", () => {
  it("tras crear el user invited manda la invitación con su email/nombre/locale", async () => {
    const { service, userInvitationService } = buildService();

    await service.create(
      ACTOR,
      {
        email: "nuevo@example.com",
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: ["role-1"],
      },
      {},
    );

    expect(userInvitationService.send).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      locale: "es",
    });
  });

  it("la invitación sale DESPUÉS del commit — nunca dentro de la transacción del alta", async () => {
    const { service, tx, userInvitationService } = buildService();

    await service.create(
      ACTOR,
      {
        email: "nuevo@example.com",
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        roleIds: ["role-1"],
      },
      {},
    );

    const createOrder = tx.user.create.mock.invocationCallOrder[0] as number;
    const sendOrder = jest.mocked(userInvitationService.send).mock.invocationCallOrder[0] as number;
    expect(createOrder).toBeLessThan(sendOrder);
  });

  it("si el alta falla (email duplicado) NO se emite ninguna invitación", async () => {
    const { service, tx, userInvitationService } = buildService();
    tx.user.create.mockRejectedValueOnce(uniqueViolation());

    await expect(
      service.create(
        ACTOR,
        { email: "dup@example.com", firstName: "X", lastNamePaternal: "Y", roleIds: ["role-1"] },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(userInvitationService.send).not.toHaveBeenCalled();
  });
});

describe("UsersAdminService.resendInvitation — gap S1", () => {
  function invitedUser(tx: ReturnType<typeof buildService>["tx"], status = "invited") {
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status,
      locale: "en",
      roles: [{ role: { id: "role-1", name: "Manager" } }],
    });
  }

  it("re-emite la invitación de un usuario invited y la audita", async () => {
    const { service, tx, userInvitationService, auditService } = buildService();
    invitedUser(tx);

    const result = await service.resendInvitation(ACTOR, "user-2", {});

    expect(userInvitationService.send).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      locale: "en",
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "user.invitation_resent", resourceId: "user-2" }),
    );
    expect(result).toMatchObject({ id: "user-2", status: "invited" });
  });

  it("usuario ya activo -> 409 users.not_invited, sin emitir token nuevo", async () => {
    const { service, tx, userInvitationService } = buildService();
    invitedUser(tx, "active");

    await expect(service.resendInvitation(ACTOR, "user-2", {})).rejects.toMatchObject({
      response: { message: "users.not_invited" },
    });
    expect(userInvitationService.send).not.toHaveBeenCalled();
  });

  it("usuario inexistente (o de otro tenant) -> 404 users.not_found", async () => {
    const { service, tx, userInvitationService } = buildService();
    tx.user.findFirst.mockResolvedValue(null);

    await expect(service.resendInvitation(ACTOR, "ghost", {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(userInvitationService.send).not.toHaveBeenCalled();
  });
});

describe("UsersAdminService.create — W1b hardening (verify #274 pasada 2): escalada por asignación de roles", () => {
  it("ACTOR (SOLO users:manage, SIN roles:manage) no puede crear un user con un rol TenantAdmin -> 403, no crea nada", async () => {
    const { service, tx } = buildService();
    tx.role.findMany.mockResolvedValueOnce([
      {
        id: "role-admin",
        name: "TenantAdmin",
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "users:manage" } },
        ],
      },
    ]);

    await expect(
      service.create(
        ACTOR,
        { email: "x@example.com", firstName: "X", lastNamePaternal: "Y", roleIds: ["role-admin"] },
        {},
      ),
    ).rejects.toMatchObject({
      response: { message: "users.cannot_assign_unheld_role_permission" },
    });
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("ACTOR SÍ puede crear un user con un rol cuyos permisos posee por completo", async () => {
    const { service, tx } = buildService();
    tx.role.findMany.mockResolvedValueOnce([
      { id: "role-1", name: "Manager", permissions: [{ permission: { code: "users:manage" } }] },
    ]);

    await expect(
      service.create(
        ACTOR,
        { email: "y@example.com", firstName: "X", lastNamePaternal: "Y", roleIds: ["role-1"] },
        {},
      ),
    ).resolves.toBeDefined();
    expect(tx.user.create).toHaveBeenCalled();
  });
});

describe("UsersAdminService.update (F1-RBAC-03)", () => {
  function withExistingUser(tx: ReturnType<typeof buildService>["tx"]) {
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      status: "active",
      roles: [{ roleId: "role-1" }],
    });
    tx.user.findFirstOrThrow.mockResolvedValue({
      id: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "en",
      roles: [{ role: { id: "role-2", name: "Viewer" } }],
    });
  }

  it("cambiar SOLO datos de perfil no toca roles ni bumpea epoch", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingUser(tx);

    await service.update(ACTOR, "user-2", { locale: "en" }, {});

    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
  });

  it("reemplazar roleIds BUMPEA perm-epoch:{userId} tras el commit (permisos del user cambian)", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingUser(tx);
    tx.role.findMany.mockResolvedValueOnce([
      { id: "role-2", name: "Viewer", permissions: [{ permission: { code: "users:read" } }] },
    ]);

    await service.update(ACTOR, "user-2", { roleIds: ["role-2"] }, {});

    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2" } });
    expect(tx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-2", roleId: "role-2" }],
    });
    expect(permEpochService.bumpUserEpoch).toHaveBeenCalledWith("user-2", NOW);
  });

  it("user inexistente -> 404 users.not_found", async () => {
    const { service, tx } = buildService();
    tx.user.findFirst.mockResolvedValue(null);

    await expect(service.update(ACTOR, "ghost", { locale: "en" }, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("UsersAdminService.update — W2 hardening (verify #274): protege al último admin del tenant", () => {
  it("reasignar roleIds del ÚNICO admin activo a un rol sin admin -> 409 roles.last_admin_protected", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      status: "active",
      roles: [{ roleId: "role-1" }],
    });
    // resolveRoles(): el roleId nuevo pedido (Viewer) SÍ existe en el
    // tenant y sus permisos son un subconjunto de ACTOR (no dispara W1b).
    // La segunda llamada (guard W2, where sin `id`) usa el default del
    // mock: NINGÚN rol admin queda con usuario activo tras el swap.
    tx.role.findMany.mockResolvedValueOnce([
      { id: "role-viewer", name: "Viewer", permissions: [{ permission: { code: "users:read" } }] },
    ]);
    tx.role.findMany.mockResolvedValueOnce([]);

    await expect(
      service.update(ACTOR, "user-2", { roleIds: ["role-viewer"] }, {}),
    ).rejects.toMatchObject({ response: { message: "roles.last_admin_protected" } });

    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
  });
});

describe("UsersAdminService.update — W1b hardening (verify #274 pasada 2): escalada por asignación de roles", () => {
  it("repro EXACTO del verify: ACTOR con users:manage (SIN roles:manage) no puede auto-asignarse un rol TenantAdmin -> 403, sin mutar", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: ACTOR.userId,
      status: "active",
      roles: [{ roleId: "role-viewer" }],
    });
    tx.role.findMany.mockResolvedValueOnce([
      {
        id: "role-admin",
        name: "TenantAdmin",
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "users:manage" } },
        ],
      },
    ]);

    await expect(
      service.update(ACTOR, ACTOR.userId, { roleIds: ["role-admin"] }, {}),
    ).rejects.toMatchObject({
      response: { message: "users.cannot_assign_unheld_role_permission" },
    });

    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
    expect(tx.userRole.createMany).not.toHaveBeenCalled();
    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
  });

  it("quitarle a alguien un rol NO es escalada -> permitido aunque el actor no posea esos permisos", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      status: "active",
      roles: [{ roleId: "role-admin" }, { roleId: "role-1" }],
    });
    tx.user.findFirstOrThrow.mockResolvedValue({
      id: "user-2",
      email: "nuevo@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "en",
      roles: [{ role: { id: "role-1", name: "Manager" } }],
    });
    tx.role.findMany.mockResolvedValueOnce([
      { id: "role-1", name: "Manager", permissions: [{ permission: { code: "users:manage" } }] },
    ]);

    // ACTOR no tiene roles:manage, pero acá solo se SACA role-admin (que lo
    // otorgaba) -- el set nuevo (["role-1"]) no agrega nada -> sin escalada.
    await expect(
      service.update(ACTOR, "user-2", { roleIds: ["role-1"] }, {}),
    ).resolves.toBeDefined();
    expect(permEpochService.bumpUserEpoch).toHaveBeenCalled();
  });
});

describe("UsersAdminService.suspend/reactivate (F1-RBAC-03)", () => {
  it("suspend: setea status suspended y BUMPEA perm-epoch:{userId} (mata sesiones vivas)", async () => {
    const { service, tx, permEpochService, auditService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      roles: [],
    });
    tx.user.update.mockResolvedValue({
      id: "user-2",
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "suspended",
      locale: "es",
    });

    const result = await service.suspend(ACTOR, "user-2", {});

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { status: "suspended" },
    });
    expect(permEpochService.bumpUserEpoch).toHaveBeenCalledWith("user-2", NOW);
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "user.suspended" }),
    );
    expect(result.status).toBe("suspended");
  });

  it("un usuario no puede suspenderse a sí mismo -> 409 users.cannot_suspend_self", async () => {
    const { service, tx } = buildService();

    await expect(service.suspend(ACTOR, ACTOR.userId, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.user.findFirst).not.toHaveBeenCalled();
  });

  it("reactivate: solo permite la transición desde suspended", async () => {
    const { service, tx } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      roles: [],
    });

    await expect(service.reactivate(ACTOR, "user-2", {})).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("reactivate: desde suspended -> active, sin bump de epoch", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "suspended",
      locale: "es",
      roles: [],
    });
    tx.user.update.mockResolvedValue({
      id: "user-2",
      email: "x@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
    });

    const result = await service.reactivate(ACTOR, "user-2", {});

    expect(result.status).toBe("active");
    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
  });
});

describe("UsersAdminService.suspend — W2 hardening (verify #274): protege al último admin del tenant", () => {
  it("suspender al ÚNICO admin activo del tenant -> 409 roles.last_admin_protected, no muta", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "admin@example.com",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      roles: [{ role: { id: "role-1", name: "TenantAdmin" } }],
    });
    // Post-mutación (simulada, actor DISTINTO al target): sin este admin
    // activo, el tenant se queda sin nadie que administre roles/usuarios.
    tx.role.findMany.mockResolvedValue([]);

    await expect(service.suspend(ACTOR, "user-2", {})).rejects.toMatchObject({
      response: { message: "roles.last_admin_protected" },
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { status: "suspended" },
    });
    // El guard corre DESPUÉS del update, DENTRO de la misma tx — Prisma
    // revierte la tx completa al tirar (mismo mecanismo que cualquier otra
    // excepción lanzada dentro de `withTenantContext`).
    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
  });

  it("suspender a un admin CUANDO hay otro admin activo -> se permite", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.user.findFirst.mockResolvedValue({
      id: "user-2",
      email: "admin2@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      roles: [{ role: { id: "role-1", name: "TenantAdmin" } }],
    });
    tx.user.update.mockResolvedValue({
      id: "user-2",
      email: "admin2@example.com",
      firstName: "Bruno",
      lastNamePaternal: "Díaz",
      lastNameMaternal: null,
      status: "suspended",
      locale: "es",
    });
    tx.role.findMany.mockResolvedValue([
      {
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "users:manage" } },
        ],
        users: [{ user: { status: "active" } }],
      },
    ]);

    const result = await service.suspend(ACTOR, "user-2", {});

    expect(result.status).toBe("suspended");
    expect(permEpochService.bumpUserEpoch).toHaveBeenCalledWith("user-2", NOW);
  });
});

describe("UsersAdminService.list/findOne (F1-RBAC-03)", () => {
  it("list devuelve los users del tenant con sus roles", async () => {
    const { service, tx } = buildService();
    tx.user.findMany.mockResolvedValue([
      {
        id: "user-2",
        email: "x@example.com",
        firstName: "Bruno",
        lastNamePaternal: "Díaz",
        lastNameMaternal: null,
        status: "active",
        locale: "es",
        roles: [{ role: { id: "role-1", name: "Manager" } }],
      },
    ]);

    const result = await service.list(ACTOR);

    expect(result).toEqual([
      expect.objectContaining({ id: "user-2", roles: [{ id: "role-1", name: "Manager" }] }),
    ]);
  });

  it("findOne: user inexistente -> 404", async () => {
    const { service, tx } = buildService();
    tx.user.findFirst.mockResolvedValue(null);

    await expect(service.findOne(ACTOR, "ghost")).rejects.toBeInstanceOf(NotFoundException);
  });
});
