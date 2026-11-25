import { api } from "@/lib/api";
// Solo el tipo: el panel y el reporte por artículo hablan del mismo artículo.
import type { SoldItemKind } from "@/lib/dashboard/api";
import { descargarBlob, nombreDeDescarga } from "@/lib/download";
// Solo el tipo: el movimiento de efectivo es UNA fila, la misma que lee el
// punto de venta (contrato L5 de F10-CASHMOV), y no se duplica aquí.
import type { CashMovement } from "@/lib/pos/api";

/**
 * Los exports DIRECTOS del hub (F5-CAT): bajan el archivo sin abrir pantalla.
 *
 * Siempre `responseType: "blob"` y con axios —no con un `<a href>`— porque el
 * endpoint exige el Bearer y un enlace plano viajaría sin token.
 */
export type ReportFormat = "csv" | "xlsx";

// ─────────────────────────────────────────────────────────────────────────
// Las consultas de pantalla (F5-STK-04 / F5-SALES-03)
// ─────────────────────────────────────────────────────────────────────────

export interface StockReportRow {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  stockMin: string;
  totalQuantity: string;
  belowMin: boolean;
  /** `null` cuando el producto nunca se compró: ver `WeightedCostService`. */
  avgCost: string | null;
  /** Los del catálogo por unidad base; `null` si no están capturados. */
  catalogCost: string | null;
  catalogPrice: string | null;
  /** El precio del catálogo por la cantidad; `null` sin precio. */
  valueAtPrice: string | null;
  /** Solo con `detail=lots`. */
  lotCode?: string;
  expiresAt?: string | null;
  location?: string;
  /**
   * Solo con `detail=lots`: la fila de lo que el producto tiene SIN lote en
   * esa sucursal (Carlos, 2026-10-31). Llega con `lotCode` vacío.
   */
  unlotted?: boolean;
}

export interface StockReportQuery {
  warehouseId?: string;
  belowMin?: boolean;
  /** F10-OUTSTK: con mínimo y en cero (la regla del mosaico «Agotados»). */
  outOfStock?: boolean;
  search?: string;
  detail?: "lots";
  page?: number;
  pageSize?: number;
}

