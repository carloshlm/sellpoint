import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  /** Ya formateado por el caller (formatMoney o número). null = «aún no sé». */
  value: string | null;
  /** Texto secundario bajo el número («2 tickets · $150 promedio»). */
  detail?: string;
  /** Δ% vs el período comparable; null u omitido = sin delta (no se inventa). */
  deltaPct?: number | null;
  /**
   * Voltea el color de la delta para métricas donde SUBIR es malo
   * (devoluciones, faltantes): sin esto el verde mentiría.
   */
  invertDelta?: boolean;
  /** Avance hacia la meta; el dibujo se topa en 100 pero el texto dice el real. */
  goalPct?: number | null;
  /** Mini-tendencia inline; una serie plana pinta línea recta, no NaN. */
  sparkline?: number[];
}

/**
 * F5-DASH-09 — la tarjeta que cuenta la historia: no un número suelto, sino
 * valor + comparación + tendencia en un golpe de vista.
 *
 * Dos reglas de lectura que las aserciones protegen: el COLOR es semántico
 * (verde = mejora, no «subió») y «—» significa «aún no hay dato» — que es
 * una historia distinta de cero y jamás se disfraza de NaN.
 */
function KpiCard({
  label,
  value,
  detail,
  deltaPct,
  invertDelta,
  goalPct,
  sparkline,
}: KpiCardProps) {
  const { t } = useTranslation();
  const delta = deltaPct ?? null;
  const mejora = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const empeora = delta !== null && (invertDelta ? delta > 0 : delta < 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="font-semibold text-2xl tabular-nums">{value ?? "—"}</span>
        {sparkline && sparkline.length > 1 && <Sparkline serie={sparkline} />}
      </div>
      {delta !== null && (
        <span
          className={cn(
            "text-sm tabular-nums",
            mejora && "text-success",
            empeora && "text-destructive",
            !mejora && !empeora && "text-muted-foreground",
          )}
        >
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {delta > 0 ? "+" : ""}
          {delta}%
        </span>
      )}
      {detail !== undefined && <span className="text-muted-foreground text-xs">{detail}</span>}
      {goalPct !== undefined && goalPct !== null && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              data-slot="goal-fill"
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(goalPct, 100)}%` }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("dashboard.kpi.goalProgress", { pct: goalPct })}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * La mini-tendencia: 100×24, normalizada al rango de la serie. Una serie
 * PLANA (max == min) se dibuja al centro — el rango cero no divide nada.
 */
function Sparkline({ serie }: { serie: number[] }) {
  const max = Math.max(...serie);
  const min = Math.min(...serie);
  const rango = max - min;
  const points = serie
    .map((valor, i) => {
      const x = (i / (serie.length - 1)) * 100;
      const y = rango === 0 ? 12 : 22 - ((valor - min) / rango) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 24" className="h-6 w-20 shrink-0" aria-hidden="true">
      <title>tendencia</title>
      <polyline
        points={points}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { KpiCard };
