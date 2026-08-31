import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { type DashboardKpis, getDashboardKpis } from "./api";

export const DASHBOARD_KPIS_KEY = ["dashboard", "kpis"] as const;

/**
 * `enabled` es la puerta del PERMISO, no un detalle de red: sin
 * `reports:read` el dato ni siquiera se pide — ocultarlo con CSS dejaría
 * los números del negocio en la pestaña Red del cajero.
 */
export function useDashboardKpis(enabled: boolean) {
  return useQuery<DashboardKpis, ApiError>({
    queryKey: DASHBOARD_KPIS_KEY,
    queryFn: getDashboardKpis,
    enabled,
  });
}
