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
  profit: {
    month: string | null;
    /** Δ% vs la utilidad del mes anterior corrido; null sin base previa. */
    deltaVsPrevMonthPct: number | null;
  };
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const { data } = await api.get<DashboardKpis>("/reports/dashboard/kpis");
  return data;
}

export type DashboardPeriod = "today" | "week" | "month" | "prev_month";

export interface DashboardSeries {
  byDay: { day: number; current: string; previous: string }[];
  byHour: { hour: number; total: string }[];
}

export interface DashboardProducts {
  topSold: {
    itemId: string;
    sku: string;
    name: string;
    units: string;
    revenue: string;
    deltaPct: number | null;
  }[];
  topProfit: {
    itemId: string;
    sku: string;
    name: string;
    revenue: string;
    cost: string;
    profit: string;
    marginPct: number;
  }[];
}

export interface DashboardInventory {
  outOfStock: number;
  belowMin: number;
  /** Solo viaja con reports:read — el valor del inventario es dinero. */
  inventoryValue?: string;
  attention: {
    productId: string;
    sku: string;
    name: string;
    stock: string;
    stockMin: string;
    daysLeft: number | null;
  }[];
}

export interface DashboardPayments {
  methods: { method: "cash" | "card" | "transfer"; total: string; pct: number }[];
}

export async function getDashboardSeries(): Promise<DashboardSeries> {
  const { data } = await api.get<DashboardSeries>("/reports/dashboard/series");
  return data;
}

export async function getDashboardProducts(period: DashboardPeriod): Promise<DashboardProducts> {
  const { data } = await api.get<DashboardProducts>("/reports/dashboard/products", {
    params: { period },
  });
  return data;
}

export async function getDashboardInventory(): Promise<DashboardInventory> {
  const { data } = await api.get<DashboardInventory>("/reports/dashboard/inventory");
  return data;
}

export async function getDashboardPayments(period: DashboardPeriod): Promise<DashboardPayments> {
  const { data } = await api.get<DashboardPayments>("/reports/dashboard/payment-methods", {
    params: { period },
  });
  return data;
}
