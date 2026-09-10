import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { spreadsheetFilenameBase } from "../../common/spreadsheet/filenames";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ExportExpensesQuery } from "./dto/expense.dto";
import { type ExpenseSummary, ExpensesService } from "./expenses.service";

const ENCABEZADOS: Record<Locale, string[]> = {
  es: [
    "Folio",
    "Fecha",
    "Categoría",
    "Proveedor o beneficiario",
    "Descripción",
    "Referencia",
    "Almacén",
    "Monto",
    "Descuento",
    "Impuesto",
    "Total",
    "Estado",
    "Pago",
    "Método",
    "Pagado el",
    "Cuenta",
    "Vence",
    "Notas",
  ],
  en: [
    "Folio",
    "Date",
    "Category",
    "Supplier or payee",
    "Description",
    "Reference",
    "Warehouse",
    "Amount",
    "Discount",
    "Tax",
    "Total",
    "Status",
    "Payment",
    "Method",
    "Paid on",
    "Account",
    "Due",
    "Notes",
  ],
};
const HOJA: Record<Locale, string> = { es: "Gastos", en: "Expenses" };
const ESTADO: Record<Locale, Record<string, string>> = {
  es: { active: "Activo", canceled: "Anulado", pending: "Pendiente", paid: "Pagado" },
  en: { active: "Active", canceled: "Canceled", pending: "Pending", paid: "Paid" },
};
const METODO: Record<Locale, Record<string, string>> = {
  es: { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia" },
  en: { cash: "Cash", card: "Card", transfer: "Transfer" },
};

/** F9-EXP-08 — los gastos en Excel/CSV, con los mismos filtros del listado y el tope de filas. */
@Injectable()
export class ExpensesExportService {
  constructor(private readonly expenses: ExpensesService) {}

  async build(user: AuthUser, scope: UserScope, query: ExportExpensesQuery, locale: Locale = "es") {
    const { format, ...filtros } = query;
    const consulta = { ...filtros, page: 1, pageSize: 100 };
    return exportWithLimit({
      count: () => this.expenses.count(user, scope, consulta),
      rows: async () =>
        (await this.expenses.all(user, scope, consulta)).map((g) => fila(g, locale)),
      header: ENCABEZADOS[locale],
      format,
      sheetName: HOJA[locale],
      filenameBase: spreadsheetFilenameBase("gastos", locale),
    });
  }
}

function fila(g: ExpenseSummary, locale: Locale): string[] {
  return [
    g.folio,
    g.expenseDate,
    g.categoryName,
    g.supplierName ?? g.beneficiary ?? "",
    g.description,
    g.reference ?? "",
    g.warehouseName,
    g.amount,
    g.discount,
    g.taxAmount,
    g.total,
    ESTADO[locale][g.status] ?? g.status,
    ESTADO[locale][g.paymentStatus] ?? g.paymentStatus,
    g.paymentMethod === null ? "" : (METODO[locale][g.paymentMethod] ?? g.paymentMethod),
    g.paidAt === null ? "" : g.paidAt.slice(0, 10),
    g.accountRef ?? "",
    g.dueDate ?? "",
    g.notes ?? "",
  ];
}
