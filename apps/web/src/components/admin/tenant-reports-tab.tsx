import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SalesReport } from "@/components/reports/sales-report";
import { ShiftsReport } from "@/components/reports/shifts-report";
import { StockReport } from "@/components/reports/stock-report";
import { TaxReport } from "@/components/reports/tax-report";
import { Button } from "@/components/ui/button";

/**
 * F9-ADMIN-11 — los reportes de ventas, inventario, cierres de turno
 * (F5-SHIFT-05) e impuestos (F4-TAX-21) del negocio, los MISMOS componentes
 * que el cliente usa, apuntados por el alcance del expediente.
 */
export function TenantReportsTab() {
  const { t } = useTranslation();
  const [vista, setVista] = useState<"sales" | "stock" | "shifts" | "taxes">("sales");
  const k = (sufijo: string) => t(`common.billing.admin.tenants.reports.${sufijo}`);
  return (
    <div className="flex flex-col gap-4" data-testid="tenant-reports">
      <div className="flex gap-2" role="tablist" aria-label={k("title")}>
        {(["sales", "stock", "shifts", "taxes"] as const).map((v) => (
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
      {vista === "sales" && <SalesReport />}
      {vista === "stock" && <StockReport />}
      {vista === "shifts" && <ShiftsReport />}
      {vista === "taxes" && <TaxReport />}
    </div>
  );
}
