import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  addressAsksRegion,
  isAddressRegionCode,
  isPostalCode,
  normalizePostalCode,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateTenantDto } from "./dto/update-tenant.dto";
import { TaxSettingsService } from "./tax-settings.service";
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
    private readonly taxSettings: TaxSettingsService,
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
      const data = await this.conDireccionValidada(tx, actor.tenantId, dto);
      const updated = await tx.tenant.update({
        where: { id: actor.tenantId },
        data,
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
   * F4-TAX-18 + F1-ADDR-03: la región y el código postal viajan CON el país.
   * Si el body trae país, la región es la que el body diga (o null: cambiar
   * de país nunca arrastra la región del anterior). Si trae solo región o CP,
   * se validan contra el país guardado. Una región ajena al país, o para un
   * país cuya dirección no la pide (`addressAsksRegion`: México, Canadá y
   * Estados Unidos), rebota con 422 — antes solo entraban las de Canadá y
   * Estados Unidos, porque la región nació fiscal; la de México es postal. Un
   * CP que no cumple la regla del país rebota igual, y el que cumple se
   * guarda NORMALIZADO (`M5V 3L9`, nunca `m5v3l9`). El DTO no puede decidir
   * nada de esto porque no ve el país guardado.
   */
  private async conDireccionValidada(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: UpdateTenantDto,
  ): Promise<UpdateTenantDto> {
    if (dto.country === undefined && dto.region === undefined && dto.postalCode == null) return dto;
    const country =
      dto.country ??
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { country: true } }))
        .country;
    if (
      dto.region != null &&
      !(addressAsksRegion(country) && isAddressRegionCode(country, dto.region))
    ) {
      throw new UnprocessableEntityException({ message: "tenants.tax_invalid_region" });
    }
    let data = dto.country === undefined ? dto : { ...dto, region: dto.region ?? null };
    if (dto.postalCode != null) {
      const postalCode = normalizePostalCode(country, dto.postalCode);
      if (!isPostalCode(country, postalCode)) {
        throw new UnprocessableEntityException({ message: "tenants.invalid_postal_code" });
      }
      data = { ...data, postalCode: postalCode === "" ? null : postalCode };
    }
    return data;
  }

  /**
   * Idempotente por construcción: escribir `onboarded: true` sobre un tenant
   * que ya lo tiene en `true` no revienta nada — mismo criterio que
   * `UsersService.updateLocale` con un locale igual al actual.
   */
  async completeOnboarding(actor: AuthUser, meta: RequestMeta): Promise<TenantBlock> {
    return this.prisma.withTenantContext(actor.tenantId, async (tx) => {
      // F4-TAX-19: el catálogo fiscal nace ANTES de marcar el onboarding y en
      // la misma tx — si algo falla no quedan grupos huérfanos ni un negocio
      // «incorporado» sin impuestos — y el bloque que vuelve ya trae el modo
      // sembrado. La siembra es idempotente: la segunda vez devuelve null.
      const { country, region } = await tx.tenant.findUniqueOrThrow({
        where: { id: actor.tenantId },
        select: { country: true, region: true },
      });
      const siembra = await this.taxSettings.sembrar(tx, actor.tenantId, country, region);

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
      if (siembra) {
        await this.auditService.record(tx, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: "tenant.taxes.seeded",
          resourceType: "tenant",
          resourceId: actor.tenantId,
          after: { country, region, ...siembra },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return toTenantBlock(updated);
    });
  }
}
