import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SalesReport } from "@/components/reports/sales-report";
import { StockReport } from "@/components/reports/stock-report";
import { Button } from "@/components/ui/button";

/**
 * F9-ADMIN-11 — los reportes de ventas e inventario del negocio, los MISMOS
 * componentes que el cliente usa, apuntados por el alcance del expediente.
 */
export function TenantReportsTab() {
  const { t } = useTranslation();
  const [vista, setVista] = useState<"sales" | "stock">("sales");
  const k = (sufijo: string) => t(`common.billing.admin.tenants.reports.${sufijo}`);
  return (
    <div className="flex flex-col gap-4" data-testid="tenant-reports">
      <div className="flex gap-2" role="tablist" aria-label={k("title")}>
        {(["sales", "stock"] as const).map((v) => (
          <Button
            key={v}
            type="button"
            role="tab"
            aria-selected={vista === v}
            size="sm"
            variant={vista === v ? "default" : "outline"}
            onClick={() => setVista(v)}
          >
            {k(v)}
          </Button>
        ))}
      </div>
      {vista === "sales" ? <SalesReport /> : <StockReport />}
    </div>
  );
}
