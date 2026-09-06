import { Injectable } from "@nestjs/common";
import { endOfDayUtc, startOfDayUtc } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";
import type { TaxReportQueryDto } from "./dto/tax-report.dto";

/** Un componente (GST, PST, IVA…) con lo que juntó en el período. */
export interface TaxReportRow {
  code: string;
  name: string;
  /** Tasa en %, sin ceros de relleno («5», «9.975»). */
  rate: string;
  base: string;
  amount: string;
  tickets: number;
}

/** El pie: las ventas cobradas del período, brutas, netas y su impuesto. */
export interface TaxReportTotals {
  gross: string;
  net: string;
  tax: string;
  tickets: number;
}

export interface TaxReport {
  rows: TaxReportRow[];
  totals: TaxReportTotals;
}

/**
 * F4-TAX-21 — el reporte de impuestos cobrados: lo que el negocio declara.
 *
 * Lee `sale_taxes`, el snapshot por componente que dejó cada cobro, y lo
 * agrupa por código, nombre y tasa: si una tasa cambió a mitad de mes salen
 * DOS renglones, que es lo que la declaración necesita. SOLO ventas
 * `completed`: una anulada es plata que no entró, igual que en la caja. El
 * pie va sobre `sales` (bruto, neto = total − tax_total, impuesto) y cuenta
 * también las ventas sin impuesto: el neto declarado incluye lo exento.
 *
 * Mismo alcance que Ventas: `UserScope` siempre viaja, y pedir un almacén
 * fuera de él es 403, no una lista vacía.
 */
@Injectable()
export class TaxReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(user: AuthUser, scope: UserScope, query: TaxReportQueryDto): Promise<TaxReport> {
    if (query.warehouseId !== undefined) {
      assertWarehouseInScope(scope, query.warehouseId);
    }
    const timeZone = await this.timeZone(user);
    const desde = query.from === undefined ? null : startOfDayUtc(query.from, timeZone);
    const hasta = query.to === undefined ? null : endOfDayUtc(query.to, timeZone);
    const almacenes =
      query.warehouseId !== undefined
        ? [query.warehouseId]
        : scope.warehouseIds === "all"
          ? null
          : [...scope.warehouseIds];

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const filas = await tx.$queryRaw<
        {
          code: string;
          name: string;
          rate: string;
          base: string;
          amount: string;
          tickets: number;
        }[]
      >`
        SELECT t.code,
               t.name,
               t.rate::text AS rate,
               SUM(t.base)::numeric(14,2)::text   AS base,
               SUM(t.amount)::numeric(14,2)::text AS amount,
               COUNT(DISTINCT t.sale_id)::int     AS tickets
          FROM sale_taxes t
          JOIN sales s ON s.id = t.sale_id
         WHERE s.tenant_id = ${user.tenantId}::uuid
           AND s.status = 'completed'
           AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
           AND (${desde}::timestamptz IS NULL OR s.created_at >= ${desde}::timestamptz)
           AND (${hasta}::timestamptz IS NULL OR s.created_at < ${hasta}::timestamptz)
         GROUP BY t.code, t.name, t.rate
         ORDER BY MIN(t.sort_order), t.code, t.rate`;
      const [pie] = await tx.$queryRaw<
        { gross: string; net: string; tax: string; tickets: number }[]
      >`
        SELECT COALESCE(SUM(s.total), 0)::numeric(14,2)::text               AS gross,
               COALESCE(SUM(s.total - s.tax_total), 0)::numeric(14,2)::text AS net,
               COALESCE(SUM(s.tax_total), 0)::numeric(14,2)::text           AS tax,
               COUNT(*)::int                                                AS tickets
          FROM sales s
         WHERE s.tenant_id = ${user.tenantId}::uuid
           AND s.status = 'completed'
           AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
           AND (${desde}::timestamptz IS NULL OR s.created_at >= ${desde}::timestamptz)
           AND (${hasta}::timestamptz IS NULL OR s.created_at < ${hasta}::timestamptz)`;
      return {
        rows: filas.map((f) => ({
          code: f.code,
          name: f.name,
          rate: new Prisma.Decimal(f.rate).toString(),
          base: f.base,
          amount: f.amount,
          tickets: Number(f.tickets),
        })),
        totals: {
          gross: pie?.gross ?? "0.00",
          net: pie?.net ?? "0.00",
          tax: pie?.tax ?? "0.00",
          tickets: Number(pie?.tickets ?? 0),
        },
      };
    });
  }

  /** La zona del negocio: el rango de fechas la necesita. */
  private async timeZone(user: AuthUser): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }
}
