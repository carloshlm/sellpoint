import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
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
import type { RefreshTokenService } from "./services/refresh-token.service";
import type { TokenService } from "./services/token.service";

type FakeRedis = { set: jest.Mock };

const NOW = new Date("2026-08-12T12:00:00Z");

const ENV_DEFAULTS: Record<string, unknown> = {
  APP_URL: "https://app.example.com",
  JWT_ACCESS_TTL_MIN: 15,
};

function buildService(overrides?: {
  provisionResult?: { tenantId: string; userId: string };
  provisionError?: unknown;
  tokenRow?: Record<string, unknown> | null;
  resolveTenantByEmailResult?: string | null;
  userRow?: Record<string, unknown> | null;
  verifyResult?: boolean;
  permissions?: string[];
  signResult?: string;
  refreshRow?: Record<string, unknown> | null;
  oldestFamilyCreatedAt?: Date | null;
  isFamilyOverCap?: boolean;
  rotateResult?: boolean;
  passwordResetTokenRow?: Record<string, unknown> | null;
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

  const hasher = {
    hash: jest.fn().mockResolvedValue("hashed-password"),
    verify: jest.fn().mockResolvedValue(overrides?.verifyResult ?? true),
  } as unknown as HashPort;
  const clock = { now: () => NOW } as unknown as ClockPort;
  const oneTimeTokenService = {
    generate: jest.fn().mockReturnValue({ token: "raw-token", tokenHash: "hash-token" }),
    hash: jest.fn().mockReturnValue("hash-of-raw-cookie"),
  } as unknown as OneTimeTokenService;

  const authRepository = {
    createEmailVerificationToken: jest.fn().mockResolvedValue({ id: "tok-1" }),
    findEmailVerificationTokenByHash: jest.fn().mockResolvedValue(overrides?.tokenRow ?? null),
    markEmailVerificationTokenUsed: jest.fn().mockResolvedValue(undefined),
    activateUser: jest.fn().mockResolvedValue(undefined),
    resolveTenantByEmail: jest
      .fn()
      .mockResolvedValue(
        overrides?.resolveTenantByEmailResult === undefined
          ? "tenant-1"
          : overrides.resolveTenantByEmailResult,
      ),
    findUserByTenantAndEmail: jest.fn().mockResolvedValue(overrides?.userRow ?? null),
    findUserById: jest.fn().mockResolvedValue(overrides?.userRow ?? null),
    resolvePermissionCodes: jest.fn().mockResolvedValue(overrides?.permissions ?? []),
    findRefreshTokenByHash: jest.fn().mockResolvedValue(overrides?.refreshRow ?? null),
    findOldestFamilyCreatedAt: jest
      .fn()
      .mockResolvedValue(
        overrides?.oldestFamilyCreatedAt === undefined ? NOW : overrides.oldestFamilyCreatedAt,
      ),
    createRefreshToken: jest.fn().mockResolvedValue({ id: "rt-new" }),
    findPasswordResetTokenByHash: jest
      .fn()
      .mockResolvedValue(
        overrides?.passwordResetTokenRow === undefined ? null : overrides.passwordResetTokenRow,
      ),
    createPasswordResetToken: jest.fn().mockResolvedValue({ id: "prt-new" }),
    invalidatePendingPasswordResetTokens: jest.fn().mockResolvedValue(undefined),
    markPasswordResetTokenUsed: jest.fn().mockResolvedValue(undefined),
    updateUserPassword: jest.fn().mockResolvedValue(undefined),
    revokeAllRefreshTokensForUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuthRepository;

  const mailer = { send: jest.fn().mockResolvedValue(undefined) } as unknown as MailerPort;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const tx = {};
  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const tokenService = {
    signAccessToken: jest.fn().mockReturnValue(overrides?.signResult ?? "signed-access-token"),
  } as unknown as TokenService;

  const refreshTokenService = {
    buildExpiry: jest.fn().mockReturnValue(new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)),
    isFamilyOverCap: jest.fn().mockReturnValue(overrides?.isFamilyOverCap ?? false),
    markUsedOrRevokeFamily: jest.fn().mockResolvedValue(overrides?.rotateResult ?? true),
    revokeFamily: jest.fn().mockResolvedValue(undefined),
  } as unknown as RefreshTokenService;

  const configService = {
    get: (key: string) => ENV_DEFAULTS[key],
  } as unknown as ConfigService;

  const redis: FakeRedis = { set: jest.fn().mockResolvedValue("OK") };

  const service = new AuthService(
    tenantsService,
    hasher,
    clock,
    oneTimeTokenService,
    authRepository,
    mailer,
    auditService,
    prisma,
    tokenService,
    refreshTokenService,
    configService,
    redis as never,
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
    tokenService,
    refreshTokenService,
    redis,
    tx,
  };
}

async function initService(overrides?: Parameters<typeof buildService>[0]) {
  const built = buildService(overrides);
  await built.service.onModuleInit();
  return built;
}

function activeUser(overrides?: Record<string, unknown>) {
  return {
    id: "user-1",
    email: "owner@acme.test",
    passwordHash: "real-hash",
    status: "active",
    emailVerifiedAt: NOW,
    firstName: "Ana",
    locale: "es",
    ...overrides,
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

describe("AuthService.login (AUTH-REQ-03/04 — a prueba de enumeración)", () => {
  const loginInput = { email: "owner@acme.test", password: "twelve-characters" };

  it("email inexistente → verifica contra el hash dummy (timing constante) y 401 auth.invalid_credentials", async () => {
    const { service, hasher, authRepository } = await initService({
      resolveTenantByEmailResult: null,
    });

    await expect(service.login(loginInput, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login(loginInput, {})).rejects.toMatchObject({
      response: { message: "auth.invalid_credentials" },
    });
    // El dummy hash se precomputa una vez en onModuleInit; cada intento
    // fallido con email inexistente vuelve a verificar contra ÉL.
    expect(hasher.verify).toHaveBeenCalledWith("hashed-password", "twelve-characters");
    expect(authRepository.findUserByTenantAndEmail).not.toHaveBeenCalled();
  });

  it("password incorrecto → MISMA clave 401 auth.invalid_credentials que email inexistente, audita login_failed", async () => {
    const { service, hasher, auditService, tx } = await initService({
      userRow: activeUser(),
      verifyResult: false,
    });
    (hasher.verify as jest.Mock).mockResolvedValueOnce(false);

    await expect(service.login(loginInput, { ip: "1.2.3.4" })).rejects.toMatchObject({
      response: { message: "auth.invalid_credentials" },
    });
    expect(auditService.record).toHaveBeenCalledWith(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.login.failed",
      resourceType: "user",
      resourceId: "user-1",
      ip: "1.2.3.4",
      userAgent: undefined,
    });
  });

  it("usuario invitado sin password (passwordHash null) → 401 auth.invalid_credentials, verifica contra dummy", async () => {
    const { service, hasher } = await initService({
      userRow: activeUser({ passwordHash: null }),
    });

    await expect(service.login(loginInput, {})).rejects.toMatchObject({
      response: { message: "auth.invalid_credentials" },
    });
    expect(hasher.verify).toHaveBeenCalledWith("hashed-password", "twelve-characters");
  });

  it("usuario suspendido con password correcto → 403 auth.account_suspended", async () => {
    const { service } = await initService({
      userRow: activeUser({ status: "suspended" }),
    });

    await expect(service.login(loginInput, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.login(loginInput, {})).rejects.toMatchObject({
      response: { message: "auth.account_suspended" },
    });
  });

  it("email no verificado con password correcto → 403 auth.email_not_verified", async () => {
    const { service } = await initService({
      userRow: activeUser({ emailVerifiedAt: null }),
    });

    await expect(service.login(loginInput, {})).rejects.toMatchObject({
      response: { message: "auth.email_not_verified" },
    });
  });

  it("login exitoso: crea refresh token con familyId nuevo, audita login_success, firma access con claims completos", async () => {
    const { service, authRepository, auditService, tokenService, tx } = await initService({
      userRow: activeUser(),
      permissions: ["sales:create"],
      signResult: "access-token-abc",
    });

    const result = await service.login(loginInput, { ip: "1.2.3.4", userAgent: "jest" });

    expect(authRepository.createRefreshToken).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        tokenHash: "hash-token",
        familyId: expect.any(String),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.login.success", userId: "user-1" }),
    );
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({
      sub: "user-1",
      tenantId: "tenant-1",
      permissions: ["sales:create"],
      locale: "es",
    });
    expect(result).toEqual({
      accessToken: "access-token-abc",
      expiresIn: 15 * 60,
      refreshToken: "raw-token",
      refreshExpiresAt: expect.any(Date),
      user: {
        id: "user-1",
        email: "owner@acme.test",
        firstName: "Ana",
        locale: "es",
        permissions: ["sales:create"],
      },
    });
  });
});

describe("AuthService.refresh (AUTH-REQ-05/06/11)", () => {
  it("sin cookie → 401 auth.missing_refresh_token", async () => {
    const { service } = buildService();

    await expect(service.refresh(undefined, {})).rejects.toMatchObject({
      response: { message: "auth.missing_refresh_token" },
    });
  });

  it("token inexistente → 401 auth.invalid_refresh_token", async () => {
    const { service } = buildService({ refreshRow: null });

    await expect(service.refresh("raw-cookie", {})).rejects.toMatchObject({
      response: { message: "auth.invalid_refresh_token" },
    });
  });

  it("REUSE (usedAt ya seteado) → revoca TODA la familia, audita reuse_detected, 401 auth.token_reused", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: new Date(NOW.getTime() - 1000),
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service, refreshTokenService, auditService, tx } = buildService({ refreshRow });

    await expect(service.refresh("raw-cookie", { ip: "1.2.3.4" })).rejects.toMatchObject({
      response: { message: "auth.token_reused" },
    });
    expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith(tx, "family-1");
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "auth.refresh.reuse_detected",
        resourceType: "refresh_token_family",
        resourceId: "family-1",
      }),
    );
  });

  it("token expirado → 401 auth.invalid_refresh_token", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() - 1000),
    };
    const { service } = buildService({ refreshRow });

    await expect(service.refresh("raw-cookie", {})).rejects.toMatchObject({
      response: { message: "auth.invalid_refresh_token" },
    });
  });

  it("familia sobre el cap (REFRESH_FAMILY_MAX_DAYS) → 401 auth.invalid_refresh_token", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service } = buildService({
      refreshRow,
      oldestFamilyCreatedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000),
      isFamilyOverCap: true,
    });

    await expect(service.refresh("raw-cookie", {})).rejects.toMatchObject({
      response: { message: "auth.invalid_refresh_token" },
    });
  });

  it("usuario suspendido mid-session → 403 auth.account_suspended, SIN emitir tokens nuevos", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service, authRepository, refreshTokenService, tx } = buildService({
      refreshRow,
      userRow: activeUser({ status: "suspended" }),
    });

    await expect(service.refresh("raw-cookie", {})).rejects.toMatchObject({
      response: { message: "auth.account_suspended" },
    });
    expect(authRepository.createRefreshToken).not.toHaveBeenCalled();
    // W7 (verify #271): sin esto el refresh token de un usuario suspendido
    // queda vivo (usedAt=null, revokedAt=null) — si se levanta la
    // suspensión, una sesión robada previa revive.
    expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith(tx, "family-1");
  });

  it("affectedRows=0 en el UPDATE condicional (reuse concurrente) → 401 auth.token_reused, audita", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service, auditService, tx } = buildService({
      refreshRow,
      userRow: activeUser(),
      rotateResult: false,
    });

    await expect(service.refresh("raw-cookie", {})).rejects.toMatchObject({
      response: { message: "auth.token_reused" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "auth.refresh.reuse_detected" }),
    );
  });

  it("camino feliz: rota DENTRO de la misma familyId, re-resuelve permisos frescos, firma access nuevo", async () => {
    const refreshRow = {
      id: "rt-1",
      tenantId: "tenant-1",
      userId: "user-1",
      familyId: "family-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 1000),
    };
    const { service, authRepository, tokenService, refreshTokenService, tx } = buildService({
      refreshRow,
      userRow: activeUser(),
      permissions: ["sales:read"],
      signResult: "new-access-token",
    });

    const result = await service.refresh("raw-cookie", {});

    expect(refreshTokenService.markUsedOrRevokeFamily).toHaveBeenCalledWith(tx, "rt-1", "family-1");
    expect(authRepository.createRefreshToken).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ familyId: "family-1", userId: "user-1" }),
    );
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({
      sub: "user-1",
      tenantId: "tenant-1",
      permissions: ["sales:read"],
      locale: "es",
    });
    expect(result).toEqual({
      accessToken: "new-access-token",
      expiresIn: 15 * 60,
      refreshToken: "raw-token",
      refreshExpiresAt: expect.any(Date),
    });
  });
});

