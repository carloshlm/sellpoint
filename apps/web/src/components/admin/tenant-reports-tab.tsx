import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SalesLinesReport } from "@/components/reports/sales-lines-report";
import { SalesReport } from "@/components/reports/sales-report";
import { ShiftsReport } from "@/components/reports/shifts-report";
import { StockReport } from "@/components/reports/stock-report";
import { TaxReport } from "@/components/reports/tax-report";
import { Button } from "@/components/ui/button";

const VISTAS = ["sales", "salesByProduct", "salesByService", "stock", "shifts", "taxes"] as const;

/**
 * F9-ADMIN-11 — los reportes de ventas (también por producto y por servicio),
 * inventario, cierres de turno (F5-SHIFT-05) e impuestos (F4-TAX-21) del
 * negocio, los MISMOS componentes que el cliente usa, apuntados por el
 * alcance del expediente.
 */
export function TenantReportsTab() {
  const { t } = useTranslation();
  const [vista, setVista] = useState<(typeof VISTAS)[number]>("sales");
  const k = (sufijo: string) => t(`common.billing.admin.tenants.reports.${sufijo}`);
  return (
    <div className="flex flex-col gap-4" data-testid="tenant-reports">
      {/* Seis pestañas: en un celular se parten en dos renglones. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={k("title")}>
        {VISTAS.map((v) => (
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
      {vista === "salesByProduct" && <SalesLinesReport kind="product" />}
      {vista === "salesByService" && <SalesLinesReport kind="service" />}
      {vista === "stock" && <StockReport />}
      {vista === "shifts" && <ShiftsReport />}
      {vista === "taxes" && <TaxReport />}
    </div>
  );
}
