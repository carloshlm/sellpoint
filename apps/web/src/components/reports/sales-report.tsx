import { type Currency, formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { type ReportQuery, ReportTable } from "@/components/reports/report-table";
import { downloadSalesReport, type SalesReportQuery } from "@/lib/reports/api";
import { useSalesReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-SALES-03 — las ventas del período, para analizar.
 *
 * NO reemplaza al historial del POS y no lo duplica: son dos audiencias. El
 * historial es el mostrador —`pos:view`, sin alcance, para encontrar el ticket
 * que el cliente trae en la mano— y esta pantalla es el análisis
 * (`reports:read`, con alcance). Lo que comparten vive en el servidor, en el
 * builder del `where`.
 */
export function SalesReport() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [estado, setEstado] = useState<"todas" | "completed" | "canceled">("todas");
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | undefined>(undefined);

  const filtros: SalesReportQuery = {
    ...(warehouseId !== null && { warehouseId }),
    ...(estado !== "todas" && { status: estado }),
    // Solo viajan con valor: mandar `from: ""` haría que el API rechace la
    // consulta por formato.
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page,
    pageSize: 20,
  };

  const { data, isPending, error } = useSalesReport(filtros);

  const columnas = [
    { key: "folio", header: t("reports.sales.folio") },
    { key: "barcode", header: t("reports.sales.barcode") },
    { key: "createdAt", header: t("reports.sales.date") },
    { key: "sellerName", header: t("reports.sales.seller") },
    { key: "warehouseName", header: t("reports.sales.warehouse") },
    { key: "statusLabel", header: t("reports.sales.status") },
    { key: "methodLabel", header: t("reports.sales.method") },
    { key: "total", header: t("reports.sales.total"), numeric: true },
  ];

  const filas = (data?.rows ?? []).map((venta) => ({
    folio: venta.folio,
    // Vacío y no un guion: la celda vacía ya significa «no hay dato», y esta
    // tabla se copia y pega a una hoja de cálculo.
    barcode: venta.barcode ?? "",
    createdAt: new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(venta.createdAt)),
    sellerName: venta.seller.name,
    warehouseName: venta.warehouse.name,
    statusLabel:
      venta.status === "canceled" ? t("pos.history.canceled") : t("pos.history.completed"),
    methodLabel: t(`pos.payment.${venta.paymentMethod}`),
    total: formatMoney(Number(venta.total), currency, locale),
  }));

  function alFiltrar(accion: () => void) {
    accion();
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-4" data-testid="sales-report">
      <h1 className="font-semibold text-xl">{t("reports.hub.sales.title")}</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="sales-report-warehouse" className="flex min-w-48 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.sales.warehouse")}</span>
          <WarehouseSelect
            id="sales-report-warehouse"
            value={warehouseId}
            onChange={(valor) => alFiltrar(() => setWarehouseId(valor))}
            scoped
          />
        </label>

        <label htmlFor="sales-report-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.sales.status")}</span>
          <select
            id="sales-report-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(e) => alFiltrar(() => setEstado(e.target.value as typeof estado))}
          >
            <option value="todas">{t("pos.history.all")}</option>
            <option value="completed">{t("pos.history.completed")}</option>
            <option value="canceled">{t("pos.history.canceled")}</option>
          </select>
        </label>

        <DateRangeFilter
          id="sales-report"
          from={rango.from}
          to={rango.to}
          onChange={(nuevo) => alFiltrar(() => setRango(nuevo))}
        />
      </div>

      <ReportTable
        columns={columnas}
        rows={filas}
        total={data?.total ?? 0}
        page={page}
        pageSize={data?.pageSize ?? 20}
        isPending={isPending}
        {...(sortBy !== undefined && { sortBy })}
        {...(sortDir !== undefined && { sortDir })}
        error={error === null ? null : (error?.message ?? null)}
        onQueryChange={(query: ReportQuery) => {
          setPage(query.page);
          setSortBy(query.sortBy);
          setSortDir(query.sortDir);
        }}
        onExport={() => void downloadSalesReport(filtros)}
      />

      {/* Los totales son del PERÍODO entero, no de la página: un pie que solo
          sumara lo visible sería un número que nadie puede usar. */}
      {(data?.totals.length ?? 0) > 0 && (
        <dl
          className="flex flex-wrap gap-4 rounded-lg border bg-card p-3 text-sm"
          data-testid="sales-report-totals"
        >
          {data?.totals.map((fila) => (
            <div key={fila.paymentMethod} className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">{t(`pos.payment.${fila.paymentMethod}`)}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoney(Number(fila.total), currency, locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
