import type { Prisma } from "../../../generated/prisma/client";
import type { PrismaService } from "../../../infrastructure/prisma/prisma.service";
import { AuthRepository } from "./auth.repository";

describe("AuthRepository (f1-auth U2 — único lugar con queries de auth)", () => {
  function buildRepo() {
    const emailVerificationToken = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    const user = { update: jest.fn() };
    const prisma = { emailVerificationToken } as unknown as PrismaService;
    const repo = new AuthRepository(prisma);
    return { repo, emailVerificationToken, user };
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
});
