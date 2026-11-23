// F9-ADMIN-10: `basePath` apunta el dashboard a otro negocio desde el
// backoffice (`/admin/tenants/:id`); por defecto, el propio (`/reports`).
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
    /**
     * F10-KPI-05 — el cierre estimado del mes (solo con días cerrados); null
     * con menos de tres. Opcional, como todo lo de F10-KPI: durante un deploy,
     * este web puede hablar con un API que todavía no lo manda.
     */
    projected?: string | null;
    /** F10-KPI-05 — lo que falta al día para la meta; "0.00" si ya se alcanzó, null sin meta. */
    requiredDaily?: string | null;
  };
  profit: {
    month: string | null;
    /** Δ% vs la utilidad del mes anterior corrido; null sin base previa. */
    deltaVsPrevMonthPct: number | null;
    /** F9-EXP-11: bruta − gastos activos del mes; null sin bruta. Se pinta solo con Gastos. */
    netMonth: string | null;
    netDeltaVsPrevMonthPct: number | null;
    /** F10-KPI-05 — utilidad ÷ precio sin impuesto de las líneas con costo; null sin utilidad. */
    marginPct?: number | null;
    /** F10-KPI-06 — el punto de equilibrio; se pinta solo con Gastos, como la neta. */
    breakEven?: DashboardBreakEven;
  };
}

/** F10-KPI-06 — cuánto de los gastos del mes ya cubrió la utilidad. */
export interface DashboardBreakEven {
  /** Los gastos del mes: los mismos que resta la utilidad neta. */
  expenses: string;
  /** Utilidad ÷ gastos; null sin utilidad o sin gastos. */
  coveredPct: number | null;
  /** Día del mes desde el que están cubiertos; null si todavía no. */
  coveredOnDay: number | null;
  /** Lo que falta vender para cubrirlos; null si ya se cubrieron o no hay con qué estimar. */
  remainingSales: string | null;
}

export async function getDashboardKpis(basePath = "/reports"): Promise<DashboardKpis> {
  const { data } = await api.get<DashboardKpis>(`${basePath}/dashboard/kpis`);
  return data;
}

export type DashboardPeriod = "today" | "week" | "month" | "prev_month";

export interface DashboardSeries {
  byDay: { day: number; current: string; previous: string }[];
  byHour: {
    hour: number;
    total: string;
    /**
     * F10-KPI-03 — el promedio de esa hora en el mismo día de las últimas
     * cuatro semanas; null en las 24 horas si ninguno tuvo venta. Opcional:
     * durante un deploy, este web puede hablar con un API que aún no lo manda.
     */
    reference?: string | null;
  }[];
}

export interface DashboardProducts {
  topSold: {
    itemId: string;
    sku: string;
    name: string;
    /** Cantidad vendida, ya convertida a la unidad base del producto. */
    units: string;
    /** Código de esa unidad (`kg`, `l`, `unit`…); lo que se cuenta llega como `unit`. */
    unit: string;
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
  /**
   * F10-KPI-01 — lo vendido por debajo de su costo (hasta 5) y lo vendido sin
   * costo (hasta 5), cada uno con su conteo total. Opcionales: durante un
   * deploy, este web puede hablar con un API que todavía no los manda.
   */
  belowCost?: {
    itemId: string;
    kind: "product" | "service";
    sku: string;
    name: string;
    revenue: string;
    cost: string;
    profit: string;
    /** null si se vendió en $0: ahí el margen no existe. */
    marginPct: number | null;
  }[];
  belowCostCount?: number;
  uncosted?: {
    itemId: string;
    kind: "product" | "service";
    sku: string;
    name: string;
    revenue: string;
  }[];
  uncostedCount?: number;
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

/**
 * F10-KPI-14 — el contrato de `GET /reports/dashboard/control`: dónde se va
 * el dinero en el periodo de las pestañas. Los faltantes y los sobrantes van
 * por separado y los dos en positivo: nunca se compensan.
 */
export interface DashboardControl {
  cash: {
    shortage: { amount: string; shifts: number };
    overage: { amount: string; shifts: number };
    closedShifts: number;
  };
  discounts: {
    amount: string;
    tickets: number;
    /** Descuento ÷ (cobrado + descuento); null sin ventas cobradas. */
    pctOfSales: number | null;
  };
  /** Por la fecha de CANCELACIÓN, no por la de la venta. */
  cancellations: { count: number; amount: string };
  /** El periodo en el calendario del negocio (`YYYY-MM-DD`): los filtros de los enlaces. */
  range: { from: string; to: string };
}

export async function getDashboardSeries(basePath = "/reports"): Promise<DashboardSeries> {
  const { data } = await api.get<DashboardSeries>(`${basePath}/dashboard/series`);
  return data;
}

export async function getDashboardProducts(
  period: DashboardPeriod,
  basePath = "/reports",
): Promise<DashboardProducts> {
  const { data } = await api.get<DashboardProducts>(`${basePath}/dashboard/products`, {
    params: { period },
  });
  return data;
}

export async function getDashboardInventory(basePath = "/reports"): Promise<DashboardInventory> {
  const { data } = await api.get<DashboardInventory>(`${basePath}/dashboard/inventory`);
  return data;
}

export async function getDashboardPayments(
  period: DashboardPeriod,
  basePath = "/reports",
): Promise<DashboardPayments> {
  const { data } = await api.get<DashboardPayments>(`${basePath}/dashboard/payment-methods`, {
    params: { period },
  });
  return data;
}

export async function getDashboardControl(
  period: DashboardPeriod,
  basePath = "/reports",
): Promise<DashboardControl> {
  const { data } = await api.get<DashboardControl>(`${basePath}/dashboard/control`, {
    params: { period },
  });
  return data;
}
