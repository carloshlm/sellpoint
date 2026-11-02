import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { columnIndexes } from "../../common/spreadsheet/spreadsheet";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { SalesLinesExportQueryDto } from "./dto/sales-report.dto";
import { formatExportQuantity } from "./kardex-export.service";
import {
  type SaleLineKind,
  type SalesLineRow,
  SalesLinesReportService,
} from "./sales-lines-report.service";
import { fechaHoraLocal } from "./shifts-export.service";

/**
 * Las columnas, en el orden de la pantalla. «Por producto» lleva sus DOS
 * códigos: hay productos sin código de barras y el interno los identifica
 * igual (Carlos, 2026-11-02).
 */
const ENCABEZADOS: Record<SaleLineKind, Record<Locale, string[]>> = {
  product: {
    es: [
      "Fecha",
      "Folio",
      "Vendió",
      "Sucursal",
      "Código interno",
      "Código de barras",
      "Producto",
      "Cantidad",
      "Precio unitario",
      "Impuesto",
      "Total",
    ],
    en: [
      "Date",
      "Receipt number",
      "Sold by",
      "Store",
      "Internal code",
      "Barcode",
      "Product",
      "Quantity",
      "Price",
      "Tax",
      "Total",
    ],
  },
  service: {
    es: [
      "Fecha",
      "Folio",
      "Vendió",
      "Sucursal",
      "Código",
      "Servicio",
      "Cantidad",
      "Precio unitario",
      "Impuesto",
      "Total",
    ],
    en: [
      "Date",
      "Receipt number",
      "Sold by",
      "Store",
      "Code",
      "Service",
      "Quantity",
      "Price",
      "Tax",
      "Total",
    ],
  },
};

/** Las que van como NÚMERO en el xlsx; los códigos, el folio y la fecha quedan como texto. */
const NUMERICAS: Record<Locale, string[]> = {
  es: ["Cantidad", "Precio unitario", "Impuesto", "Total"],
  en: ["Quantity", "Price", "Tax", "Total"],
};

const HOJA: Record<SaleLineKind, Record<Locale, string>> = {
  product: { es: "Ventas por producto", en: "Sales by product" },
  service: { es: "Ventas por servicio", en: "Sales by service" },
};

const ARCHIVO: Record<SaleLineKind, Record<Locale, string>> = {
  product: { es: "ventas-por-producto", en: "sales-by-product" },
  service: { es: "ventas-por-servicio", en: "sales-by-service" },
};

/**
 * «Ventas por producto» y «Ventas por servicio» en Excel: las MISMAS líneas y
 * columnas que la pantalla, con los mismos filtros. Sin columna de estado:
 * los dos reportes listan solo lo cobrado, así que no hay anuladas que
 * distinguir y la suma del Total cuadra contra el pie.
 *
 * La **Cantidad va como número** en la unidad en que se vendió —la misma del
 * Precio unitario—, para que Excel la sume y multiplique. La pantalla, en
 * cambio, la escribe como el ticket («1 Caja ×12 (12 piezas)»).
 */
@Injectable()
export class SalesLinesExportService {
  constructor(private readonly lines: SalesLinesReportService) {}

  async build(
    user: AuthUser,
    scope: UserScope,
    query: SalesLinesExportQueryDto,
    kind: SaleLineKind,
    locale: Locale = "es",
  ) {
    const consulta = { ...query, page: 1, pageSize: 100 };
    const header = ENCABEZADOS[kind][locale];
    return exportWithLimit({
      count: () => this.lines.count(user, scope, consulta, kind),
      rows: async () => {
        const zona = await this.lines.timeZone(user);
        return (await this.lines.all(user, scope, consulta, kind)).map((linea) =>
          fila(linea, kind, zona),
        );
      },
      header,
      numericColumns: columnIndexes(header, NUMERICAS[locale]),
      format: query.format,
      sheetName: HOJA[kind][locale],
      filenameBase: ARCHIVO[kind][locale],
    });
  }
}

function fila(linea: SalesLineRow, kind: SaleLineKind, timeZone: string): string[] {
  // Vacío y no un guion: la celda vacía de una hoja de cálculo YA significa
  // «no hay dato» (mismo criterio que el código de barras de Ventas).
  const codigos = kind === "product" ? [linea.code ?? "", linea.barcode ?? ""] : [linea.code ?? ""];
  return [
    fechaHoraLocal(linea.createdAt, timeZone),
    linea.folio,
    linea.seller.name,
    linea.warehouse.name,
    ...codigos,
    linea.name,
    // Sin decimales en lo que se vende por pieza; con dos en lo que se pesa.
    formatExportQuantity(linea.quantity, linea.presentation?.allowFractionalInput !== true),
    linea.unitPrice,
    linea.taxAmount,
    linea.lineTotal,
  ];
}
