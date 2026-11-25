import { Injectable } from "@nestjs/common";
import { getUnit, type Locale, unitName } from "@sellpoint/shared";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import { columnIndexes } from "../../common/spreadsheet/spreadsheet";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ItemsExportQueryDto, ItemsReportView } from "./dto/items-report.dto";
import type { SoldItemKind } from "./items-ranking.service";
import { type ItemsReportRow, ItemsReportService } from "./items-report.service";
import { formatExportQuantity } from "./kardex-export.service";

/** Las columnas, en el orden de la pantalla. Las mismas en las tres vistas. */
const ENCABEZADOS: Record<Locale, string[]> = {
  es: [
    "Tipo",
    "Código",
    "Artículo",
    "Cantidad",
    "Unidad",
    "Venta sin impuesto",
    "Costo",
    "Utilidad",
    "Margen %",
  ],
  en: [
    "Type",
    "Code",
    "Item",
    "Quantity",
    "Unit",
    "Sales before tax",
    "Cost",
    "Profit",
    "Margin %",
  ],
};

/** Las que van como NÚMERO en el xlsx; el tipo, el código y la unidad quedan como texto. */
const NUMERICAS: Record<Locale, string[]> = {
  es: ["Cantidad", "Venta sin impuesto", "Costo", "Utilidad", "Margen %"],
  en: ["Quantity", "Sales before tax", "Cost", "Profit", "Margin %"],
};

const TIPO: Record<SoldItemKind, Record<Locale, string>> = {
  product: { es: "Producto", en: "Product" },
  service: { es: "Servicio", en: "Service" },
  concept: { es: "Concepto", en: "Concept" },
};

const HOJA: Record<ItemsReportView, Record<Locale, string>> = {
  "top-sold": { es: "Más vendidos", en: "Top sellers" },
  "top-profit": { es: "Mayor utilidad", en: "Top profit" },
  "below-cost": { es: "Vendidos bajo su costo", en: "Sold below cost" },
};

const ARCHIVO: Record<ItemsReportView, Record<Locale, string>> = {
  "top-sold": { es: "mas-vendidos", en: "top-sellers" },
  "top-profit": { es: "mayor-utilidad", en: "top-profit" },
  "below-cost": { es: "vendidos-bajo-su-costo", en: "sold-below-cost" },
};

/**
 * F10-RPT-03 — el reporte por artículo en Excel o CSV: los MISMOS artículos,
 * en el mismo orden y con los mismos filtros que la pantalla, sin paginar.
 *
 * La **cantidad va como número** en la unidad base, y la unidad aparte con su
 * nombre («Kilogramo»): 2.5 en una celda se suma; «2.5 kg» no. Sin costo, las
 * celdas de costo, utilidad y margen quedan VACÍAS: un 0 se sumaría como dato.
 */
@Injectable()
export class ItemsReportExportService {
  constructor(private readonly items: ItemsReportService) {}

  async build(user: AuthUser, scope: UserScope, query: ItemsExportQueryDto, locale: Locale = "es") {
    const { format, ...filters } = query;
    const header = ENCABEZADOS[locale];
    return exportWithLimit({
      count: () => this.items.count(user, scope, filters),
      rows: async () =>
        (await this.items.all(user, scope, filters)).map((fila) => aCeldas(fila, locale)),
      header,
      numericColumns: columnIndexes(header, NUMERICAS[locale]),
      format,
      sheetName: HOJA[query.view][locale],
      filenameBase: ARCHIVO[query.view][locale],
    });
  }
}

function aCeldas(fila: ItemsReportRow, locale: Locale): string[] {
  // Sin decimales en lo que se cuenta; con los suyos en lo que se pesa o se mide.
  const seCuenta = fila.baseUnit === null || getUnit(fila.baseUnit)?.category === "count";
  return [
    TIPO[fila.kind][locale],
    fila.code ?? "",
    fila.name,
    formatExportQuantity(fila.quantity, seCuenta),
    fila.baseUnit === null ? "" : unitName(fila.baseUnit, locale),
    fila.revenue,
    fila.cost ?? "",
    fila.profit ?? "",
    fila.margin === null ? "" : String(fila.margin),
  ];
}
