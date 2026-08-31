import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type DashboardInventory,
  type DashboardKpis,
  type DashboardPayments,
  type DashboardPeriod,
  type DashboardProducts,
  type DashboardSeries,
  getDashboardInventory,
  getDashboardKpis,
  getDashboardPayments,
  getDashboardProducts,
  getDashboardSeries,
} from "./api";

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

export function useDashboardSeries(enabled: boolean) {
  return useQuery<DashboardSeries, ApiError>({
    queryKey: ["dashboard", "series"],
    queryFn: getDashboardSeries,
    enabled,
  });
}

export function useDashboardProducts(period: DashboardPeriod, enabled: boolean) {
  return useQuery<DashboardProducts, ApiError>({
    queryKey: ["dashboard", "products", period],
    queryFn: () => getDashboardProducts(period),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardInventory(enabled: boolean) {
  return useQuery<DashboardInventory, ApiError>({
    queryKey: ["dashboard", "inventory"],
    queryFn: getDashboardInventory,
    enabled,
  });
}

export function useDashboardPayments(period: DashboardPeriod, enabled: boolean) {
  return useQuery<DashboardPayments, ApiError>({
    queryKey: ["dashboard", "payments", period],
    queryFn: () => getDashboardPayments(period),
    enabled,
    placeholderData: (previous) => previous,
  });
}
