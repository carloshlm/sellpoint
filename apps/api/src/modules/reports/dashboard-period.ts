import { localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import { z } from "zod";

export const dashboardPeriodSchema = z
  .enum(["today", "week", "month", "prev_month"])
  .default("month");

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

export interface PeriodWindow {
  desde: Date;
  hasta: Date;
  /** El período COMPARABLE, para las deltas («creció 32%»). */
  desdeAnterior: Date;
  hastaAnterior: Date;
}

/**
 * F5-DASH — la ventana de cada período del filtro global, en la timezone del
 * negocio y con su período comparable.
 *
 * La ley de las comparaciones (la misma de F5-DASH-03): períodos ABIERTOS se
 * comparan a mismo tiempo corrido — hoy vs el mismo día pasado HASTA esta
 * hora, la semana vs la anterior hasta este momento, el mes vs el anterior a
 * mismo día corrido (con clamp cuando el anterior fue más corto). El único
 * período CERRADO (`prev_month`) se compara completo contra completo.
 *
 * La semana arranca en LUNES: así se corta la semana comercial en este lado
 * del mundo, y el fin de semana —el pico de muchos negocios— queda entero.
 */
export function resolvePeriodWindow(
  period: DashboardPeriod,
  zona: string,
  ahora: Date,
): PeriodWindow {
  const hoy = localCalendarDate(zona, ahora);
  const DIA = 24 * 60 * 60 * 1000;

  if (period === "today") {
    const desde = startOfDayUtc(hoy, zona);
    const desdeAnterior = startOfDayUtc(
      localCalendarDate(zona, new Date(ahora.getTime() - 7 * DIA)),
      zona,
    );
    return {
      desde,
      hasta: ahora,
      desdeAnterior,
      hastaAnterior: new Date(ahora.getTime() - 7 * DIA),
    };
  }

  if (period === "week") {
    // El día de la semana de la FECHA local (mediodía UTC esquiva cualquier
    // borde): 0=domingo → lunes retrocede (dow+6)%7 días.
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
    const lunesIso = new Date(new Date(`${hoy}T12:00:00Z`).getTime() - ((dow + 6) % 7) * DIA)
      .toISOString()
      .slice(0, 10);
    const desde = startOfDayUtc(lunesIso, zona);
    const transcurrido = ahora.getTime() - desde.getTime();
    const desdeAnterior = new Date(desde.getTime() - 7 * DIA);
    return {
      desde,
      hasta: ahora,
      desdeAnterior,
      hastaAnterior: new Date(desdeAnterior.getTime() + transcurrido),
    };
  }

  const inicioMes = startOfDayUtc(`${hoy.slice(0, 7)}-01`, zona);
  const mesAnterior = mesAnteriorIso(hoy);
  const inicioMesAnterior = startOfDayUtc(`${mesAnterior}-01`, zona);

  if (period === "month") {
    const transcurrido = ahora.getTime() - inicioMes.getTime();
    return {
      desde: inicioMes,
      hasta: ahora,
      desdeAnterior: inicioMesAnterior,
      hastaAnterior: new Date(
        Math.min(inicioMesAnterior.getTime() + transcurrido, inicioMes.getTime()),
      ),
    };
  }

  // prev_month: cerrado contra cerrado — el mes anterior completo vs el
  // trasanterior completo.
  const trasanterior = mesAnteriorIso(`${mesAnterior}-01`);
  return {
    desde: inicioMesAnterior,
    hasta: inicioMes,
    desdeAnterior: startOfDayUtc(`${trasanterior}-01`, zona),
    hastaAnterior: inicioMesAnterior,
  };
}

/** «2026-03-15» → «2026-02»; enero retrocede de año. */
export function mesAnteriorIso(isoConDia: string): string {
  const [year, month] = isoConDia.split("-").map(Number);
  const y = (month ?? 1) === 1 ? (year ?? 1970) - 1 : (year ?? 1970);
  const m = (month ?? 1) === 1 ? 12 : (month ?? 1) - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
