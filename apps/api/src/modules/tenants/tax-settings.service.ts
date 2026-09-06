import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { isRegionCode, needsRegion, resolveTaxDefaults, type TaxMode } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateTaxSettingsDto } from "./dto/tax-settings.dto";

type Tx = Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0];

export interface TaxGroupView {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Cuántos artículos (productos, servicios, estudios) lo nombran: es lo que impide borrarlo. */
  usageCount: number;
  rates: { code: string; name: string; rate: string }[];
}

export interface TaxSettingsView {
  mode: TaxMode;
  country: string | null;
  region: string | null;
  /** Solo Canadá y EE. UU.: sin región no se puede sembrar la tasa correcta. */
  needsRegion: boolean;
  /** Con ventas hechas, cambiar el modo merece una advertencia en la tarjeta (los snapshots protegen lo cobrado). */
  hasSales: boolean;
  groups: TaxGroupView[];
}

const INCLUDE_TASAS = { rates: { orderBy: { sortOrder: "asc" as const } } };

/**
 * F4-TAX-09 — el catálogo fiscal del negocio: el modo, la región y sus
 * grupos de impuesto con sus componentes. Misma llave que «Datos del
 * negocio» (`tenants:manage`), mismo molde que la configuración del ticket:
 * auditoría con antes y después.
 *
 * ── Ids estables, códigos como identidad ──────────────────────────────
 *
 * Los artículos apuntan al grupo por id. Un PUT reconoce cada grupo por su
 * `code` y lo actualiza en su lugar: los artículos siguen apuntando a la
 * misma fila. Un grupo ausente del body se DESACTIVA (deja de ofrecerse en
 * el selector, sigue cobrando lo suyo a quien lo tenga); borrar es un
 * DELETE aparte que solo procede sin artículos (409 si los hay).
 *
 * ── El default se cambia en dos sentencias ────────────────────────────
 *
 * El índice único parcial (`is_default AND is_active`) se valida fila por
 * fila: primero se apaga el default anterior, después se prende el nuevo,
 * en la misma transacción.
 */
