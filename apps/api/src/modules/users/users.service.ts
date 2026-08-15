import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { TENANT_SELECT, type TenantBlock, toTenantBlock } from "../tenants/tenant.types";

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  status: string;
  locale: string;
}

/**
 * Shape que consume el bootstrap de sesión del front (AuthUser del store de
 * apps/web): identidad fresca de DB + permissions del JWT. NO exponer acá
 * campos sensibles (passwordHash, status interno, etc.).
 */
export interface MeProfile {
  id: string;
  email: string;
  firstName: string;
  locale: string;
  permissions: string[];
  /**
   * A1 del design de f1-web-onboard: MISMO shape que `LoginResult.user.tenant`
   * (auth.service.ts) — el `OnboardingGate` del front lo lee del store sin
   * importar si llegó por login o por bootstrap/resync.
   */
  tenant: TenantBlock;
}

/**
 * F1-LOCALE-05 (PATCH /me): CERO SQL directo acá, todo vía PrismaService —
 * mismo molde que TenantsService/AuthService. `withTenantContext` porque
 * `users` tiene RLS (tenant_isolation) — el user autenticado solo puede
 * tocar su propia fila, y de hecho solo la de SU tenant.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * GET /me — lo consume el bootstrap de sesión del front tras un refresh
   * (la cookie httpOnly revive el token, pero el JWT no trae email/firstName).
   * `email`/`firstName`/`locale` salen de la DB (frescos: PATCH /me pudo
   * cambiar el locale con el token ya emitido); `permissions` del JWT, que es
   * la fuente que autoriza ESTA sesión.
   */
  async getMe(user: AuthUser): Promise<MeProfile> {
    const { row, tenantRow } = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const row = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { id: true, email: true, firstName: true, locale: true },
      });
      const tenantRow = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: TENANT_SELECT,
      });
      return { row, tenantRow };
    });

    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      locale: row.locale,
      permissions: user.permissions,
      tenant: toTenantBlock(tenantRow),
    };
  }

  async updateLocale(user: AuthUser, locale: Locale, meta: RequestMeta): Promise<UserSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { locale: true },
      });

      const updated = await tx.user.update({
        where: { id: user.userId },
        data: { locale },
      });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "user.locale.updated",
        resourceType: "user",
        resourceId: user.userId,
        before: { locale: before.locale },
        after: { locale },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return toUserSummary(updated);
    });
  }
}

function toUserSummary(user: {
  id: string;
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  status: string;
  locale: string;
}): UserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastNamePaternal: user.lastNamePaternal,
    lastNameMaternal: user.lastNameMaternal,
    status: user.status,
    locale: user.locale,
  };
}
