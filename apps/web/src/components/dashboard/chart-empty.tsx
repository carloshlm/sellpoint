import { useTranslation } from "react-i18next";

/** El vacío honesto compartido por los tres envoltorios (F5-DASH-08). */
function ChartEmpty({ label, height }: { label: string; height: number }) {
  const { t } = useTranslation();
  return (
    <div
      role="img"
      aria-label={label}
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed text-muted-foreground text-sm"
    >
      {t("dashboard.chart.empty")}
    </div>
  );
}

export { ChartEmpty };
