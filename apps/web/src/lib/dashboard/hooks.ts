import { useQuery } from "@tanstack/react-query";
import { useAdminTenantScope } from "@/lib/admin/scope";
import type { ApiError } from "@/lib/api";
import {
  type DashboardControl,
  type DashboardInventory,
  type DashboardKpis,
  type DashboardPayments,
  type DashboardPeriod,
  type DashboardProducts,
  type DashboardSeries,
  getDashboardControl,
  getDashboardInventory,
  getDashboardKpis,
  getDashboardPayments,
  getDashboardProducts,
  getDashboardSeries,
} from "./api";

export const DASHBOARD_KPIS_KEY = ["dashboard", "kpis"] as const;

/**
 * F10-PEND-05 — cuánto tiempo un dato del panel sigue fresco. El donut y las
 * gráficas se montan TARDE (van en `lazy`), cuando los avisos ya trajeron las
 * formas de pago del mes; con 0, ese dato ya era viejo y el donut lo volvía a
 * pedir. Cinco segundos cubren la carga y nada más: nadie sale del panel,
 * cobra una venta y vuelve en menos de eso, así que volver al panel siempre
 * trae los números al día.
 */
export const PANEL_STALE_TIME_MS = 5_000;

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
    staleTime: PANEL_STALE_TIME_MS,
  });
}

export function useDashboardSeries(enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardSeries, ApiError>({
    queryKey: ["dashboard", "series", tenantId],
    queryFn: () => (base === undefined ? getDashboardSeries() : getDashboardSeries(base)),
    enabled,
    staleTime: PANEL_STALE_TIME_MS,
  });
}

export function useDashboardProducts(period: DashboardPeriod, enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardProducts, ApiError>({
    queryKey: ["dashboard", "products", period, tenantId],
    queryFn: () =>
      base === undefined ? getDashboardProducts(period) : getDashboardProducts(period, base),
    enabled,
    staleTime: PANEL_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  });
}

export function useDashboardInventory(enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardInventory, ApiError>({
    queryKey: ["dashboard", "inventory", tenantId],
    queryFn: () => (base === undefined ? getDashboardInventory() : getDashboardInventory(base)),
    enabled,
    staleTime: PANEL_STALE_TIME_MS,
  });
}

export function useDashboardPayments(period: DashboardPeriod, enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardPayments, ApiError>({
    queryKey: ["dashboard", "payments", period, tenantId],
    queryFn: () =>
      base === undefined ? getDashboardPayments(period) : getDashboardPayments(period, base),
    enabled,
    staleTime: PANEL_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  });
}

/** F10-KPI-15 — la tarjeta «Control»; obedece a las pestañas de periodo. */
export function useDashboardControl(period: DashboardPeriod, enabled: boolean) {
  const { tenantId, base } = useRuta();
  return useQuery<DashboardControl, ApiError>({
    queryKey: ["dashboard", "control", period, tenantId],
    queryFn: () =>
      base === undefined ? getDashboardControl(period) : getDashboardControl(period, base),
    enabled,
    staleTime: PANEL_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  });
}
