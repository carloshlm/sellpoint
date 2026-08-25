import { useQuery } from "@tanstack/react-query";
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
export function useStockReport(query: StockReportQuery) {
  return useQuery<StockReportPage, ApiError>({
    queryKey: [...STOCK_REPORT_KEY, query],
    queryFn: () => getStockReport(query),
    placeholderData: (previous) => previous,
  });
}

export function useSalesReport(query: SalesReportQuery) {
  return useQuery<SalesReportPage, ApiError>({
    queryKey: [...SALES_REPORT_KEY, query],
    queryFn: () => getSalesReport(query),
    placeholderData: (previous) => previous,
  });
}