describe("AuthService.logout (AUTH-REQ-07)", () => {
  it("sin cookie → resuelve sin tocar el repositorio", async () => {
    const { service, authRepository } = buildService();

    await expect(service.logout(undefined, {})).resolves.toBeUndefined();
    expect(authRepository.findRefreshTokenByHash).not.toHaveBeenCalled();
  });

  it("token inexistente → resuelve en silencio (mismo resultado observable: 204)", async () => {
    const { service, refreshTokenService } = buildService({ refreshRow: null });

    await expect(service.logout("raw-cookie", {})).resolves.toBeUndefined();
    expect(refreshTokenService.revokeFamily).not.toHaveBeenCalled();
  });

  it("token válido → revoca la FAMILIA entera (no solo el token) y audita auth.logout", async () => {
    const refreshRow = { id: "rt-1", tenantId: "tenant-1", userId: "user-1", familyId: "family-1" };
    const { service, refreshTokenService, auditService, tx } = buildService({ refreshRow });

    await service.logout("raw-cookie", { ip: "1.2.3.4", userAgent: "jest" });

    expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith(tx, "family-1");
    expect(auditService.record).toHaveBeenCalledWith(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.logout",
      resourceType: "user",
      resourceId: "user-1",
      ip: "1.2.3.4",
      userAgent: "jest",
    });
  });
});

