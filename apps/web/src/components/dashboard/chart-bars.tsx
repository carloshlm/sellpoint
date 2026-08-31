import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartEmpty } from "./chart-empty";
import { CHART_COLOR, type ChartToken } from "./chart-tokens";

interface ChartBarsProps {
  label: string;
  data: Record<string, unknown>[];
  xKey: string;
  barKey: string;
  token?: ChartToken;
  height?: number;
}

/** Barras simples (F5-DASH-08) — las ventas por hora del día. */
function ChartBars({ label, data, xKey, barKey, token = "primary", height = 260 }: ChartBarsProps) {
  if (data.length === 0) {
    return <ChartEmpty label={label} height={height} />;
  }
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} stroke="var(--muted-foreground)" tickLine={false} fontSize={12} />
          <YAxis
            stroke="var(--muted-foreground)"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
            }}
          />
          <Bar dataKey={barKey} fill={CHART_COLOR[token]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { ChartBars };
