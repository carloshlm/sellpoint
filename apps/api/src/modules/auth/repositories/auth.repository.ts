import { Injectable } from "@nestjs/common";
import type { EmailVerificationToken, Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../infrastructure/prisma/prisma.service";

export interface CreateEmailVerificationTokenInput {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * ÚNICO lugar con queries de `auth` (f1-auth design §2) — AuthService
 * orquesta, esto ejecuta SQL. Las tablas de tokens NO tienen RLS (AD-3), así
 * que el lookup pre-contexto usa el cliente base; las escrituras que
 * dependen del contexto de tenant (activar usuario, marcar token usado)
 * reciben el `tx` de `withTenantContext` desde afuera.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationToken | null> {
    return this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  }

  createEmailVerificationToken(
    input: CreateEmailVerificationTokenInput,
  ): Promise<EmailVerificationToken> {
    return this.prisma.emailVerificationToken.create({ data: input });
  }

  markEmailVerificationTokenUsed(
    tx: Prisma.TransactionClient,
    tokenId: string,
    usedAt: Date,
  ): Promise<EmailVerificationToken> {
    return tx.emailVerificationToken.update({ where: { id: tokenId }, data: { usedAt } });
  }

  activateUser(tx: Prisma.TransactionClient, userId: string, emailVerifiedAt: Date) {
    return tx.user.update({ where: { id: userId }, data: { status: "active", emailVerifiedAt } });
  }
}
