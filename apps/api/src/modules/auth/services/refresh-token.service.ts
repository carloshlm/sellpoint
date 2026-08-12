import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema";
import type { Prisma } from "../../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../../infrastructure/clock/clock.port";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * f1-auth AD-6: mecánica de rotación de familia de refresh tokens.
 * `markUsedOrRevokeFamily` es el UPDATE condicional atómico —
 * `affectedRows === 0` significa que otro refresh (concurrente o un
 * atacante reusando un token ya rotado) ganó la carrera primero, así que
 * revoca TODA la familia. Cierra la carrera SIN locks ni `SELECT FOR
 * UPDATE`: la atomicidad la da el propio `WHERE used_at IS NULL AND
 * revoked_at IS NULL` del UPDATE.
 *
 * Recibe siempre el `tx` de `withTenantContext` — igual que `AuditService`,
 * nunca abre su propia transacción (regla dura de AD-1).
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlDays: number;
  private readonly familyMaxDays: number;

  constructor(
    @Inject(CLOCK) private readonly clock: ClockPort,
    configService: ConfigService<Env, true>,
  ) {
    this.ttlDays = configService.get("REFRESH_TOKEN_TTL_DAYS", { infer: true });
    this.familyMaxDays = configService.get("REFRESH_FAMILY_MAX_DAYS", { infer: true });
  }

  /** Sliding window: cada rotación emite un token nuevo con TTL fresco. */
  buildExpiry(): Date {
    return new Date(this.clock.now().getTime() + this.ttlDays * MS_PER_DAY);
  }

  /**
   * Cap absoluto de familia (AD-6): sin esto, una sesión robada y rotada
   * indefinidamente vive para siempre pese al sliding TTL.
   */
  isFamilyOverCap(oldestCreatedAt: Date): boolean {
    const ageMs = this.clock.now().getTime() - oldestCreatedAt.getTime();
    return ageMs > this.familyMaxDays * MS_PER_DAY;
  }

  /**
   * Devuelve `true` si el token seguía vigente y quedó marcado `usedAt`.
   * Devuelve `false` (y ya revocó la familia entera) si alguien más lo
   * consumió primero — el caller es responsable de auditar
   * `auth.refresh.reuse_detected` y limpiar la cookie.
   */
  async markUsedOrRevokeFamily(
    tx: Prisma.TransactionClient,
    tokenId: string,
    familyId: string,
  ): Promise<boolean> {
    const now = this.clock.now();
    const { count } = await tx.refreshToken.updateMany({
      where: { id: tokenId, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });

    if (count === 0) {
      await this.revokeFamily(tx, familyId);
      return false;
    }

    return true;
  }

  async revokeFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
