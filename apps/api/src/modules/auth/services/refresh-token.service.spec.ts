import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema";
import type { Prisma } from "../../../generated/prisma/client";
import type { ClockPort } from "../../../infrastructure/clock/clock.port";
import { RefreshTokenService } from "./refresh-token.service";

const NOW = new Date("2026-08-12T12:00:00Z");

function buildService(overrides?: { ttlDays?: number; familyMaxDays?: number }) {
  const clock = { now: () => NOW } as ClockPort;
  const configService = new ConfigService<Env, true>({
    REFRESH_TOKEN_TTL_DAYS: overrides?.ttlDays ?? 7,
    REFRESH_FAMILY_MAX_DAYS: overrides?.familyMaxDays ?? 30,
  });
  const service = new RefreshTokenService(clock, configService);
  return { service, clock };
}

function buildTx(updateManyResult: { count: number }) {
  const updateMany = jest.fn().mockResolvedValue(updateManyResult);
  const tx = { refreshToken: { updateMany } } as unknown as Prisma.TransactionClient;
  return { tx, updateMany };
}

describe("RefreshTokenService (f1-auth AD-6)", () => {
  it("buildExpiry suma REFRESH_TOKEN_TTL_DAYS a la hora actual del clock", () => {
    const { service } = buildService({ ttlDays: 7 });

    expect(service.buildExpiry()).toEqual(new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000));
  });

  it("isFamilyOverCap: false justo por debajo del cap, true por encima", () => {
    const { service } = buildService({ familyMaxDays: 30 });
    const withinCap = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
    const overCap = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);

    expect(service.isFamilyOverCap(withinCap)).toBe(false);
    expect(service.isFamilyOverCap(overCap)).toBe(true);
  });

  it("markUsedOrRevokeFamily: UPDATE afecta 1 fila → true, NO revoca la familia", async () => {
    const { service } = buildService();
    const { tx, updateMany } = buildTx({ count: 1 });

    const result = await service.markUsedOrRevokeFamily(tx, "token-1", "family-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "token-1", usedAt: null, revokedAt: null },
      data: { usedAt: NOW },
    });
  });

  it("markUsedOrRevokeFamily: affectedRows=0 (reuse) → false y revoca TODA la familia", async () => {
    const { service } = buildService();
    const { tx, updateMany } = buildTx({ count: 0 });

    const result = await service.markUsedOrRevokeFamily(tx, "token-1", "family-1");

    expect(result).toBe(false);
    // 1ra llamada: el UPDATE condicional que falló. 2da: revokeFamily().
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { familyId: "family-1", revokedAt: null },
      data: { revokedAt: NOW },
    });
  });

  it("revokeFamily marca revokedAt=now() en todos los tokens no revocados de la familia", async () => {
    const { service } = buildService();
    const { tx, updateMany } = buildTx({ count: 2 });

    await service.revokeFamily(tx, "family-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: "family-1", revokedAt: null },
      data: { revokedAt: NOW },
    });
  });
});
