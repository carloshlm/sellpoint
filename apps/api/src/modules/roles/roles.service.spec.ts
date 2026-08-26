import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ClockPort } from "../../infrastructure/clock/clock.port";
import type { PermEpochService } from "../../infrastructure/redis/perm-epoch.service";
import type { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/types/auth-user";
import { RolesService } from "./roles.service";

// Admin-like: sostiene los 4 codes del catálogo mínimo. Los tests de
// mecánica (create/update/remove/list) usan este actor a propósito —
// cualquier actor que YA posee todo lo que otorga nunca puede activar el
// guard W1 (escalada). Los tests DEDICADOS a W1 usan LIMITED_USER (abajo).
const CURRENT_USER: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: ["roles:read", "roles:manage", "users:read", "users:manage"],
  locale: "es",
};

// Solo roles:manage — el actor "confused deputy" de W1 (verify #274): puede
// gestionar roles pero NO tiene users:manage ni users:read.
const LIMITED_USER: AuthUser = {
  userId: "user-2",
  tenantId: "tenant-1",
  permissions: ["roles:manage"],
  locale: "es",
};

const NOW = new Date("2026-08-12T12:00:00Z");

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.0.0",
  });
}

const CATALOG = [
  { id: "perm-users-read", code: "users:read" },
  { id: "perm-users-manage", code: "users:manage" },
  { id: "perm-roles-read", code: "roles:read" },
  { id: "perm-roles-manage", code: "roles:manage" },
];

