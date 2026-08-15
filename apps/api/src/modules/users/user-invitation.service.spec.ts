import type { ConfigService } from "@nestjs/config";
import type { ClockPort } from "../../infrastructure/clock/clock.port";
import type { AuthRepository } from "../auth/repositories/auth.repository";
import type { OneTimeTokenService } from "../auth/services/one-time-token.service";
import type { MailerPort } from "../mail/mailer.port";
import { INVITATION_TTL_MS, UserInvitationService } from "./user-invitation.service";

const NOW = new Date("2026-08-14T12:00:00Z");
const APP_URL = "https://app.example.com";

const INPUT = {
  tenantId: "tenant-1",
  userId: "user-2",
  email: "bruno@example.com",
  firstName: "Bruno",
  locale: "es" as const,
};

function buildService(overrides?: { mailerFails?: boolean }) {
  const authRepository = {
    invalidatePendingPasswordResetTokens: jest.fn().mockResolvedValue(undefined),
    createPasswordResetToken: jest.fn().mockResolvedValue({ id: "prt-1" }),
  } as unknown as AuthRepository;

  const oneTimeTokenService = {
    generate: jest.fn().mockReturnValue({ token: "raw-token", tokenHash: "hashed-token" }),
  } as unknown as OneTimeTokenService;

  const mailer = {
    send: overrides?.mailerFails
      ? jest.fn().mockRejectedValue(new Error("resend caído (SPF/DKIM sin verificar)"))
      : jest.fn().mockResolvedValue(undefined),
  } as unknown as MailerPort;

  const clock = { now: () => NOW } as ClockPort;
  const configService = { get: () => APP_URL } as unknown as ConfigService;

  const service = new UserInvitationService(
    authRepository,
    oneTimeTokenService,
    mailer,
    clock,
    configService,
  );

  return { service, authRepository, oneTimeTokenService, mailer };
}

describe("UserInvitationService (gap S1: aceptación de invitación)", () => {
  it("emite un PasswordResetToken con TTL de 7 días — solo el HASH toca la DB", async () => {
    const { service, authRepository, oneTimeTokenService } = buildService();

    await service.send(INPUT);

    expect(oneTimeTokenService.generate).toHaveBeenCalledTimes(1);
    expect(authRepository.createPasswordResetToken).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-2",
      tokenHash: "hashed-token",
      expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
    });
    // El token en claro NUNCA se persiste: solo viaja en el link del mail.
    const persisted = jest.mocked(authRepository.createPasswordResetToken).mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain("raw-token");
  });

  it("el TTL de invitación es de 7 días, NO los 30 min del reset de password", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("invalida los tokens pendientes ANTES de emitir el nuevo (un solo link vivo)", async () => {
    const { service, authRepository, oneTimeTokenService } = buildService();

    await service.send(INPUT);

    expect(authRepository.invalidatePendingPasswordResetTokens).toHaveBeenCalledWith("user-2", NOW);
    const invalidateOrder = jest.mocked(authRepository.invalidatePendingPasswordResetTokens).mock
      .invocationCallOrder[0] as number;
    const generateOrder = jest.mocked(oneTimeTokenService.generate).mock
      .invocationCallOrder[0] as number;
    expect(invalidateOrder).toBeLessThan(generateOrder);
  });

  it("manda el template `invite-user` al /accept-invitation del APP_URL, en el locale del invitado", async () => {
    const { service, mailer } = buildService();

    await service.send({ ...INPUT, locale: "en" });

    expect(mailer.send).toHaveBeenCalledWith({
      to: "bruno@example.com",
      template: "invite-user",
      vars: { firstName: "Bruno", link: `${APP_URL}/accept-invitation#token=raw-token` },
      locale: "en",
    });
  });

  it("AD-9: un fallo del mailer NO rompe la invitación (best-effort, el token ya existe)", async () => {
    const { service, authRepository } = buildService({ mailerFails: true });

    await expect(service.send(INPUT)).resolves.toBeUndefined();

    expect(authRepository.createPasswordResetToken).toHaveBeenCalledTimes(1);
    // Da tiempo al `.catch()` del fire-and-forget: sin él, el rejection
    // quedaría sin manejar y jest lo reportaría como unhandled.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
