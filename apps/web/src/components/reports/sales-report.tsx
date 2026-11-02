import { formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportHeading } from "@/components/reports/report-heading";
import { type ReportQuery, ReportTable } from "@/components/reports/report-table";
import { SalesFilterBar, useSalesFilters } from "@/components/reports/sales-filters";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { downloadSalesReport } from "@/lib/reports/api";
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
  const currency = useScopedCurrency();
  // F9-ADMIN-11: desde el expediente del backoffice, el archivo y la consulta
  // van al negocio mirado; el filtro de almacén no aplica (sería el del admin).
  const { reportsPath, tenantId: negocioAjeno } = useAdminTenantScope();

  // Los filtros —y el rango con que abre: desde hoy— son los mismos de
  // Ventas por producto y por servicio.
  const { filtros, page, setPage, barra } = useSalesFilters();
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | undefined>(undefined);

  const { data, isPending, error } = useSalesReport({ ...filtros, page, pageSize: 20 });

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

  return (
    <section className="flex flex-col gap-4" data-testid="sales-report">
      <ReportHeading title={t("reports.hub.sales.title")} />

      <SalesFilterBar id="sales-report" showWarehouse={negocioAjeno === null} {...barra} />

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
        onExport={() =>
          void (negocioAjeno === null
            ? downloadSalesReport(filtros)
            : downloadSalesReport(filtros, "xlsx", reportsPath))
        }
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
