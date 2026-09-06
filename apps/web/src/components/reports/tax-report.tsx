import { formatMoney, localCalendarDate } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { ReportTable } from "@/components/reports/report-table";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { downloadTaxReport, type TaxReportQuery } from "@/lib/reports/api";
import { useTaxReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F4-TAX-21 — los impuestos cobrados: un renglón por componente y tasa, con
 * el pie que el contador necesita (bruto, neto, impuesto, tickets). Abre con
 * el MES en curso del negocio —es lo que se declara—, no con el día, como
 * Cierres. Sin paginar: un negocio tiene un puñado de componentes.
 */
export function TaxReport() {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const timeZone = useAuthStore((s) => s.user?.tenant.timezone);
  const currency = useScopedCurrency();
  const { reportsPath, tenantId: negocioAjeno } = useAdminTenantScope();

  // Desde el backoffice no se asume el mes: el negocio mirado es otro.
  const hoy = negocioAjeno === null && timeZone ? localCalendarDate(timeZone, new Date()) : "";
  const inicioDeMes = hoy === "" ? "" : `${hoy.slice(0, 8)}01`;
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoDeFechas>({ from: inicioDeMes, to: hoy });

  const filtros: TaxReportQuery = {
    ...(warehouseId !== null && { warehouseId }),
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
  };
  const { data, isPending, error } = useTaxReport(filtros);
  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

  const columnas = [
    { key: "name", header: t("reports.taxes.tax") },
    { key: "rate", header: t("reports.taxes.rate"), numeric: true },
    { key: "base", header: t("reports.taxes.base"), numeric: true },
    { key: "amount", header: t("reports.taxes.amount"), numeric: true },
    { key: "tickets", header: t("reports.taxes.tickets"), numeric: true },
  ];
  const filas = (data?.rows ?? []).map((f) => ({
    name: f.name,
    rate: `${f.rate}%`,
    base: dinero(f.base),
    amount: dinero(f.amount),
    tickets: f.tickets,
  }));
  const pie =
    data === undefined
      ? []
      : [
          { key: "gross", valor: dinero(data.totals.gross) },
          { key: "net", valor: dinero(data.totals.net) },
          { key: "taxTotal", valor: dinero(data.totals.tax) },
          { key: "tickets", valor: String(data.totals.tickets) },
        ];

  return (
    <section className="flex flex-col gap-4" data-testid="tax-report">
      <h1 className="font-semibold text-xl">{t("reports.taxes.title")}</h1>

      <div className="flex flex-wrap items-end gap-3">
        {negocioAjeno === null && (
          <label htmlFor="tax-report-warehouse" className="flex min-w-48 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("reports.taxes.warehouse")}</span>
            <WarehouseSelect
              id="tax-report-warehouse"
              value={warehouseId}
              onChange={setWarehouseId}
              scoped
            />
          </label>
        )}
        <DateRangeFilter id="tax-report" from={rango.from} to={rango.to} onChange={setRango} />
      </div>

      <ReportTable
        columns={columnas}
        rows={filas}
        total={filas.length}
        page={1}
        pageSize={Math.max(filas.length, 1)}
        isPending={isPending}
        error={error === null ? null : (error?.message ?? null)}
        onQueryChange={() => undefined}
        onExport={() =>
          void (negocioAjeno === null
            ? downloadTaxReport(filtros)
            : downloadTaxReport(filtros, "xlsx", reportsPath))
        }
      />

      {pie.length > 0 && (
        <dl
          className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4"
          aria-label={t("reports.taxes.totalsLabel")}
          data-testid="tax-report-totals"
        >
          {pie.map((celda) => (
            <div key={celda.key} className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t(`reports.taxes.${celda.key}`)}</dt>
              <dd className="font-medium tabular-nums">{celda.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
