import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartEmpty } from "./chart-empty";
import { CHART_COLOR, CHART_PALETTE } from "./chart-tokens";

interface ChartDonutProps {
  label: string;
  data: { name: string; value: number }[];
  height?: number;
  /** Formato del valor en el tooltip (p. ej. `62%` — un `62` pelón no dice de qué habla). */
  formatValue?: (value: number) => string;
}

/**
 * Donut de proporciones (F5-DASH-08). Un donut donde todo vale cero es un aro
 * mudo que parece bug: con la suma en cero se muestra el vacío honesto.
 */
function ChartDonut({ label, data, height = 260, formatValue }: ChartDonutProps) {
  const total = data.reduce((suma, segmento) => suma + segmento.value, 0);
  if (data.length === 0 || total <= 0) {
    return <ChartEmpty label={label} height={height} />;
  }
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            formatter={formatValue ? (valor) => formatValue(Number(valor)) : undefined}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%"
            outerRadius="85%"
            strokeWidth={0}
          >
            {data.map((segmento, i) => (
              <Cell
                key={segmento.name}
                fill={CHART_COLOR[CHART_PALETTE[i % CHART_PALETTE.length] ?? "primary"]}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export { ChartDonut };
