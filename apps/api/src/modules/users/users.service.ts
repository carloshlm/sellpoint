import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { EntitlementsService } from "../billing/entitlements.service";
import { type SubscriptionBlock, toSubscriptionBlock } from "../billing/subscription.types";
import { TENANT_SELECT, type TenantBlock, toTenantBlock } from "../tenants/tenant.types";
import type { UpdateMeDto } from "./dto/update-me.dto";

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
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  locale: string;
  /** F3-HOME-01. El almacén desde el que opera por defecto. */
  defaultWarehouseId: string | null;
  permissions: string[];
  /**
   * A1 del design de f1-web-onboard: MISMO shape que `LoginResult.user.tenant`
   * (auth.service.ts) — el `OnboardingGate` del front lo lee del store sin
   * importar si llegó por login o por bootstrap/resync.
   */
  tenant: TenantBlock;
  /** F7-WEB-01: mismo shape que `LoginResult.user.subscription` (patrón A1). */
  subscription: SubscriptionBlock;
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
    private readonly entitlements: EntitlementsService,
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
        select: {
          id: true,
          email: true,
          firstName: true,
          lastNamePaternal: true,
          lastNameMaternal: true,
          locale: true,
          // F3-HOME-01: el front lo necesita para preseleccionar el almacén en
          // los movimientos, y el POS de F4 para abrir el turno.
          defaultWarehouseId: true,
        },
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
      lastNamePaternal: row.lastNamePaternal,
      lastNameMaternal: row.lastNameMaternal,
      locale: row.locale,
      defaultWarehouseId: row.defaultWarehouseId,
      permissions: user.permissions,
      tenant: toTenantBlock(tenantRow),
      // F7-WEB-01: el MISMO mapper que login (patrón A1).
      subscription: toSubscriptionBlock(
        await this.entitlements.resolve(user.tenantId),
        tenantRow.timezone,
      ),
    };
  }

  async updateLocale(user: AuthUser, locale: Locale, meta: RequestMeta): Promise<UserSummary> {
    return this.updateMe(user, { locale }, meta);
  }

  /**
   * "Tus datos" editable (Carlos, 2026-08-26): PATCH /users/me acepta nombre
   * y apellidos además del locale. El email NO se toca por acá — es la
   * identidad de acceso (login + verificación) y cambiarlo exigirá su propio
   * flujo con re-verificación.
   *
   * Solo se persisten y auditan los campos PRESENTES en el dto (PATCH
   * parcial). Un cambio de solo-locale conserva su action histórico
   * `user.locale.updated`; cualquier cambio de nombre audita como
   * `user.profile.updated`.
   */
  async updateMe(user: AuthUser, dto: UpdateMeDto, meta: RequestMeta): Promise<UserSummary> {
    const fields = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<UpdateMeDto>;
    const touched = Object.keys(fields) as (keyof UpdateMeDto)[];
    const onlyLocale = touched.length === 1 && touched[0] === "locale";

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: {
          firstName: true,
          lastNamePaternal: true,
          lastNameMaternal: true,
          locale: true,
        },
      });

      const updated = await tx.user.update({
        where: { id: user.userId },
        data: fields,
      });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: onlyLocale ? "user.locale.updated" : "user.profile.updated",
        resourceType: "user",
        resourceId: user.userId,
        before: Object.fromEntries(touched.map((key) => [key, before[key]])),
        after: Object.fromEntries(touched.map((key) => [key, fields[key]])),
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
