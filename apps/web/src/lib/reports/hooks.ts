import { useQuery } from "@tanstack/react-query";
import { useAdminTenantScope } from "@/lib/admin/scope";
import type { ApiError } from "@/lib/api";
import {
  getSalesReport,
  getShiftDetail,
  getShiftsReport,
  getStockReport,
  getTaxReport,
  type SalesReportPage,
  type SalesReportQuery,
  type ShiftDetail,
  type ShiftsReportPage,
  type ShiftsReportQuery,
  type StockReportPage,
  type StockReportQuery,
  type TaxReport,
  type TaxReportQuery,
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

export const SHIFTS_REPORT_KEY = ["reports", "shifts"] as const;

export function useShiftsReport(query: ShiftsReportQuery) {
  const { reportsPath, tenantId } = useAdminTenantScope();
  return useQuery<ShiftsReportPage, ApiError>({
    queryKey: [...SHIFTS_REPORT_KEY, tenantId, query],
    queryFn: () =>
      tenantId === null ? getShiftsReport(query) : getShiftsReport(query, reportsPath),
    placeholderData: (previous) => previous,
  });
}

/** El detalle de UN turno; sin id no pregunta (nadie pulsó «Ver»). */
export function useShiftDetail(id: string | null) {
  const { reportsPath, tenantId } = useAdminTenantScope();
  return useQuery<ShiftDetail, ApiError>({
    queryKey: [...SHIFTS_REPORT_KEY, tenantId, "detail", id],
    queryFn: () =>
      tenantId === null ? getShiftDetail(id as string) : getShiftDetail(id as string, reportsPath),
    enabled: id !== null,
  });
}

export const TAX_REPORT_KEY = ["reports", "taxes"] as const;

/** F4-TAX-21 — lo cobrado por componente y tasa; desde el backoffice, del negocio mirado. */
export function useTaxReport(query: TaxReportQuery) {
  const { reportsPath, tenantId } = useAdminTenantScope();
  return useQuery<TaxReport, ApiError>({
    queryKey: [...TAX_REPORT_KEY, tenantId, query],
    queryFn: () => (tenantId === null ? getTaxReport(query) : getTaxReport(query, reportsPath)),
    placeholderData: (previous) => previous,
  });
}
