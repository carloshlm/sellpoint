import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";

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
  totalValue: string | null;
  /** Solo con `detail=lots`. */
  lotCode?: string;
  expiresAt?: string | null;
  location?: string;
}

export interface StockReportQuery {
  warehouseId?: string;
  belowMin?: boolean;
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
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
}

export interface SalesReportQuery {
  warehouseId?: string;
  from?: string;
  to?: string;
  folio?: string;
  status?: "completed" | "canceled";
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
}

export async function getSalesReport(
  query: SalesReportQuery,
  basePath = "/reports",
): Promise<SalesReportPage> {
  const { data } = await api.get<SalesReportPage>(`${basePath}/sales`, { params: query });
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
  const { data } = await api.get<Blob>(ruta, {
    params: { ...filtros, format },
    responseType: "blob",
  });
  await descargarBlob(data, `${base}.${format}`);
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

export function downloadSalesReport(
  query: SalesReportQuery = {},
  format: ReportFormat = "xlsx",
  basePath = "/reports",
): Promise<void> {
  return bajar(`${basePath}/sales/export`, "ventas", format, query);
}
