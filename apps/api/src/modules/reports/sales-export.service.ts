import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { spreadsheetFilenameBase } from "../../common/spreadsheet/filenames";
import { Prisma } from "../../generated/prisma/client";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { SalesExportQueryDto } from "./dto/sales-report.dto";
import { SalesReportService } from "./sales-report.service";

const SIN_PAGINAR = { page: 1, pageSize: 100 } as const;

const METODOS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

/**
 * F5-SALES-02 — el reporte de ventas en Excel.
 *
 * El **código de barras va segundo**, pegado al folio, igual que en la
 * pantalla del historial: las dos columnas contestan la misma pregunta —«cuál
 * venta es ésta»— y el archivo tiene que contar la misma historia que la
 * pantalla. Las ventas anteriores al campo dejan la celda VACÍA.
 *
 * Las **anuladas se exportan MARCADAS, no se omiten**: el criterio de F4-UI-03
 * —el filtro existe para acotar, no para tapar— vale igual en el papel. Quien
 * audita necesita ver la anulada justo cuando busca por qué no cuadra.
 */
@Injectable()
export class SalesExportService {
  constructor(private readonly sales: SalesReportService) {}

  async build(user: AuthUser, scope: UserScope, query: SalesExportQueryDto, locale: Locale = "es") {
    return exportWithLimit({
      count: () => this.sales.count(user, scope, { ...query, ...SIN_PAGINAR }),
      rows: () => this.filas(user, scope, query),
      header: [
        "Folio",
        "Código de barras",
        "Fecha",
        "Vendió",
        "Almacén",
        "Estado",
        "Pago",
        // F4-TAX-21: neto e impuesto al lado del total, para que el archivo
        // cuadre contra el reporte de impuestos sin restar a mano.
        "Neto",
        "Impuesto",
        "Total",
      ],
      format: query.format,
      sheetName: "Ventas",
      filenameBase: spreadsheetFilenameBase("ventas", locale),
    });
  }

  private async filas(user: AuthUser, scope: UserScope, query: SalesExportQueryDto) {
    const acumulado: string[][] = [];
    let page = 1;
    while (true) {
      const { rows, total } = await this.sales.list(user, scope, {
        ...query,
        ...SIN_PAGINAR,
        page,
      });
      acumulado.push(
        ...rows.map((venta) => [
          venta.folio,
          // Vacío y no un guion: la celda vacía de una hoja de cálculo YA
          // significa «no hay dato», y un guion sería texto que ensucia
          // cualquier filtro o tabla dinámica que alguien arme encima.
          venta.barcode ?? "",
          venta.createdAt.slice(0, 10),
          venta.seller.name,
          venta.warehouse.name,
          venta.status === "canceled" ? "Anulada" : "Cobrada",
          METODOS[venta.paymentMethod] ?? venta.paymentMethod,
          new Prisma.Decimal(venta.total).minus(venta.taxTotal).toString(),
          venta.taxTotal,
          venta.total,
        ]),
      );
      if (acumulado.length >= total || rows.length === 0) {
        return acumulado;
      }
      page += 1;
    }
  }
}
