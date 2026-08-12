import { Injectable } from "@nestjs/common";
import type {
  EmailVerificationToken,
  PasswordResetToken,
  Prisma,
  RefreshToken,
  User,
} from "../../../generated/prisma/client";
import { PrismaService } from "../../../infrastructure/prisma/prisma.service";

export interface CreateEmailVerificationTokenInput {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface CreateRefreshTokenInput {
  tenantId: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export interface CreatePasswordResetTokenInput {
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

  /**
   * ÚNICA excepción de RLS del sistema (design AD-2): función
   * `SECURITY DEFINER` sobre el cliente base, sin contexto de tenant.
   * Devuelve solo el `tenant_id` (o NULL si el email no existe) para que
   * `login`/`forgot-password` puedan abrir `withTenantContext`.
   */
  async resolveTenantByEmail(email: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<
      { tenant_id: string | null }[]
    >`SELECT auth_resolve_tenant_by_email(${email}) AS tenant_id`;
    return rows[0]?.tenant_id ?? null;
  }

  /** Lectura corta dentro de `withTenantContext` (AD-1) — `users` tiene RLS. */
  findUserByTenantAndEmail(
    tx: Prisma.TransactionClient,
    tenantId: string,
    email: string,
  ): Promise<User | null> {
    return tx.user.findFirst({ where: { tenantId, email } });
  }

  findUserById(tx: Prisma.TransactionClient, userId: string): Promise<User | null> {
    return tx.user.findUnique({ where: { id: userId } });
  }

  /**
   * R2 del design: NUNCA consultar `user_roles`/`role_permissions` sin JOIN
   * a `roles` (única tabla RBAC con RLS+tenant_id en esta cadena) — el
   * `include` anidado de Prisma genera exactamente ese JOIN.
   */
  async resolvePermissionCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const userRoles = await tx.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    const codes = new Set<string>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        codes.add(rolePermission.permission.code);
      }
    }
    return [...codes];
  }

  /** Tokens de refresh NO tienen RLS (AD-3) — lookup pre-contexto por hash. */
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async findOldestFamilyCreatedAt(familyId: string): Promise<Date | null> {
    const result = await this.prisma.refreshToken.aggregate({
      where: { familyId },
      _min: { createdAt: true },
    });
    return result._min.createdAt ?? null;
  }

  createRefreshToken(
    tx: Prisma.TransactionClient,
    input: CreateRefreshTokenInput,
  ): Promise<RefreshToken> {
    return tx.refreshToken.create({ data: input });
  }

  /**
   * f1-auth U5 — AUTH-REQ-08/09. `password_reset_tokens` NO tiene RLS
   * (AD-3, misma familia que email_verification_tokens/refresh_tokens): el
   * lookup pre-contexto y la invalidación de tokens previos usan el cliente
   * base; solo lo que toca `users` (RLS) necesita el `tx` de
   * `withTenantContext`.
   */
  findPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  createPasswordResetToken(input: CreatePasswordResetTokenInput): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.create({ data: input });
  }

  /**
   * Design §4 (forgot-password): invalidar los tokens de reset previos SIN
   * usar del usuario antes de emitir uno nuevo — evita que links viejos
   * sigan siendo canjeables si el usuario pide varios resets seguidos.
   */
  async invalidatePendingPasswordResetTokens(userId: string, now: Date): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
  }

  markPasswordResetTokenUsed(
    tx: Prisma.TransactionClient,
    tokenId: string,
    usedAt: Date,
  ): Promise<PasswordResetToken> {
    return tx.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt } });
  }

  /**
   * AUTH-REQ-09/10 + design §4: `passwordHash` siempre se actualiza;
   * `emailVerifiedAt` solo se toca si el caller lo pasa (era NULL antes del
   * reset) — usar el link de reset prueba el control del email. Cuando esa
   * verificación promueve a un invited, `promoteToActive` replica la
   * semántica de verify-email (status → active en la misma escritura).
   */
  updateUserPassword(
    tx: Prisma.TransactionClient,
    userId: string,
    passwordHash: string,
    emailVerifiedAt: Date | null,
    promoteToActive: boolean,
  ): Promise<User> {
    return tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        ...(emailVerifiedAt ? { emailVerifiedAt } : {}),
        ...(promoteToActive ? { status: "active" as const } : {}),
      },
    });
  }

  /**
   * AUTH-REQ-09: a diferencia de `RefreshTokenService.revokeFamily`
   * (revoca UNA familia), esto revoca TODAS las familias activas del
   * usuario — una sesión robada muere con el cambio de password.
   */
  async revokeAllRefreshTokensForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    revokedAt: Date,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }
}
