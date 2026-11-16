import { Injectable, NotFoundException } from "@nestjs/common";
import type { Currency, Locale } from "@sellpoint/shared";
import PdfPrinter from "pdfmake";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import {
  direccionEnLinea,
  FONTS,
  renderizar,
  type Translate,
} from "../medical-clinic/medical-pdf-blocks";
import { gastosDelCajon } from "../pos/cashbox-expenses";
import { buildShiftCloseDefinition } from "./shift-pdf.renderer";
import { ShiftsReportService } from "./shifts-report.service";

/** Los turnos propios no dependen del alcance: el permiso es haberlo abierto. */
const TODOS: UserScope = { warehouseIds: "all" };

/**
 * El cierre de turno en PDF carta (Carlos, 2026-11-16), para control interno.
 *
 * Sale del MISMO detalle que la pantalla del reporte (`ShiftsReportService`),
 * con su alcance: lo que el PDF dice y lo que el reporte muestra no pueden
 * diferir. Lo pide el reporte (`reports:read`, el alcance de quien pide), la
 * caja (`pos:sell`, solo el turno que la persona abrió) y el expediente del
 * backoffice (todo el negocio).
 */
@Injectable()
export class ShiftPdfService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftsReportService,
  ) {}

  /** Desde el reporte o el backoffice: el alcance decide qué turnos existen. */
  build(user: AuthUser, scope: UserScope, id: string, locale: Locale, t: Translate) {
    return this.armar(user, scope, id, locale, t);
  }

  /**
   * Desde la caja: solo el turno que la persona abrió (y por lo tanto cerró:
   * nadie cierra el turno de otro). El de otro no existe para ella, igual que
   * fuera del alcance en el reporte.
   */
  async buildOwn(user: AuthUser, id: string, locale: Locale, t: Translate) {
    const propio = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.cashboxSession.findFirst({
        where: { id, tenantId: user.tenantId, openedBy: user.userId },
        select: { id: true },
      }),
    );
    if (propio === null) {
      throw new NotFoundException({ message: "reports.shift_not_found" });
    }
    return this.armar(user, TODOS, id, locale, t);
  }

  private async armar(
    user: AuthUser,
    scope: UserScope,
    id: string,
    locale: Locale,
    t: Translate,
  ): Promise<{ body: Buffer; filename: string }> {
    const turno = await this.shifts.detail(user, scope, id);
    const { tenant, gastos } = await this.prisma.withTenantContext(user.tenantId, async (tx) => ({
      tenant: await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: {
          name: true,
          legalName: true,
          address: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          country: true,
          phone: true,
          currency: true,
          timezone: true,
        },
      }),
      gastos: await gastosDelCajon(tx, user.tenantId, id),
    }));

    const definition = buildShiftCloseDefinition(
      {
        tenant: {
          name: tenant.name,
          legalName: tenant.legalName,
          address: direccionEnLinea(tenant),
          phone: tenant.phone,
          timezone: tenant.timezone,
          showBusinessName: true,
          showAddress: true,
          showPhone: true,
          currency: tenant.currency as Currency,
        },
        shift: {
          folio: turno.folio,
          status: turno.status,
          warehouseName: turno.warehouse.name,
          openedBy: turno.openedBy.name,
          openedAt: new Date(turno.openedAt),
          closedBy: turno.closedBy?.name ?? null,
          closedAt: turno.closedAt === null ? null : new Date(turno.closedAt),
          salesCount: turno.salesCount,
          openingCash: turno.openingCash,
          totals: turno.totals,
          cashExpenses: turno.cashExpenses,
          calculatedCash: turno.calculatedCash,
          declaredCash: turno.declaredCash,
          cashDifference: turno.cashDifference,
          closingNote: turno.closingNote,
        },
        sales: turno.sales.map((venta) => ({
          folio: venta.folio,
          createdAt: new Date(venta.createdAt),
          seller: venta.seller.name,
          paymentMethod: venta.paymentMethod,
          status: venta.status,
          total: venta.total,
        })),
        expenses: gastos.map((gasto) => ({
          folio: gasto.folio,
          description: gasto.description,
          createdBy: gasto.createdBy.name,
          total: gasto.total,
        })),
        locale,
      },
      t,
    );

    return {
      body: await renderizar(this.printer, definition),
      filename: `${t("pdf.shiftClose.filename")}-${turno.folio}.pdf`,
    };
  }
}