function buildService() {
  const permission = {
    // El catálogo global (permissions) NO tiene tenant_id ni RLS — el mock
    // filtra por `where.code.in`, igual que haría Postgres.
    findMany: jest.fn((args: { where: { code: { in: string[] } } }) =>
      Promise.resolve(CATALOG.filter((p) => args.where.code.in.includes(p.code))),
    ),
  };

  const role = {
    create: jest.fn().mockResolvedValue({ id: "role-1", name: "Custom" }),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const rolePermission = {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  const userRole = { count: jest.fn().mockResolvedValue(0) };

  const tx = { permission, role, rolePermission, userRole };

  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const permEpochService = {
    bumpTenantEpoch: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermEpochService;
  const clock = { now: () => NOW } as unknown as ClockPort;

  const service = new RolesService(prisma as never, auditService, permEpochService, clock);
  return { service, tx, prisma, auditService, permEpochService };
}

describe("RolesService.create (F1-RBAC-04)", () => {
  it("crea el rol y sus role_permissions resolviendo codes -> ids del catálogo", async () => {
    const { service, tx } = buildService();

    const result = await service.create(
      CURRENT_USER,
      { name: "Custom", permissionCodes: ["users:read", "roles:read"] },
      {},
    );

    expect(tx.role.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-1", name: "Custom" },
    });
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { roleId: "role-1", permissionId: "perm-users-read" },
        { roleId: "role-1", permissionId: "perm-roles-read" },
      ]),
    });
    expect(result).toEqual({
      id: "role-1",
      name: "Custom",
      permissionCodes: expect.arrayContaining(["users:read", "roles:read"]),
      userCount: 0,
    });
  });

  it("code de permiso inexistente -> 400 roles.unknown_permission_code, no crea nada", async () => {
    const { service, tx } = buildService();

    await expect(
      service.create(CURRENT_USER, { name: "Custom", permissionCodes: ["ghost:code"] }, {}),
    ).rejects.toMatchObject({ response: { message: "roles.unknown_permission_code" } });

    expect(tx.role.create).not.toHaveBeenCalled();
  });

  it("nombre duplicado en el tenant -> 409 roles.name_taken", async () => {
    const { service, tx } = buildService();
    tx.role.create.mockRejectedValueOnce(uniqueViolation());

    await expect(
      service.create(CURRENT_USER, { name: "Admin", permissionCodes: [] }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("permissionCodes vacío no llama a createMany", async () => {
    const { service, tx } = buildService();

    await service.create(CURRENT_USER, { name: "Vacío", permissionCodes: [] }, {});

    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });
});

describe("RolesService — W1 hardening (verify #274): no se puede otorgar un permiso que el actor no posee", () => {
  it("POST /roles: LIMITED_USER (solo roles:manage) crea un rol con users:manage -> 403, no crea nada", async () => {
    const { service, tx } = buildService();

    await expect(
      service.create(
        LIMITED_USER,
        { name: "Auto-escalado", permissionCodes: ["users:manage"] },
        {},
      ),
    ).rejects.toMatchObject({ response: { message: "roles.cannot_grant_unheld_permission" } });

    expect(tx.role.create).not.toHaveBeenCalled();
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it("POST /roles: LIMITED_USER puede otorgar SOLO lo que ya posee (roles:manage) -> 201", async () => {
    const { service, tx } = buildService();

    await service.create(
      LIMITED_USER,
      { name: "Sub-admin", permissionCodes: ["roles:manage"] },
      {},
    );

    expect(tx.role.create).toHaveBeenCalled();
  });

  it("PATCH /roles/:id: LIMITED_USER agrega users:manage a un rol -> 403, no muta permisos", async () => {
    const { service, tx, permEpochService } = buildService();
    tx.role.findFirst.mockResolvedValue({
      id: "role-1",
      name: "Custom",
      permissions: [{ permission: { code: "roles:read" } }],
    });

    await expect(
      service.update(
        LIMITED_USER,
        "role-1",
        { permissionCodes: ["roles:read", "users:manage"] },
        {},
      ),
    ).rejects.toMatchObject({ response: { message: "roles.cannot_grant_unheld_permission" } });

    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
    expect(permEpochService.bumpTenantEpoch).not.toHaveBeenCalled();
  });

  it("PATCH /roles/:id: LIMITED_USER puede QUITAR permisos que no posee (bajar privilegios ajenos no es escalada)", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue({
      id: "role-1",
      name: "Custom",
      permissions: [
        { permission: { code: "roles:manage" } },
        { permission: { code: "users:manage" } },
        { permission: { code: "users:read" } },
      ],
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

    // Deja el rol SOLO con roles:manage — el delta es puramente una quita
    // (users:manage y users:read desaparecen), ningún code nuevo se agrega.
    await service.update(LIMITED_USER, "role-1", { permissionCodes: ["roles:manage"] }, {});

    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: "role-1" } });
  });

  it("PATCH /roles/:id: rol inexistente (RLS/cross-tenant) sigue siendo 404 antes que la validación de escalada", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue(null);

    await expect(
      service.update(LIMITED_USER, "role-ajeno", { permissionCodes: ["users:manage"] }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("RolesService.update (F1-RBAC-04 — criterio clave del batch)", () => {
  function withExistingRole(tx: ReturnType<typeof buildService>["tx"]) {
    tx.role.findFirst.mockResolvedValue({
      id: "role-1",
      name: "Manager",
      permissions: [{ permission: { code: "users:read" } }, { permission: { code: "roles:read" } }],
    });
    tx.role.update.mockResolvedValue({ id: "role-1", name: "Manager" });
    tx.userRole.count.mockResolvedValue(3);
    // Default W2: el tenant SIGUE teniendo un admin válido después de la
    // mutación (otro rol, con usuario activo) — los tests dedicados a W2
    // pisan este mock para simular el lockout.
    tx.role.findMany.mockResolvedValue([
      {
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "users:manage" } },
        ],
        users: [{ user: { status: "active" } }],
      },
    ]);
  }

  it("cambiar SOLO el nombre no toca permisos ni bumpea el epoch", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingRole(tx);

    await service.update(CURRENT_USER, "role-1", { name: "Managers" }, {});

    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(permEpochService.bumpTenantEpoch).not.toHaveBeenCalled();
  });

  it("cambiar permissionCodes reemplaza el set completo y BUMPEA perm-epoch:{tenantId} tras el commit", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingRole(tx);

    const result = await service.update(
      CURRENT_USER,
      "role-1",
      { permissionCodes: ["users:manage", "roles:manage"] },
      {},
    );

    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: "role-1" } });
    expect(tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { roleId: "role-1", permissionId: "perm-users-manage" },
        { roleId: "role-1", permissionId: "perm-roles-manage" },
      ]),
    });
    // La pieza no negociable del batch: swap de permisos de un rol ->
    // TODOS los usuarios de ese rol ven el cambio sin esperar 15 min.
    expect(permEpochService.bumpTenantEpoch).toHaveBeenCalledWith("tenant-1", NOW);
    expect(result.userCount).toBe(3);
  });

  it("permissionCodes idéntico al set actual (mismo contenido, distinto orden) NO bumpea", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingRole(tx);

    await service.update(
      CURRENT_USER,
      "role-1",
      { permissionCodes: ["roles:read", "users:read"] },
      {},
    );

    expect(permEpochService.bumpTenantEpoch).not.toHaveBeenCalled();
  });

  it("rol inexistente (o de otro tenant, filtrado por RLS) -> 404 roles.not_found", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue(null);

    await expect(
      service.update(CURRENT_USER, "role-ajeno", { name: "x" }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("code de permiso inexistente en el PATCH -> 400, no muta nada", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingRole(tx);

    await expect(
      service.update(CURRENT_USER, "role-1", { permissionCodes: ["ghost:code"] }, {}),
    ).rejects.toMatchObject({ response: { message: "roles.unknown_permission_code" } });

    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(permEpochService.bumpTenantEpoch).not.toHaveBeenCalled();
  });
});

