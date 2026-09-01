import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartEmpty } from "./chart-empty";
import { CHART_COLOR, type ChartToken } from "./chart-tokens";

interface ChartLineProps {
  label: string;
  data: Record<string, unknown>[];
  xKey: string;
  lines: { dataKey: string; token?: ChartToken; name?: string }[];
  height?: number;
  /** Formato del valor en el tooltip (p. ej. moneda con centavos). */
  formatValue?: (value: number) => string;
  /** Formato de los ticks del eje Y (p. ej. moneda SIN centavos: en un eje, los `.00` son ruido). */
  formatAxis?: (value: number) => string;
}

/**
 * Líneas comparativas (F5-DASH-08): la serie protagonista en `primary`, la de
 * referencia en `muted` — el ojo compara sin leyenda. Solo este archivo y sus
 * dos hermanos importan recharts (guardián en charts.test.tsx).
 */
function ChartLine({
  label,
  data,
  xKey,
  lines,
  height = 260,
  formatValue,
  formatAxis,
}: ChartLineProps) {
  if (data.length === 0) {
    return <ChartEmpty label={label} height={height} />;
  }
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
            }}
          />
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name ?? line.dataKey}
              stroke={CHART_COLOR[line.token ?? "primary"]}
              strokeWidth={line.token === "muted" ? 1.5 : 2.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export { ChartLine };
