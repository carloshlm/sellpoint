import { api } from "@/lib/api";

/**
 * F5-DASH-10 — el contrato de `GET /reports/dashboard/kpis` (espejo de
 * `DashboardKpis` en el API). El dinero viaja como string decimal y los
 * `null` son semánticos: «aún no sé» nunca se disfraza de cero.
 */
export interface DashboardKpis {
  today: {
    total: string;
    tickets: number;
    averageTicket: string | null;
    deltaVsLastWeekPct: number | null;
  };
  month: {
    total: string;
    deltaVsPrevMonthPct: number | null;
    goal: string | null;
    goalPct: number | null;
  };
  profit: { month: string | null };
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const { data } = await api.get<DashboardKpis>("/reports/dashboard/kpis");
  return data;
}