@Injectable()
export class TaxSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async leer(tx: Tx, tenantId: string): Promise<TaxSettingsView> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { taxMode: true, country: true, region: true },
    });
    const grupos = await tx.taxGroup.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: INCLUDE_TASAS,
    });
    const usos = await this.usosPorGrupo(tx, tenantId);
    const ventas = await tx.sale.count({ where: { tenantId }, take: 1 });
    return {
      mode: tenant.taxMode as TaxMode,
      country: tenant.country,
      region: tenant.region,
      needsRegion: needsRegion(tenant.country),
      hasSales: ventas > 0,
      groups: grupos.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        isDefault: g.isDefault,
        isActive: g.isActive,
        sortOrder: g.sortOrder,
        usageCount: usos.get(g.id) ?? 0,
        rates: g.rates.map((r) => ({ code: r.code, name: r.name, rate: r.rate.toString() })),
      })),
    };
  }

  get(user: AuthUser): Promise<TaxSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, (tx) => this.leer(tx, user.tenantId));
  }

  async save(
    user: AuthUser,
    dto: UpdateTaxSettingsDto,
    meta: RequestMeta,
  ): Promise<TaxSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await this.leer(tx, user.tenantId);

      if (dto.region !== undefined) {
        if (dto.region !== null && !isRegionCode(antes.country, dto.region)) {
          throw new UnprocessableEntityException({ message: "tenants.tax_invalid_region" });
        }
      }
      if (dto.mode !== undefined || dto.region !== undefined) {
        await tx.tenant.update({
          where: { id: user.tenantId },
          data: {
            ...(dto.mode !== undefined && { taxMode: dto.mode }),
            ...(dto.region !== undefined && { region: dto.region }),
          },
        });
      }

      if (dto.groups !== undefined) {
        const codigos = dto.groups.map((g) => g.code);
        // 1) Nadie es default: el índice parcial no admite dos activos a la vez.
        await tx.taxGroup.updateMany({
          where: { tenantId: user.tenantId },
          data: { isDefault: false },
        });
        // 2) Lo que no vino, se desactiva (no se borra: puede tener artículos).
        await tx.taxGroup.updateMany({
          where: { tenantId: user.tenantId, code: { notIn: codigos } },
          data: { isActive: false },
        });
        // 3) Upsert por código, en orden: el id no cambia.
        for (const [i, g] of dto.groups.entries()) {
          const fila = await tx.taxGroup.upsert({
            where: { tenantId_code: { tenantId: user.tenantId, code: g.code } },
            create: {
              tenantId: user.tenantId,
              code: g.code,
              name: g.name,
              isDefault: g.isDefault,
              isActive: g.isActive,
              sortOrder: i,
            },
            update: { name: g.name, isDefault: g.isDefault, isActive: g.isActive, sortOrder: i },
          });
          // Los componentes se reemplazan: nadie los referencia por id (la
          // venta copia sus valores en `sale_taxes`).
          await tx.taxRate.deleteMany({ where: { taxGroupId: fila.id } });
          if (g.rates.length > 0) {
            await tx.taxRate.createMany({
              data: g.rates.map((r, j) => ({
                tenantId: user.tenantId,
                taxGroupId: fila.id,
                code: r.code,
                name: r.name,
                rate: r.rate,
                sortOrder: j,
              })),
            });
          }
        }
      }

      const despues = await this.leer(tx, user.tenantId);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "tenant.tax_settings.update",
        resourceType: "tax_settings",
        resourceId: user.tenantId,
        before: sinUsos(antes),
        after: sinUsos(despues),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return despues;
    });
  }

  async removeGroup(user: AuthUser, code: string, meta: RequestMeta): Promise<TaxSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const antes = await this.leer(tx, user.tenantId);
      const grupo = antes.groups.find((g) => g.code === code);
      if (grupo === undefined) {
        throw new UnprocessableEntityException({ message: "tenants.tax_group_unknown" });
      }
      if (grupo.usageCount > 0) {
        throw new ConflictException({
          message: "tenants.tax_group_in_use",
          args: { count: grupo.usageCount },
        });
      }
      if (grupo.isDefault && grupo.isActive) {
        throw new ConflictException({ message: "tenants.tax_group_is_default" });
      }
      await tx.taxGroup.delete({ where: { id: grupo.id } });
      const despues = await this.leer(tx, user.tenantId);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "tenant.tax_settings.update",
        resourceType: "tax_settings",
        resourceId: user.tenantId,
        before: sinUsos(antes),
        after: sinUsos(despues),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return despues;
    });
  }

  /**
   * Siembra el catálogo del país (y la región) si el negocio no tiene ninguno.
   * Idempotente: con grupos, no hace nada y devuelve `null`; si siembra,
   * devuelve el modo y los códigos para que quien llama lo audite. Se llama
   * dentro de la transacción de quien termina el onboarding (F4-TAX-19).
   */
  async sembrar(
    tx: Tx,
    tenantId: string,
    country: string | null,
    region: string | null,
  ): Promise<{ mode: TaxMode; codes: string[] } | null> {
    if ((await tx.taxGroup.count({ where: { tenantId } })) > 0) return null;
    const defaults = resolveTaxDefaults(country, region);
    await tx.tenant.update({ where: { id: tenantId }, data: { taxMode: defaults.mode } });
    for (const [i, g] of defaults.groups.entries()) {
      await tx.taxGroup.create({
        data: {
          tenantId,
          code: g.code,
          name: g.name,
          isDefault: g.isDefault,
          sortOrder: i,
          rates: {
            create: g.rates.map((r, j) => ({
              tenantId,
              code: r.code,
              name: r.name,
              rate: r.rate,
              sortOrder: j,
            })),
          },
        },
      });
    }
    return { mode: defaults.mode, codes: defaults.groups.map((g) => g.code) };
  }

  /** Un solo viaje: cuántos artículos de cada catálogo nombran cada grupo. */
  private async usosPorGrupo(tx: Tx, tenantId: string): Promise<Map<string, number>> {
    const filas = await tx.$queryRaw<{ tax_group_id: string; n: number }[]>`
      SELECT u.tax_group_id, COUNT(*)::int AS n
        FROM (
          SELECT tax_group_id FROM products WHERE tenant_id = ${tenantId}::uuid AND tax_group_id IS NOT NULL
          UNION ALL
          SELECT tax_group_id FROM services WHERE tenant_id = ${tenantId}::uuid AND tax_group_id IS NOT NULL
          UNION ALL
          SELECT tax_group_id FROM medical_clinic_lab_studies WHERE tenant_id = ${tenantId}::uuid AND tax_group_id IS NOT NULL
          UNION ALL
          SELECT tax_group_id FROM medical_clinic_diagnostic_studies WHERE tenant_id = ${tenantId}::uuid AND tax_group_id IS NOT NULL
        ) AS u
       GROUP BY u.tax_group_id`;
    return new Map(filas.map((f) => [f.tax_group_id, Number(f.n)]));
  }
}

/** La auditoría guarda el catálogo, no cuántos artículos lo usan (eso cambia solo). */
function sinUsos(v: TaxSettingsView) {
  return {
    mode: v.mode,
    region: v.region,
    groups: v.groups.map(({ usageCount: _usos, ...g }) => g),
  };
}
