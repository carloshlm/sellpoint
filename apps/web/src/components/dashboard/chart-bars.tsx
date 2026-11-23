import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartEmpty } from "./chart-empty";
import { CHART_COLOR, type ChartToken } from "./chart-tokens";

interface ChartBarsProps {
  label: string;
  data: Record<string, unknown>[];
  xKey: string;
  barKey: string;
  token?: ChartToken;
  height?: number;
  /** Formato del valor en el tooltip (p. ej. moneda con centavos). */
  formatValue?: (value: number) => string;
  /** Formato de los ticks del eje Y (p. ej. moneda SIN centavos: en un eje, los `.00` son ruido). */
  formatAxis?: (value: number) => string;
  /** Formato del ENCABEZADO del tooltip (p. ej. «15 hrs.»: un «15» pelón no dice de qué habla). */
  formatLabel?: (label: string) => string;
  /** Nombre de las barras en la leyenda y el tooltip cuando hay referencia (p. ej. «Hoy»). */
  barName?: string;
  /**
   * F10-KPI-04 — una serie de referencia opcional (p. ej. el mismo día de las
   * últimas semanas), dibujada como línea atenuada SOBRE las barras. Si ninguna
   * fila trae un número en esa clave (`null`, o un API que aún no la manda), la
   * gráfica queda como si no existiera: sin línea y sin leyenda.
   */
  referenceKey?: string;
  referenceName?: string;
}

/**
 * Barras simples (F5-DASH-08) — las ventas por hora del día — con una línea de
 * referencia opcional (F10-KPI-04). Solo este archivo y sus dos hermanos
 * importan recharts (guardián en charts.test.tsx).
 */
function ChartBars({
  label,
  data,
  xKey,
  barKey,
  token = "primary",
  height = 260,
  formatValue,
  formatAxis,
  formatLabel,
  barName,
  referenceKey,
  referenceName,
}: ChartBarsProps) {
  if (data.length === 0) {
    return <ChartEmpty label={label} height={height} />;
  }
  const conReferencia =
    referenceKey !== undefined && data.some((fila) => typeof fila[referenceKey] === "number");

  const grafica = (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} stroke="var(--muted-foreground)" tickLine={false} fontSize={12} />
        <YAxis
          stroke="var(--muted-foreground)"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          // Con símbolo de moneda el tick es más ancho: sin este margen
          // extra, «$6,000» se corta contra el borde izquierdo.
          width={formatAxis ? 60 : 44}
          tickFormatter={formatAxis}
        />
        <Tooltip
          formatter={formatValue ? (valor) => formatValue(Number(valor)) : undefined}
          labelFormatter={formatLabel ? (etiqueta) => formatLabel(String(etiqueta)) : undefined}
          cursor={{ fill: "var(--muted)" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--popover-foreground)",
          }}
        />
        {/* Sin referencia, el nombre no se toca: la gráfica queda como estaba. */}
        <Bar
          dataKey={barKey}
          name={conReferencia ? (barName ?? barKey) : undefined}
          fill={CHART_COLOR[token]}
          radius={[4, 4, 0, 0]}
        />
        {conReferencia && (
          // Después de las barras, para pintarse encima; punteada y en `muted`
          // para leerse como fondo y no como otra serie que compite.
          <Line
            type="monotone"
            dataKey={referenceKey}
            name={referenceName ?? referenceKey}
            stroke={CHART_COLOR.muted}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 3, fill: CHART_COLOR.muted, stroke: "none" }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );

  if (!conReferencia) {
    return (
      <div role="img" aria-label={label} style={{ height }}>
        {grafica}
      </div>
    );
  }

  // La leyenda va en HTML y dentro de la misma altura: así la tarjeta mide lo
  // mismo que su vecina y un lector de pantalla la lee fuera del `img`.
  return (
    <div className="flex flex-col gap-2" style={{ height }}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: CHART_COLOR[token] }}
          />
          {barName ?? barKey}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-4 border-t-2 border-dashed"
            style={{ borderColor: CHART_COLOR.muted }}
          />
          {referenceName ?? referenceKey}
        </li>
      </ul>
      <div role="img" aria-label={label} className="min-h-0 flex-1">
        {grafica}
      </div>
    </div>
  );
}

export { ChartBars };
