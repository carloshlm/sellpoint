import type { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../../infrastructure/prisma/prisma.service";
import { AuthRepository } from "./auth.repository";

describe("AuthRepository (f1-auth U2/U3/U4 — único lugar con queries de auth)", () => {
  function buildRepo() {
    const emailVerificationToken = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const user = { update: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() };
    const refreshToken = { findUnique: jest.fn(), aggregate: jest.fn(), create: jest.fn() };
    const userRole = { findMany: jest.fn() };
    const $queryRaw = jest.fn();
    const prisma = {
      emailVerificationToken,
      user,
      refreshToken,
      userRole,
      $queryRaw,
    } as unknown as PrismaService;
    const repo = new AuthRepository(prisma);
    return { repo, emailVerificationToken, user, refreshToken, userRole, $queryRaw };
  }

  it("findEmailVerificationTokenByHash consulta con el cliente base (tokens sin RLS, AD-3)", async () => {
    const { repo, emailVerificationToken } = buildRepo();
    emailVerificationToken.findUnique.mockResolvedValue({ id: "tok-1" });

    const result = await repo.findEmailVerificationTokenByHash("hash-abc");

    expect(emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: "hash-abc" },
    });
    expect(result).toEqual({ id: "tok-1" });
  });

  it("createEmailVerificationToken inserta con el cliente base tras el commit de provision (design §4)", async () => {
    const { repo, emailVerificationToken } = buildRepo();
    const expiresAt = new Date("2026-08-13T00:00:00Z");
    emailVerificationToken.create.mockResolvedValue({ id: "tok-1" });

    await repo.createEmailVerificationToken({
      tenantId: "tenant-1",
      userId: "user-1",
      tokenHash: "hash-abc",
      expiresAt,
    });

    expect(emailVerificationToken.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-1", userId: "user-1", tokenHash: "hash-abc", expiresAt },
    });
  });

  it("markEmailVerificationTokenUsed y activateUser corren sobre el tx recibido (dentro de withTenantContext)", async () => {
    const { repo } = buildRepo();
    const update = jest.fn().mockResolvedValue(undefined);
    const tx = {
      emailVerificationToken: { update },
      user: { update },
    } as unknown as Prisma.TransactionClient;
    const now = new Date("2026-08-13T00:00:00Z");

    await repo.markEmailVerificationTokenUsed(tx, "tok-1", now);
    await repo.activateUser(tx, "user-1", now);

    expect(update).toHaveBeenNthCalledWith(1, { where: { id: "tok-1" }, data: { usedAt: now } });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "user-1" },
      data: { status: "active", emailVerifiedAt: now },
    });
  });

  it("resolveTenantByEmail: usa el cliente base (sin contexto) y devuelve el tenant_id de la función SECURITY DEFINER", async () => {
    const { repo, $queryRaw } = buildRepo();
    $queryRaw.mockResolvedValue([{ tenant_id: "tenant-1" }]);

    const result = await repo.resolveTenantByEmail("owner@acme.test");

    expect(result).toBe("tenant-1");
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it("resolveTenantByEmail: email inexistente → NULL de la función se propaga como null", async () => {
    const { repo, $queryRaw } = buildRepo();
    $queryRaw.mockResolvedValue([{ tenant_id: null }]);

    await expect(repo.resolveTenantByEmail("nadie@acme.test")).resolves.toBeNull();
  });

  it("findUserByTenantAndEmail consulta por tenantId+email sobre el tx (users tiene RLS)", async () => {
    const { repo } = buildRepo();
    const findFirst = jest.fn().mockResolvedValue({ id: "user-1" });
    const tx = { user: { findFirst } } as unknown as Prisma.TransactionClient;

    const result = await repo.findUserByTenantAndEmail(tx, "tenant-1", "owner@acme.test");

    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", email: "owner@acme.test" },
    });
    expect(result).toEqual({ id: "user-1" });
  });

  it("resolvePermissionCodes: JOIN userRole→role→rolePermission→permission, dedupeado", async () => {
    const { repo } = buildRepo();
    const findMany = jest.fn().mockResolvedValue([
      { role: { permissions: [{ permission: { code: "sales:create" } }] } },
      {
        role: {
          permissions: [
            { permission: { code: "sales:create" } },
            { permission: { code: "sales:read" } },
          ],
        },
      },
    ]);
    const tx = { userRole: { findMany } } as unknown as Prisma.TransactionClient;

    const codes = await repo.resolvePermissionCodes(tx, "user-1");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
    expect(codes.sort()).toEqual(["sales:create", "sales:read"]);
  });

  it("findRefreshTokenByHash consulta el cliente base por token_hash (refresh_tokens sin RLS, AD-3)", async () => {
    const { repo, refreshToken } = buildRepo();
    refreshToken.findUnique.mockResolvedValue({ id: "rt-1" });

    const result = await repo.findRefreshTokenByHash("hash-xyz");

    expect(refreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: "hash-xyz" } });
    expect(result).toEqual({ id: "rt-1" });
  });

  it("findOldestFamilyCreatedAt agrega MIN(created_at) por family_id", async () => {
    const { repo, refreshToken } = buildRepo();
    const createdAt = new Date("2026-07-01T00:00:00Z");
    refreshToken.aggregate.mockResolvedValue({ _min: { createdAt } });

    const result = await repo.findOldestFamilyCreatedAt("family-1");

    expect(refreshToken.aggregate).toHaveBeenCalledWith({
      where: { familyId: "family-1" },
      _min: { createdAt: true },
    });
    expect(result).toEqual(createdAt);
  });

  it("createRefreshToken inserta sobre el tx recibido", async () => {
    const { repo } = buildRepo();
    const create = jest.fn().mockResolvedValue({ id: "rt-2" });
    const tx = { refreshToken: { create } } as unknown as Prisma.TransactionClient;
    const expiresAt = new Date("2026-08-19T00:00:00Z");

    await repo.createRefreshToken(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      tokenHash: "hash-new",
      familyId: "family-1",
      expiresAt,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        userId: "user-1",
        tokenHash: "hash-new",
        familyId: "family-1",
        expiresAt,
      },
    });
  });
});
