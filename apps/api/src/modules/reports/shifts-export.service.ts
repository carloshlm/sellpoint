import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { spreadsheetFilenameBase } from "../../common/spreadsheet/filenames";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ShiftsExportQueryDto } from "./dto/shifts-report.dto";
import { type ShiftRow, ShiftsReportService } from "./shifts-report.service";

const ENCABEZADOS: Record<Locale, string[]> = {
  es: [
    "Apertura",
    "Cierre",
    "Sucursal",
    "Abrió",
    "Cerró",
    "Efectivo",
    "Tarjeta",
    "Transferencia",
    "Ventas",
    "Fondo inicial",
    "Gastos en efectivo",
    "Calculado",
    "Contado",
    "Diferencia",
    "Nota",
  ],
  en: [
    "Opened",
    "Closed",
    "Store",
    "Opened by",
    "Closed by",
    "Cash",
    "Card",
    "Transfer",
    "Sales",
    "Opening cash",
    "Cash expenses",
    "Expected",
    "Counted",
    "Difference",
    "Note",
  ],
};
const HOJA: Record<Locale, string> = { es: "Cierres de turno", en: "Shift closes" };

/**
 * F5-SHIFT-03 — los cierres en Excel/CSV. La misma lectura que la pantalla,
 * fila por fila y con la diferencia CON SIGNO: un faltante se ve negativo,
 * que es como se lee en cualquier arqueo.
 *
 * F10-MANFIX-10: «Fondo inicial» va justo antes de «Gastos en efectivo» y de
 * «Calculado», como en la pantalla: el calculado suma el fondo y resta los
 * gastos, y las tres columnas juntas se leen como la cuenta que son.
 */
@Injectable()
export class ShiftsExportService {
  constructor(private readonly shifts: ShiftsReportService) {}

  async build(
    user: AuthUser,
    scope: UserScope,
    query: ShiftsExportQueryDto,
    locale: Locale = "es",
  ) {
    const consulta = { ...query, page: 1, pageSize: 100 };
    return exportWithLimit({
      count: () => this.shifts.count(user, scope, consulta),
      rows: async () => {
        const zona = await this.shifts.timeZone(user);
        return (await this.shifts.all(user, scope, consulta)).map((turno) => fila(turno, zona));
      },
      header: ENCABEZADOS[locale],
      format: query.format,
      sheetName: HOJA[locale],
      filenameBase: spreadsheetFilenameBase("cierres-de-turno", locale),
    });
  }
}

/**
 * «2026-09-06 17:30» en la zona del negocio: lo que se lee en una hoja. El
 * locale sueco da ese formato ISO sin tener que armarlo a mano.
 */
function fechaHoraLocal(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fila(turno: ShiftRow, timeZone: string): string[] {
  const porMetodo = (metodo: string) => turno.totals.find((t) => t.method === metodo)?.total ?? "0";
  return [
    fechaHoraLocal(turno.openedAt, timeZone),
    turno.closedAt === null ? "" : fechaHoraLocal(turno.closedAt, timeZone),
    turno.warehouse.name,
    turno.openedBy.name,
    turno.closedBy?.name ?? "",
    porMetodo("cash"),
    porMetodo("card"),
    porMetodo("transfer"),
    String(turno.salesCount),
    turno.openingCash,
    turno.cashExpenses.total,
    turno.calculatedCash ?? "",
    turno.declaredCash ?? "",
    turno.cashDifference ?? "",
    turno.closingNote ?? "",
  ];
}
