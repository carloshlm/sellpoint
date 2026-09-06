import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { spreadsheetFilenameBase } from "../../common/spreadsheet/filenames";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { TaxExportQueryDto } from "./dto/tax-report.dto";
import { TaxReportService } from "./tax-report.service";

const ENCABEZADOS: Record<Locale, string[]> = {
  es: ["Impuesto", "Tasa %", "Base", "Impuesto cobrado", "Tickets"],
  en: ["Tax", "Rate %", "Base", "Tax collected", "Tickets"],
};
const HOJA: Record<Locale, string> = { es: "Impuestos", en: "Taxes" };

/**
 * F4-TAX-21 — el reporte de impuestos en Excel/CSV: las MISMAS filas que la
 * pantalla, un renglón por componente y tasa. Es lo que se le entrega al
 * contador.
 */
@Injectable()
export class TaxExportService {
  constructor(private readonly taxes: TaxReportService) {}

  async build(user: AuthUser, scope: UserScope, query: TaxExportQueryDto, locale: Locale = "es") {
    const reporte = () => this.taxes.report(user, scope, query);
    return exportWithLimit({
      count: async () => (await reporte()).rows.length,
      rows: async () =>
        (await reporte()).rows.map((f) => [f.name, f.rate, f.base, f.amount, String(f.tickets)]),
      header: ENCABEZADOS[locale],
      format: query.format,
      sheetName: HOJA[locale],
      filenameBase: spreadsheetFilenameBase("impuestos", locale),
    });
  }
}
