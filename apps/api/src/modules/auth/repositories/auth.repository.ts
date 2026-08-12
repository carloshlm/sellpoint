import { Injectable } from "@nestjs/common";
import type {
  EmailVerificationToken,
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
}