export interface StockReportPage {
  rows: StockReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getStockReport(
  query: StockReportQuery,
  basePath = "/reports",
): Promise<StockReportPage> {
  const { data } = await api.get<StockReportPage>(`${basePath}/stock`, { params: query });
  return data;
}

export interface SalesReportRow {
  id: string;
  folio: string;
  barcode: string | null;
  createdAt: string;
  status: string;
  paymentMethod: string;
  total: string;
  /** F4-TAX-21: el impuesto que viaja dentro del total (0 en ventas de antes del módulo). */
  taxTotal: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
  /**
   * F10-KPI-11: el descuento TOTAL de la venta (líneas más ticket), con dos
   * decimales. Este campo y los cuatro siguientes son opcionales: durante un
   * deploy, este web puede hablar con un API anterior que no los manda.
   */
  discount?: string;
  discountReason?: string | null;
  cancelReason?: string | null;
  canceledAt?: string | null;
  canceledBy?: { id: string; name: string } | null;
}

export interface SalesReportQuery {
  warehouseId?: string;
  from?: string;
  to?: string;
  folio?: string;
  status?: "completed" | "canceled";
  /** F10-KPI-11: solo las ventas con descuento. */
  discounted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SalesReportPage {
  rows: SalesReportRow[];
  /** Del PERÍODO entero, no de la página: es el pie de la tabla. */
  totals: { paymentMethod: string; total: string }[];
  total: number;
  page: number;
  pageSize: number;
  /** F10-KPI-11: lo que se fue en descuentos en el periodo, solo de lo cobrado. */
  discountTotal?: string;
}

export async function getSalesReport(
  query: SalesReportQuery,
  basePath = "/reports",
): Promise<SalesReportPage> {
  const { data } = await api.get<SalesReportPage>(`${basePath}/sales`, { params: query });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// Ventas por producto y por servicio: una línea de ticket por renglón
// ─────────────────────────────────────────────────────────────────────────

/** Qué líneas lee el reporte; es lo único que cambia entre las dos pantallas. */
export type SalesLineKind = "product" | "service";

export interface SalesLineRow {
  id: string;
  saleId: string;
  folio: string;
  createdAt: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
  /** El código interno del producto (`sku`) o el código del servicio. */
  code: string | null;
  /** El de la presentación vendida; null en servicios y en productos sin código. */
  barcode: string | null;
  name: string;
  /** En la presentación vendida, como la tecleó el cajero. */
  quantity: string;
  /** Null en un servicio, que no tiene unidad. */
  baseUnit: string | null;
  presentation: { name: string; factor: string; allowFractionalInput: boolean } | null;
  unitPrice: string;
  taxAmount: string;
  /** Lo que cobró la línea: después de su descuento y de su parte del del ticket. */
  lineTotal: string;
}

/**
 * Los filtros de Ventas SIN el estado: estos dos reportes listan solo lo
 * cobrado y su API responde 400 si llega `status`. Tampoco llevan
 * `discounted`: el descuento es del ticket, no de la línea.
 */
export type SalesLinesQuery = Omit<SalesReportQuery, "status" | "discounted">;

export interface SalesLinesPage {
  rows: SalesLineRow[];
  /** Del PERÍODO entero; null cuando no hay nada cobrado. */
  totals: { tax: string; total: string } | null;
  total: number;
  page: number;
  pageSize: number;
}

const RUTA_DE_LINEAS: Record<SalesLineKind, string> = {
  product: "/sales-by-product",
  service: "/sales-by-service",
};

/**
 * Los filtros de Ventas menos el estado (`SalesLinesQuery`). `basePath` es el
 * de los reportes del negocio mirado cuando se lee desde el backoffice.
 */
export async function getSalesLinesReport(
  kind: SalesLineKind,
  query: SalesLinesQuery,
  basePath = "/reports",
): Promise<SalesLinesPage> {
  const { data } = await api.get<SalesLinesPage>(`${basePath}${RUTA_DE_LINEAS[kind]}`, {
    params: query,
  });
  return data;
}

async function bajar(
  ruta: string,
  base: string,
  format: ReportFormat,
  // Genérico y no `Record<string, unknown>`: las interfaces con claves fijas
  // no encajan en un índice de string, y forzarlo con un cast escondería un
  // typo en el nombre de un filtro justo donde importa —el archivo saldría
  // sin filtrar y en silencio—.
  filtros: object = {},
): Promise<void> {
  const { data, headers } = await api.get<Blob>(ruta, {
    params: { ...filtros, format },
    responseType: "blob",
  });
  await descargarBlob(data, nombreDeDescarga(headers, `${base}.${format}`));
}

export function downloadUsersReport(format: ReportFormat = "xlsx"): Promise<void> {
  return bajar("/reports/users/export", "usuarios", format);
}

export function downloadWarehousesReport(format: ReportFormat = "xlsx"): Promise<void> {
  return bajar("/reports/warehouses/export", "almacenes", format);
}

export function downloadCatalogReport(format: ReportFormat = "xlsx"): Promise<void> {
  return bajar("/reports/products/export", "catalogo", format);
}

/**
 * Los exports de las dos pantallas.
 *
 * Reciben los MISMOS filtros que la consulta: si el archivo ignorara los
 * filtros vigentes, traería el universo entero mientras la pantalla muestra
 * tres filas — y nadie lo notaría hasta abrirlo.
 */
export function downloadStockReport(
  query: StockReportQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  const base = query.detail === "lots" ? "stock-por-lote" : "stock";
  return bajar(`${basePath}/stock/export`, base, format, query);
}

/** F5-SHIFT — los cierres de turno: lo que el cierre guardó, con sus ventas. */
export interface ShiftTotal {
  method: string;
  total: string;
  count: number;
}

export interface ShiftRow {
  id: string;
  /** `TUR-000001`: el folio que el turno tomó al abrir (Carlos, 2026-11-16). */
  folio: string;
  status: "open" | "closed";
  warehouse: { id: string; name: string };
  openedBy: { id: string; name: string };
  openedAt: string;
  closedBy: { id: string; name: string } | null;
  closedAt: string | null;
  salesCount: number;
  totals: ShiftTotal[];
  /** F10-MANFIX-10: el fondo con que abrió el turno («0» sin fondo); el calculado ya lo suma. */
  openingCash: string;
  /** F9-EXP-09: los gastos en efectivo que salieron del cajón; el calculado ya los resta. */
  cashExpenses: { total: string; count: number };
  calculatedCash: string | null;
  declaredCash: string | null;
  cashDifference: string | null;
  closingNote: string | null;
  /**
   * F10-CASHMOV-06 — el efectivo que entró y el que salió del cajón sin una
   * venta (solo los movimientos activos; «0» sin ninguno). El calculado ya los
   * cuenta. Opcionales: un API anterior no los manda.
   */
  cashIn?: string;
  cashOut?: string;
}

export interface ShiftSaleRow {
  id: string;
  folio: string;
  createdAt: string;
  seller: { id: string; name: string };
  paymentMethod: string;
  status: string;
  total: string;
}

export interface ShiftDetail extends ShiftRow {
  sales: ShiftSaleRow[];
  /**
   * F10-CASHMOV-06 — las entradas y los retiros del turno, del más viejo al
   * más nuevo, con los anulados incluidos. La misma fila que lee el punto de
   * venta. Opcional: un API anterior no la manda.
   */
  movements?: CashMovement[];
}

/** F10-KPI-13: los cierres con faltante, con sobrante o que cuadraron. */
export type ShiftDifference = "shortage" | "overage" | "balanced";

export interface ShiftsReportQuery {
  /** El folio, completo o un pedazo: busca en todas las fechas y estados. */
  search?: string;
  warehouseId?: string;
  userId?: string;
  status?: "open" | "closed";
  difference?: ShiftDifference;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ShiftsReportPage {
  rows: ShiftRow[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * F10-KPI-13: cuánto faltó y cuánto sobró en el periodo, en positivo y por
   * separado. Opcional: un API anterior no lo manda.
   */
  differenceTotals?: { shortage: string; overage: string };
}

export async function getShiftsReport(
  query: ShiftsReportQuery,
  basePath = "/reports",
): Promise<ShiftsReportPage> {
  const { data } = await api.get<ShiftsReportPage>(`${basePath}/shifts`, { params: query });
  return data;
}

export async function getShiftDetail(id: string, basePath = "/reports"): Promise<ShiftDetail> {
  const { data } = await api.get<ShiftDetail>(`${basePath}/shifts/${id}`);
  return data;
}

/**
 * El cierre de UN turno en PDF carta (Carlos, 2026-11-16). `basePath` es el
 * del negocio mirado cuando se baja desde el expediente del backoffice.
 */
export async function downloadShiftPdf(
  id: string,
  folio: string,
  basePath = "/reports",
): Promise<void> {
  const { data, headers } = await api.get<Blob>(`${basePath}/shifts/${id}/pdf`, {
    responseType: "blob",
  });
  await descargarBlob(data, nombreDeDescarga(headers, `${folio}.pdf`));
}

export function downloadShiftsReport(
  query: ShiftsReportQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  return bajar(`${basePath}/shifts/export`, "cierres-de-turno", format, query);
}

export function downloadSalesReport(
  query: SalesReportQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  return bajar(`${basePath}/sales/export`, "ventas", format, query);
}

export function downloadSalesLinesReport(
  kind: SalesLineKind,
  query: SalesLinesQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  const base = kind === "product" ? "ventas-por-producto" : "ventas-por-servicio";
  return bajar(`${basePath}${RUTA_DE_LINEAS[kind]}/export`, base, format, query);
}

// ─────────────────────────────────────────────────────────────────────────
// El reporte por artículo (F10-RPT-03): más vendidos, mayor utilidad y bajo costo
// ─────────────────────────────────────────────────────────────────────────

/**
 * «Más vendidos» (por venta sin impuesto y luego por cantidad), «Mayor
 * utilidad» (solo lo que dejó, con costo) y «Vendidos bajo su costo» (solo lo
 * que perdió, de la mayor pérdida a la menor).
 */
export type ItemsReportView = "top-sold" | "top-profit" | "below-cost";

/** `product` son los productos y los conceptos libres: todo lo que no es servicio. */
export type ItemsReportType = "all" | "product" | "service";

export interface ItemsReportRow {
  kind: SoldItemKind;
  /** El id del producto o del servicio; un concepto, `concept:` y su descripción. */
  itemId: string;
  /** El código interno del producto o el del servicio; null en un concepto. */
  code: string | null;
  name: string;
  /** En la unidad base del producto (24 piezas, 7.75 kg); servicios y conceptos se cuentan. */
  quantity: string;
  /** La unidad base del producto; null en servicios y conceptos. */
  baseUnit: string | null;
  /** Venta sin impuesto. */
  revenue: string;
  /** Null si alguna venta del artículo no tiene costo: la utilidad no estaría completa. */
  cost: string | null;
  profit: string | null;
  /** En %, con un decimal; null sin utilidad o con venta en $0. */
  margin: number | null;
}

export interface ItemsReportTotals {
  revenue: string;
  /** Null si algún artículo de lo filtrado no tiene costo completo. */
  cost: string | null;
  profit: string | null;
  margin: number | null;
}

/** Los filtros de los otros reportes (sucursal y fechas) más la vista y el tipo. */
export interface ItemsReportQuery {
  view: ItemsReportView;
  /** Por omisión, `all`. */
  type?: ItemsReportType;
  warehouseId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ItemsReportPage {
  rows: ItemsReportRow[];
  /** De TODO lo filtrado, no de la página; null si no hay nada. */
  totals: ItemsReportTotals | null;
  total: number;
  page: number;
  pageSize: number;
}

export async function getItemsReport(
  query: ItemsReportQuery,
  basePath = "/reports",
): Promise<ItemsReportPage> {
  const { data } = await api.get<ItemsReportPage>(`${basePath}/items`, { params: query });
  return data;
}

/** El nombre del archivo si el API no lo manda; el API lo da en el idioma de quien baja. */
const ARCHIVO_DE_LA_VISTA: Record<ItemsReportView, string> = {
  "top-sold": "mas-vendidos",
  "top-profit": "mayor-utilidad",
  "below-cost": "vendidos-bajo-su-costo",
};

/** El mismo reporte en Excel o CSV, con los MISMOS filtros y sin paginar. */
export function downloadItemsReport(
  query: Omit<ItemsReportQuery, "page" | "pageSize">,
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  return bajar(`${basePath}/items/export`, ARCHIVO_DE_LA_VISTA[query.view], format, query);
}

// ─────────────────────────────────────────────────────────────────────────
// Impuestos cobrados (F4-TAX-21)
// ─────────────────────────────────────────────────────────────────────────

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

export interface TaxReport {
  rows: TaxReportRow[];
  /** Las ventas cobradas del período: brutas, netas y su impuesto. */
  totals: { gross: string; net: string; tax: string; tickets: number };
}

export interface TaxReportQuery {
  warehouseId?: string;
  from?: string;
  to?: string;
}

export async function getTaxReport(
  query: TaxReportQuery,
  basePath = "/reports",
): Promise<TaxReport> {
  const { data } = await api.get<TaxReport>(`${basePath}/taxes`, { params: query });
  return data;
}

export function downloadTaxReport(
  query: TaxReportQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  return bajar(`${basePath}/taxes/export`, "impuestos", format, query);
}