describe("RolesService.update — W2 hardening (verify #274): protege al último admin del tenant", () => {
  function withExistingAdminRole(tx: ReturnType<typeof buildService>["tx"]) {
    tx.role.findFirst.mockResolvedValue({
      id: "role-1",
      name: "Admin",
      permissions: [
        { permission: { code: "roles:manage" } },
        { permission: { code: "users:manage" } },
        { permission: { code: "roles:read" } },
        { permission: { code: "users:read" } },
      ],
    });
    tx.role.update.mockResolvedValue({ id: "role-1", name: "Admin" });
    tx.userRole.count.mockResolvedValue(1);
  }

  it("quitarle users:manage al ÚNICO rol admin -> 409 roles.last_admin_protected, no muta", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingAdminRole(tx);
    // Post-mutación (simulada): el propio rol pierde users:manage y NINGÚN
    // otro rol del tenant cubre la invariante -> lockout.
    tx.role.findMany.mockResolvedValue([
      {
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "roles:read" } },
          { permission: { code: "users:read" } },
        ],
        users: [{ user: { status: "active" } }],
      },
    ]);

    await expect(
      service.update(
        CURRENT_USER,
        "role-1",
        { permissionCodes: ["roles:manage", "roles:read", "users:read"] },
        {},
      ),
    ).rejects.toMatchObject({ response: { message: "roles.last_admin_protected" } });

    expect(permEpochService.bumpTenantEpoch).not.toHaveBeenCalled();
  });

  it("HAY DOS roles admin: sacarle permisos a UNO (dejando al otro intacto) SÍ se permite", async () => {
    const { service, tx, permEpochService } = buildService();
    withExistingAdminRole(tx);
    // El OTRO rol admin del tenant (con su propio usuario activo) sigue
    // cubriendo la invariante después de esta mutación.
    tx.role.findMany.mockResolvedValue([
      {
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "roles:read" } },
          { permission: { code: "users:read" } },
        ],
        users: [{ user: { status: "active" } }],
      },
      {
        permissions: [
          { permission: { code: "roles:manage" } },
          { permission: { code: "users:manage" } },
        ],
        users: [{ user: { status: "active" } }],
      },
    ]);

    const result = await service.update(
      CURRENT_USER,
      "role-1",
      { permissionCodes: ["roles:manage", "roles:read", "users:read"] },
      {},
    );

    expect(result.permissionCodes).not.toContain("users:manage");
    expect(permEpochService.bumpTenantEpoch).toHaveBeenCalled();
  });
});

describe("RolesService.remove (F1-RBAC-04)", () => {
  it("rol CON usuarios asignados -> 409 roles.role_in_use, no borra", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue({ id: "role-1", name: "Manager" });
    tx.userRole.count.mockResolvedValue(2);

    await expect(service.remove(CURRENT_USER, "role-1", {})).rejects.toMatchObject({
      response: { message: "roles.role_in_use" },
    });
    expect(tx.role.delete).not.toHaveBeenCalled();
  });

  it("rol sin usuarios -> borra y audita", async () => {
    const { service, tx, auditService } = buildService();
    tx.role.findFirst.mockResolvedValue({ id: "role-1", name: "Custom" });
    tx.userRole.count.mockResolvedValue(0);

    await service.remove(CURRENT_USER, "role-1", { ip: "1.2.3.4" });

    expect(tx.role.delete).toHaveBeenCalledWith({ where: { id: "role-1" } });
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "role.deleted", resourceId: "role-1" }),
    );
  });

  it("rol inexistente -> 404 roles.not_found", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue(null);

    await expect(service.remove(CURRENT_USER, "ghost", {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // W2 (verify #274) vector "DELETE del último rol admin": role_in_use YA
  // cubre este vector sin código nuevo — DELETE solo llega a borrar cuando
  // userCount===0 (ACTIVO o no), y un rol admin sin ningún usuario asignado
  // nunca estaba cubriendo la invariante para empezar (0 usuarios activos
  // en ese rol). Documentado acá para que quede explícito, no implícito.
  it("W2: el único rol Admin CON su usuario -> 409 role_in_use, nunca llega a borrarse", async () => {
    const { service, tx } = buildService();
    tx.role.findFirst.mockResolvedValue({ id: "role-1", name: "Admin" });
    tx.userRole.count.mockResolvedValue(1);

    await expect(service.remove(CURRENT_USER, "role-1", {})).rejects.toMatchObject({
      response: { message: "roles.role_in_use" },
    });
    expect(tx.role.delete).not.toHaveBeenCalled();
  });
});

describe("RolesService.list (F1-RBAC-05 helper reusado por el editor de roles)", () => {
  it("devuelve cada rol con sus permissionCodes y userCount", async () => {
    const { service, tx } = buildService();
    tx.role.findMany.mockResolvedValue([
      {
        id: "role-1",
        name: "Admin",
        permissions: [{ permission: { code: "users:manage" } }],
        users: [{ userId: "u1" }, { userId: "u2" }],
      },
    ]);

    const result = await service.list(CURRENT_USER);

    expect(result).toEqual([
      { id: "role-1", name: "Admin", permissionCodes: ["users:manage"], userCount: 2 },
    ]);
  });
});
