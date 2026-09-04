import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type DashboardPeriod, resolvePeriodWindow } from "../reports/dashboard-period";

export interface TopItem {
  /** El id del CATÁLOGO: un estudio renombrado sigue siendo la misma fila. */
  id: string;
  code: string;
  name: string;
  units: string;
  revenue: string;
}

export interface ClinicTop {
  medications: TopItem[];
  labStudies: TopItem[];
  diagnosticStudies: TopItem[];
}

/** Cinco por lista: un top que no cabe de un vistazo deja de ser un top. */
const LIMITE = 5;

/**
 * F9-CLINIC-30 — lo más vendido del consultorio, por tipo.
 *
 * Sale de la VISTA `medical_clinic_sold_items` (F9-CLINIC-29), que ya une la
 * venta real con las líneas de la orden y con los catálogos propios. Dos
 * reglas la sostienen:
 *
 *  - **Se agrupa por ID de catálogo**, jamás por nombre. El top general del
 *    POS agrupa los conceptos por su descripción y por eso funde dos estudios
 *    homónimos y parte en dos uno renombrado; acá el nombre se lee del
 *    catálogo VIGENTE al consultar, así que renombrar arregla el histórico en
 *    vez de romperlo.
 *  - **Una venta anulada no cuenta.** Anular es decir «esto no pasó», y la
 *    vista deja ver el estado para poder filtrarlo acá.
 *
 * Los medicamentos salen aparte del top general de productos a propósito: el
 * dueño quiere saber qué RECETA su médico, que no es lo mismo que qué vende
 * su mostrador.
 */
@Injectable()
export class MedicalClinicDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async top(user: AuthUser, period: DashboardPeriod): Promise<ClinicTop> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    const { desde, hasta } = resolvePeriodWindow(
      period,
      tenant?.timezone ?? "UTC",
      this.clock.now(),
    );

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [medications, labStudies, diagnosticStudies] = [
        await tx.$queryRaw<TopItem[]>`
          SELECT v.product_id::text AS id,
                 p.sku              AS code,
                 p.name             AS name,
                 SUM(v.quantity)::text   AS units,
                 SUM(v.line_total)::text AS revenue
            FROM medical_clinic_sold_items v
            JOIN products p ON p.id = v.product_id
           WHERE v.sale_status = 'completed'
             AND v.sold_at >= ${desde} AND v.sold_at < ${hasta}
           GROUP BY v.product_id, p.sku, p.name
           ORDER BY SUM(v.quantity) DESC
           LIMIT ${LIMITE}`,
        await tx.$queryRaw<TopItem[]>`
          SELECT v.lab_study_id::text AS id,
                 e.code               AS code,
                 e.name               AS name,
                 SUM(v.quantity)::text   AS units,
                 SUM(v.line_total)::text AS revenue
            FROM medical_clinic_sold_items v
            JOIN medical_clinic_lab_studies e ON e.id = v.lab_study_id
           WHERE v.sale_status = 'completed'
             AND v.sold_at >= ${desde} AND v.sold_at < ${hasta}
           GROUP BY v.lab_study_id, e.code, e.name
           ORDER BY SUM(v.quantity) DESC
           LIMIT ${LIMITE}`,
        await tx.$queryRaw<TopItem[]>`
          SELECT v.diagnostic_study_id::text AS id,
                 e.code                      AS code,
                 e.name                      AS name,
                 SUM(v.quantity)::text   AS units,
                 SUM(v.line_total)::text AS revenue
            FROM medical_clinic_sold_items v
            JOIN medical_clinic_diagnostic_studies e ON e.id = v.diagnostic_study_id
           WHERE v.sale_status = 'completed'
             AND v.sold_at >= ${desde} AND v.sold_at < ${hasta}
           GROUP BY v.diagnostic_study_id, e.code, e.name
           ORDER BY SUM(v.quantity) DESC
           LIMIT ${LIMITE}`,
      ];
      return { medications, labStudies, diagnosticStudies };
    });
  }
}
