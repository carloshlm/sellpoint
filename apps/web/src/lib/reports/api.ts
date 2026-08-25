import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";

/**
 * Los exports DIRECTOS del hub (F5-CAT): bajan el archivo sin abrir pantalla.
 *
 * Siempre `responseType: "blob"` y con axios —no con un `<a href>`— porque el
 * endpoint exige el Bearer y un enlace plano viajaría sin token.
 */
export type ReportFormat = "csv" | "xlsx";

async function bajar(ruta: string, base: string, format: ReportFormat): Promise<void> {
  const { data } = await api.get<Blob>(ruta, { params: { format }, responseType: "blob" });
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
 * F5-STK-02 y F5-SALES-02: sus endpoints YA existen, pero sus pantallas llegan
 * en F5-STK-04 y F5-SALES-03. Mientras tanto el hub baja el Excel en vez de
 * enlazar a una ruta que no existe — un enlace muerto es peor que un archivo.
 */
export function downloadStockReport(format: ReportFormat = "xlsx"): Promise<void> {
  return bajar("/reports/stock/export", "stock", format);
}

export function downloadSalesReport(format: ReportFormat = "xlsx"): Promise<void> {
  return bajar("/reports/sales/export", "ventas", format);
}
