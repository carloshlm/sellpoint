import { useQuery } from "@tanstack/react-query";
import { useAdminTenantScope } from "@/lib/admin/scope";
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
 *
 * F9-ADMIN-10: desde el expediente del backoffice el alcance (`basePath`,
 * `tenantId`) apunta a OTRO negocio; el tenant entra a la clave para que dos
 * expedientes abiertos no compartan caché. Sin alcance, la llamada es la de
 * siempre (sin argumentos): los tests y el cliente no cambian.
 */
function useRuta() {
  const { basePath, tenantId } = useAdminTenantScope();
  return { tenantId, base: tenantId === null ? undefined : basePath };
}

export function useDashboardKpis(enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardKpis, ApiError>({
    queryKey: [...DASHBOARD_KPIS_KEY, tenantId],
    queryFn: () => (base === undefined ? getDashboardKpis() : getDashboardKpis(base)),
    enabled,
  });
}

export function useDashboardSeries(enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardSeries, ApiError>({
    queryKey: ["dashboard", "series", tenantId],
    queryFn: () => (base === undefined ? getDashboardSeries() : getDashboardSeries(base)),
    enabled,
  });
}

export function useDashboardProducts(period: DashboardPeriod, enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardProducts, ApiError>({
    queryKey: ["dashboard", "products", period, tenantId],
    queryFn: () =>
      base === undefined ? getDashboardProducts(period) : getDashboardProducts(period, base),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardInventory(enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardInventory, ApiError>({
    queryKey: ["dashboard", "inventory", tenantId],
    queryFn: () => (base === undefined ? getDashboardInventory() : getDashboardInventory(base)),
    enabled,
  });
}

export function useDashboardPayments(period: DashboardPeriod, enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardPayments, ApiError>({
    queryKey: ["dashboard", "payments", period, tenantId],
    queryFn: () =>
      base === undefined ? getDashboardPayments(period) : getDashboardPayments(period, base),
    enabled,
    placeholderData: (previous) => previous,
  });
}
