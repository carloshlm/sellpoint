import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "../../generated/prisma/client";
import type { ClockPort } from "../../infrastructure/clock/clock.port";
import type { HashPort } from "../../infrastructure/crypto/hash.port";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { MailerPort } from "../mail/mailer.port";
import type { TenantsService } from "../tenants/tenants.service";
import { AuthService } from "./auth.service";
import type { AuthRepository } from "./repositories/auth.repository";
import type { OneTimeTokenService } from "./services/one-time-token.service";

const NOW = new Date("2026-08-12T12:00:00Z");

function buildService(overrides?: {
  provisionResult?: { tenantId: string; userId: string };
  provisionError?: unknown;
  tokenRow?: Record<string, unknown> | null;
}) {
  const tenantsService = {
    provision: overrides?.provisionError
      ? jest.fn().mockRejectedValue(overrides.provisionError)
      : jest
          .fn()
          .mockResolvedValue(
            overrides?.provisionResult ?? { tenantId: "tenant-1", userId: "user-1" },
          ),
  } as unknown as TenantsService;

  const hasher = { hash: jest.fn().mockResolvedValue("hashed-password") } as unknown as HashPort;
  const clock = { now: () => NOW } as unknown as ClockPort;
  const oneTimeTokenService = {
    generate: jest.fn().mockReturnValue({ token: "raw-token", tokenHash: "hash-token" }),
    hash: jest.fn().mockReturnValue("hash-token"),
  } as unknown as OneTimeTokenService;

  const authRepository = {
    createEmailVerificationToken: jest.fn().mockResolvedValue({ id: "tok-1" }),
    findEmailVerificationTokenByHash: jest.fn().mockResolvedValue(overrides?.tokenRow ?? null),
    markEmailVerificationTokenUsed: jest.fn().mockResolvedValue(undefined),
    activateUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthRepository;

  const mailer = { send: jest.fn().mockResolvedValue(undefined) } as unknown as MailerPort;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const tx = {};
  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const configService = {
    get: () => "https://app.example.com",
  } as unknown as ConfigService;

  const service = new AuthService(
    tenantsService,
    hasher,
    clock,
    oneTimeTokenService,
    authRepository,
    mailer,
    auditService,
    prisma,
    configService,
  );

  return {
    service,
    tenantsService,
    hasher,
    oneTimeTokenService,
    authRepository,
    mailer,
    auditService,
    prisma,
    tx,
  };
}

const registerInput = {
  tenantName: "Acme",
  email: "owner@acme.test",
  password: "twelve-characters",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
};

describe("AuthService.registerTenant (AUTH-REQ-01)", () => {
  it("hashea la password ANTES de llamar a tenantsService.provision (AD-1: fuera de toda tx)", async () => {
    const { service, hasher, tenantsService } = buildService();

    await service.registerTenant(registerInput, { ip: "127.0.0.1", userAgent: "jest" });

    expect(hasher.hash).toHaveBeenCalledWith("twelve-characters");
    expect(tenantsService.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPasswordHash: "hashed-password",
        ownerEmail: "owner@acme.test",
      }),
    );
  });

  it("registro exitoso crea el token de verificación (TTL 24h) y dispara el mail best-effort", async () => {
    const { service, authRepository, mailer } = buildService();

    const result = await service.registerTenant(registerInput, {});

    expect(result).toEqual({ tenantId: "tenant-1", userId: "user-1" });
    expect(authRepository.createEmailVerificationToken).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      tokenHash: "hash-token",
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });
    expect(mailer.send).toHaveBeenCalledWith({
      to: "owner@acme.test",
      template: "verify-email",
      vars: { firstName: "Ana", link: "https://app.example.com/verify-email?token=raw-token" },
      locale: "es",
    });
  });

  it("email ya existe (P2002 de Prisma) → 409 auth.email_taken", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { service } = buildService({ provisionError: p2002 });

    const error = await service.registerTenant(registerInput, {}).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({ response: { message: "auth.email_taken" } });
  });

  it("un fallo del mailer NUNCA rompe la respuesta (best-effort, AD-9)", async () => {
    const { service, mailer } = buildService();
    (mailer.send as jest.Mock).mockRejectedValue(new Error("smtp caído"));

    await expect(service.registerTenant(registerInput, {})).resolves.toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
    });
  });
});

describe("AuthService.verifyEmail (AUTH-REQ-02)", () => {
  it("token válido → activa el usuario, marca el token usado y audita, dentro de withTenantContext", async () => {
    const tokenRow = {
      id: "tok-1",
      tenantId: "tenant-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service, authRepository, auditService, prisma, tx } = buildService({ tokenRow });

    await service.verifyEmail("raw-token", { ip: "127.0.0.1", userAgent: "jest" });

    expect(prisma.withTenantContext).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(authRepository.activateUser).toHaveBeenCalledWith(tx, "user-1", NOW);
    expect(authRepository.markEmailVerificationTokenUsed).toHaveBeenCalledWith(tx, "tok-1", NOW);
    expect(auditService.record).toHaveBeenCalledWith(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.email.verified",
      resourceType: "user",
      resourceId: "user-1",
      ip: "127.0.0.1",
      userAgent: "jest",
    });
  });

  it("token inexistente → 400 auth.token_invalid", async () => {
    const { service } = buildService({ tokenRow: null });

    await expect(service.verifyEmail("token-cualquiera", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.verifyEmail("token-cualquiera", {})).rejects.toMatchObject({
      response: { message: "auth.token_invalid" },
    });
  });

  it("token ya usado → 400 auth.token_invalid (misma clave que inexistente/expirado)", async () => {
    const tokenRow = {
      id: "tok-1",
      tenantId: "tenant-1",
      userId: "user-1",
      usedAt: new Date(NOW.getTime() - 1000),
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service } = buildService({ tokenRow });

    await expect(service.verifyEmail("raw-token", {})).rejects.toMatchObject({
      response: { message: "auth.token_invalid" },
    });
  });

  it("token expirado → 400 auth.token_invalid", async () => {
    const tokenRow = {
      id: "tok-1",
      tenantId: "tenant-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(NOW.getTime() - 1000),
    };
    const { service } = buildService({ tokenRow });

    await expect(service.verifyEmail("raw-token", {})).rejects.toMatchObject({
      response: { message: "auth.token_invalid" },
    });
  });
});
