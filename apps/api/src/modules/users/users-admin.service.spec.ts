import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ClockPort } from "../../infrastructure/clock/clock.port";
import type { PermEpochService } from "../../infrastructure/redis/perm-epoch.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
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
    return Promise.resolve([{ id: "role-1", name: "Manager" }]);
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

  const service = new UsersAdminService(prisma as never, auditService, permEpochService, clock);
  return { service, tx, auditService, permEpochService };
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
    tx.role.findMany.mockResolvedValueOnce([{ id: "role-2", name: "Viewer" }]);

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
    // tenant. La segunda llamada (guard W2, where sin `id`) usa el default
    // del mock: NINGÚN rol admin queda con usuario activo tras el swap.
    tx.role.findMany.mockResolvedValueOnce([{ id: "role-viewer", name: "Viewer" }]);
    tx.role.findMany.mockResolvedValueOnce([]);

    await expect(
      service.update(ACTOR, "user-2", { roleIds: ["role-viewer"] }, {}),
    ).rejects.toMatchObject({ response: { message: "roles.last_admin_protected" } });

    expect(permEpochService.bumpUserEpoch).not.toHaveBeenCalled();
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
