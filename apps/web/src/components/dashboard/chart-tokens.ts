/**
 * F5-DASH-08 — los colores de las gráficas salen de los TOKENS del tema.
 *
 * `var(--primary)` y compañía se resuelven en el SVG en tiempo de pintado:
 * los 4+ temas del wizard repintan todas las gráficas cambiando solo
 * index.css, sin tocar un componente — el mismo contrato que `SURFACE` y
 * `RowAction`. Nadie escribe un color literal en una gráfica.
 */
export type ChartToken = "primary" | "muted" | "success" | "warning" | "destructive";

export const CHART_COLOR: Record<ChartToken, string> = {
  primary: "var(--primary)",
  muted: "var(--muted-foreground)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
};

/** Paleta cíclica para series sin color propio (segmentos del donut). */
export const CHART_PALETTE: readonly ChartToken[] = [
  "primary",
  "success",
  "warning",
  "destructive",
  "muted",
];