describe("AuthService.forgotPassword (AUTH-REQ-08 — a prueba de enumeración)", () => {
  it("email inexistente → resuelve en silencio, SIN tocar el repo de tokens ni el mailer (202 idéntico afuera)", async () => {
    const { service, authRepository, mailer } = buildService({
      resolveTenantByEmailResult: null,
    });

    await expect(service.forgotPassword("nadie@acme.test", {})).resolves.toBeUndefined();
    expect(authRepository.invalidatePendingPasswordResetTokens).not.toHaveBeenCalled();
    expect(authRepository.createPasswordResetToken).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("email existente → invalida tokens previos, crea uno nuevo (TTL 30min) y dispara el mail best-effort", async () => {
    const { service, authRepository, mailer, tx } = buildService({
      userRow: activeUser(),
    });

    await service.forgotPassword("owner@acme.test", { ip: "1.2.3.4", userAgent: "jest" });

    expect(authRepository.invalidatePendingPasswordResetTokens).toHaveBeenCalledWith("user-1", NOW);
    expect(authRepository.createPasswordResetToken).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      tokenHash: "hash-token",
      expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    });
    expect(mailer.send).toHaveBeenCalledWith({
      to: "owner@acme.test",
      template: "reset-password",
      vars: { firstName: "Ana", link: "https://app.example.com/reset-password?token=raw-token" },
      locale: "es",
    });
    void tx;
  });

  it("un fallo del mailer NUNCA rompe la respuesta (best-effort, AD-9)", async () => {
    const { service, mailer } = buildService({ userRow: activeUser() });
    (mailer.send as jest.Mock).mockRejectedValue(new Error("smtp caído"));

    await expect(service.forgotPassword("owner@acme.test", {})).resolves.toBeUndefined();
  });
});

