import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemsReport } from "@/components/reports/items-report";
import { SalesLinesReport } from "@/components/reports/sales-lines-report";
import { SalesReport } from "@/components/reports/sales-report";
import { ShiftsReport } from "@/components/reports/shifts-report";
import { StockReport } from "@/components/reports/stock-report";
import { TaxReport } from "@/components/reports/tax-report";
import { Button } from "@/components/ui/button";

const VISTAS = [
  "sales",
  "salesByProduct",
  "salesByService",
  "topSold",
  "topProfit",
  "belowCost",
  "stock",
  "shifts",
  "taxes",
] as const;

/**
 * Las tres del reporte por artículo (F10-RPT-04) se rotulan con el título de
 * su tarjeta del hub: es el mismo nombre que la persona lee en su pantalla.
 */
const POR_ARTICULO: Partial<Record<(typeof VISTAS)[number], string>> = {
  topSold: "reports.hub.topSold.title",
  topProfit: "reports.hub.topProfit.title",
  belowCost: "reports.hub.belowCost.title",
};

/**
 * F9-ADMIN-11 — los reportes de ventas (también por producto y por servicio),
 * por artículo (F10-RPT-04), inventario, cierres de turno (F5-SHIFT-05) e
 * impuestos (F4-TAX-21) del negocio, los MISMOS componentes que el cliente
 * usa, apuntados por el alcance del expediente.
 */
export function TenantReportsTab() {
  const { t } = useTranslation();
  const [vista, setVista] = useState<(typeof VISTAS)[number]>("sales");
  const k = (sufijo: string) => t(`common.billing.admin.tenants.reports.${sufijo}`);
  return (
    <div className="flex flex-col gap-4" data-testid="tenant-reports">
      {/* Nueve pestañas: en un celular se parten en varios renglones. */}
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
            {POR_ARTICULO[v] === undefined ? k(v) : t(POR_ARTICULO[v])}
          </Button>
        ))}
      </div>
      {vista === "sales" && <SalesReport />}
      {vista === "salesByProduct" && <SalesLinesReport kind="product" />}
      {vista === "salesByService" && <SalesLinesReport kind="service" />}
      {vista === "topSold" && <ItemsReport view="top-sold" />}
      {vista === "topProfit" && <ItemsReport view="top-profit" />}
      {vista === "belowCost" && <ItemsReport view="below-cost" />}
      {vista === "stock" && <StockReport />}
      {vista === "shifts" && <ShiftsReport />}
      {vista === "taxes" && <TaxReport />}
    </div>
  );
}
