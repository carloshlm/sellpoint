import { useQuery } from "@tanstack/react-query";
import { useAdminTenantScope } from "@/lib/admin/scope";
import type { ApiError } from "@/lib/api";
import {
  getSalesReport,
  getStockReport,
  type SalesReportPage,
  type SalesReportQuery,
  type StockReportPage,
  type StockReportQuery,
} from "./api";

export const STOCK_REPORT_KEY = ["reports", "stock"] as const;
export const SALES_REPORT_KEY = ["reports", "sales"] as const;

/**
 * `placeholderData` conserva la página anterior mientras llega la nueva: sin
 * eso, cada cambio de filtro vacía la tabla y la pantalla parpadea entre
 * «Cargando…» y los datos. Mismo criterio que el kardex de F3.
 */
// F9-ADMIN-11: desde el expediente del backoffice el alcance apunta a OTRO
// negocio; sin alcance, la llamada es la de siempre.
export function useStockReport(query: StockReportQuery) {
  const { reportsPath, tenantId } = useAdminTenantScope();
  return useQuery<StockReportPage, ApiError>({
    queryKey: [...STOCK_REPORT_KEY, tenantId, query],
    queryFn: () => (tenantId === null ? getStockReport(query) : getStockReport(query, reportsPath)),
    placeholderData: (previous) => previous,
  });
}

export function useSalesReport(query: SalesReportQuery) {
  const { reportsPath, tenantId } = useAdminTenantScope();
  return useQuery<SalesReportPage, ApiError>({
    queryKey: [...SALES_REPORT_KEY, tenantId, query],
    queryFn: () => (tenantId === null ? getSalesReport(query) : getSalesReport(query, reportsPath)),
    placeholderData: (previous) => previous,
  });
}