describe("AuthService.resetPassword (AUTH-REQ-09/10/13)", () => {
  const validTokenRow = {
    id: "prt-1",
    tenantId: "tenant-1",
    userId: "user-1",
    usedAt: null,
    expiresAt: new Date(NOW.getTime() + 1000),
  };

  it("token inexistente → 400 auth.token_invalid", async () => {
    const { service } = buildService({ passwordResetTokenRow: null });

    await expect(
      service.resetPassword("token-cualquiera", "twelve-characters", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resetPassword("token-cualquiera", "twelve-characters", {}),
    ).rejects.toMatchObject({ response: { message: "auth.token_invalid" } });
  });

  it("token ya usado → 400 auth.token_invalid (misma clave que inexistente/expirado)", async () => {
    const { service } = buildService({
      passwordResetTokenRow: { ...validTokenRow, usedAt: new Date(NOW.getTime() - 1000) },
    });

    await expect(service.resetPassword("raw-token", "twelve-characters", {})).rejects.toMatchObject(
      { response: { message: "auth.token_invalid" } },
    );
  });

  it("token expirado → 400 auth.token_invalid", async () => {
    const { service } = buildService({
      passwordResetTokenRow: { ...validTokenRow, expiresAt: new Date(NOW.getTime() - 1000) },
    });

    await expect(service.resetPassword("raw-token", "twelve-characters", {})).rejects.toMatchObject(
      { response: { message: "auth.token_invalid" } },
    );
  });

  it("token válido: hashea AFUERA de la tx, actualiza password, marca token usado, revoca TODOS los refresh, audita, bumpea perm-epoch", async () => {
    const { service, hasher, authRepository, auditService, refreshTokenService, redis, tx } =
      buildService({ passwordResetTokenRow: validTokenRow, userRow: activeUser() });

    await service.resetPassword("raw-token", "twelve-characters", {
      ip: "1.2.3.4",
      userAgent: "jest",
    });

    expect(hasher.hash).toHaveBeenCalledWith("twelve-characters");
    expect(authRepository.updateUserPassword).toHaveBeenCalledWith(
      tx,
      "user-1",
      "hashed-password",
      null,
      false,
    );
    expect(authRepository.markPasswordResetTokenUsed).toHaveBeenCalledWith(tx, "prt-1", NOW);
    // AUTH-REQ-09: TODAS las familias, no solo una — a diferencia de logout.
    expect(authRepository.revokeAllRefreshTokensForUser).toHaveBeenCalledWith(tx, "user-1", NOW);
    expect(refreshTokenService.revokeFamily).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.password.reset",
      resourceType: "user",
      resourceId: "user-1",
      ip: "1.2.3.4",
      userAgent: "jest",
    });
    // AD-8: SET sin TTL, valor en segundos (misma unidad que `iat`).
    expect(redis.set).toHaveBeenCalledWith(
      "perm-epoch:user-1",
      String(Math.floor(NOW.getTime() / 1000)),
    );
  });

  it("si emailVerifiedAt era NULL, el reset lo setea (usar el link prueba el control del email)", async () => {
    const { service, authRepository, tx } = buildService({
      passwordResetTokenRow: validTokenRow,
      userRow: activeUser({ emailVerifiedAt: null }),
    });

    await service.resetPassword("raw-token", "twelve-characters", {});

    expect(authRepository.updateUserPassword).toHaveBeenCalledWith(
      tx,
      "user-1",
      "hashed-password",
      NOW,
      false,
    );
  });

  it("usuario invited que verifica vía reset → status pasa a active (misma semántica que verify-email; sin esto loguea pero el primer refresh lo expulsa)", async () => {
    const { service, authRepository, tx } = buildService({
      passwordResetTokenRow: validTokenRow,
      userRow: activeUser({ status: "invited", emailVerifiedAt: null }),
    });

    await service.resetPassword("raw-token", "twelve-characters", {});

    expect(authRepository.updateUserPassword).toHaveBeenCalledWith(
      tx,
      "user-1",
      "hashed-password",
      NOW,
      true,
    );
  });

  it("usuario suspended NUNCA se promueve a active vía reset (la suspensión es decisión administrativa, no de verificación)", async () => {
    const { service, authRepository, tx } = buildService({
      passwordResetTokenRow: validTokenRow,
      userRow: activeUser({ status: "suspended", emailVerifiedAt: null }),
    });

    await service.resetPassword("raw-token", "twelve-characters", {});

    expect(authRepository.updateUserPassword).toHaveBeenCalledWith(
      tx,
      "user-1",
      "hashed-password",
      NOW,
      false,
    );
  });

  it("un fallo de Redis al bumpear el epoch NO rompe el reset (fail-open, igual que JwtAuthGuard)", async () => {
    const { service, redis } = buildService({
      passwordResetTokenRow: validTokenRow,
      userRow: activeUser(),
    });
    redis.set.mockRejectedValue(new Error("redis caído"));

    await expect(
      service.resetPassword("raw-token", "twelve-characters", {}),
    ).resolves.toBeUndefined();
  });
});
