import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateTenantDto } from "./dto/update-tenant.dto";
import { TENANT_SELECT, type TenantBlock, toTenantBlock } from "./tenant.types";

/**
 * F1-WEB-ONBOARD: perfil del tenant propio (`GET/PATCH /tenants/me`,
 * `POST /tenants/me/complete-onboarding`). CERO SQL directo — mismo molde
 * que `UsersService`/`TenantsService`.
 *
 * `tenants` NO tiene RLS (design §"tenants NO lleva RLS": su `id` ES el
 * tenant, no una columna `tenant_id` — ver migración
 * `20260806171516_enable_rls_tenant_isolation`). Igual se abre
 * `withTenantContext` acá: `audit_logs` SÍ tiene RLS, y `AuditService.record`
 * exige correr dentro de una tx con `app.tenant_id` seteado.
 */
@Injectable()
export class TenantProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getProfile(actor: AuthUser): Promise<TenantBlock> {
    const row = await this.prisma.withTenantContext(actor.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: TENANT_SELECT,
      }),
    );

    return toTenantBlock(row);
  }

  async update(actor: AuthUser, dto: UpdateTenantDto, meta: RequestMeta): Promise<TenantBlock> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: actor.tenantId },
        data: dto,
        select: TENANT_SELECT,
      });

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "tenant.updated",
        resourceType: "tenant",
        resourceId: actor.tenantId,
        after: dto,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return toTenantBlock(updated);
    });
  }

  /**
   * Idempotente por construcción: escribir `onboarded: true` sobre un tenant
   * que ya lo tiene en `true` no revienta nada — mismo criterio que
   * `UsersService.updateLocale` con un locale igual al actual.
   */
  async completeOnboarding(actor: AuthUser, meta: RequestMeta): Promise<TenantBlock> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: actor.tenantId },
        data: { onboarded: true },
        select: TENANT_SELECT,
      });

      await this.auditService.record(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "tenant.onboarded",
        resourceType: "tenant",
        resourceId: actor.tenantId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return toTenantBlock(updated);
    });
  }
}
