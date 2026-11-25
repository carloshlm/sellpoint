import { formatMoney, formatSoldQuantity, type Locale } from "@sellpoint/shared";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ReportHeading } from "@/components/reports/report-heading";
import { type ReportColumn, ReportTable } from "@/components/reports/report-table";
import {
  SalesFilterBar,
  type SalesLinesFiltersInitial,
  useSalesFilters,
} from "@/components/reports/sales-filters";
import { Button } from "@/components/ui/button";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import {
  downloadSalesLinesReport,
  type SalesLineKind,
  type SalesLinesQuery,
} from "@/lib/reports/api";
import { useSalesLinesReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/** La tarjeta del hub de cada tipo: de ahí salen el título y la ruta. */
const HUB: Record<SalesLineKind, string> = {
  product: "salesByProduct",
  service: "salesByService",
};

/** Literales y no una plantilla: las capturas del manual los buscan en el código. */
const TEST_ID: Record<SalesLineKind, string> = {
  product: "sales-by-product-report",
  service: "sales-by-service-report",
};

/**
 * «Ventas por producto» y «Ventas por servicio»: el reporte de Ventas con UNA
 * LÍNEA de ticket por renglón. Una sola pantalla con un `kind`; cambian el
 * título, las columnas de código y el nombre de la columna del artículo.
 *
 * Los filtros, el rango con que abre y el orden son los de Ventas, menos el
 * Estado: estos dos reportes listan SOLO lo cobrado (Carlos, 2026-11-02:
 * «sólo debe mostrar las ventas cobradas»), así que no hay anuladas que marcar.
 *
 * F10-RPT-02 — por un enlace abren ya filtradas (`initial`, validado por la
 * ruta): un artículo, una sucursal y unas fechas. El artículo se ve arriba de
 * la tabla con «Quitar filtro»; como los demás filtros, es solo el valor
 * INICIAL y la pantalla lo cambia como siempre.
 */
export function SalesLinesReport({
  kind,
  initial = {},
}: {
  kind: SalesLineKind;
  initial?: SalesLinesFiltersInitial;
}) {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es") as Locale;
  const currency = useScopedCurrency();
  // Desde el expediente del backoffice, como Ventas: la consulta y el archivo
  // van al negocio mirado y el filtro de almacén no aplica (sería el del admin).
  const { reportsPath, tenantId: negocioAjeno } = useAdminTenantScope();
  const { filtros, page, setPage, barra } = useSalesFilters({
    showStatus: false,
    // Campo por campo y no la búsqueda entera: en ella el router deja también
    // lo crudo de la URL (un `?discounted=true` no debe viajar al API).
    initial: { from: initial.from, to: initial.to },
    initialWarehouseId: initial.warehouseId,
  });
  const [itemId, setItemId] = useState(initial.itemId);
  // Lo mismo para la tabla y para el Excel: exportar baja lo que se ve.
  const consulta: SalesLinesQuery = { ...filtros, ...(itemId !== undefined && { itemId }) };

  const { data, isPending, error } = useSalesLinesReport(kind, {
    ...consulta,
    page,
    pageSize: 20,
  });
  // El nombre lo manda el API aparte de los renglones: así se lee aunque en
  // esas fechas no haya ventas. Un API anterior no lo manda; ahí, el del primero.
  const articulo = data?.item?.name ?? data?.rows[0]?.name ?? null;

  const codigos: ReportColumn[] =
    kind === "product"
      ? [
          // Los DOS códigos (Carlos, 2026-11-02): hay productos sin código de
          // barras y el interno los identifica igual.
          { key: "code", header: t("products.form.sku") },
          { key: "barcode", header: t("reports.sales.barcode") },
        ]
      : [{ key: "code", header: t("services.form.code") }];

  const columnas: ReportColumn[] = [
    { key: "createdAt", header: t("reports.sales.date") },
    { key: "folio", header: t("reports.sales.folio") },
    { key: "sellerName", header: t("reports.sales.seller") },
    { key: "warehouseName", header: t("reports.sales.warehouse") },
    ...codigos,
    { key: "name", header: t(`reports.salesLines.${kind}`) },
    { key: "quantity", header: t("reports.salesLines.quantity") },
    { key: "unitPrice", header: t("reports.salesLines.unitPrice"), numeric: true },
    { key: "tax", header: t("reports.salesLines.tax"), numeric: true },
    { key: "total", header: t("reports.salesLines.total"), numeric: true },
  ];

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const filas = (data?.rows ?? []).map((linea) => ({
    createdAt: new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(linea.createdAt)),
    folio: <span className="whitespace-nowrap">{linea.folio}</span>,
    sellerName: linea.seller.name,
    warehouseName: linea.warehouse.name,
    // Vacío y no un guion, como el código de barras de Ventas: la celda vacía
    // ya significa «no hay dato».
    code: linea.code ?? "",
    barcode: linea.barcode ?? "",
    name: linea.name,
    // Como la imprime el ticket: «1 Caja ×12 (12 piezas)», y un servicio, que
    // no tiene unidad, con el número solo. El espacio entre palabras va más
    // ancho: en Plus Jakarta Sans a 14 px el normal mide 2.4 px y «2 piezas»
    // se leía pegado (Carlos, 2026-11-02).
    quantity: (
      <span className="[word-spacing:0.2em]">
        {linea.baseUnit === null
          ? linea.quantity
          : formatSoldQuantity(linea.quantity, linea.baseUnit, linea.presentation, locale)}
      </span>
    ),
    unitPrice: dinero(linea.unitPrice),
    tax: dinero(linea.taxAmount),
    total: dinero(linea.lineTotal),
  }));

  return (
    <section className="flex flex-col gap-4" data-testid={TEST_ID[kind]}>
      <ReportHeading title={t(`reports.hub.${HUB[kind]}.title`)} />

      <SalesFilterBar id={`sales-by-${kind}`} showWarehouse={negocioAjeno === null} {...barra} />

      {itemId !== undefined && (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="sales-lines-item-filter"
        >
          <span className="rounded-full border bg-muted px-3 py-1 font-medium">
            {articulo === null
              ? t(`reports.salesLines.itemFilter.${kind}`)
              : t("reports.salesLines.itemFilter.named", { name: articulo })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setItemId(undefined);
              setPage(1);
            }}
          >
            <X className="size-4" aria-hidden="true" />
            {t("reports.salesLines.itemFilter.clear")}
          </Button>
        </div>
      )}

      <ReportTable
        columns={columnas}
        rows={filas}
        total={data?.total ?? 0}
        page={page}
        pageSize={data?.pageSize ?? 20}
        isPending={isPending}
        error={error === null ? null : (error?.message ?? null)}
        onQueryChange={(query) => setPage(query.page)}
        onExport={() =>
          void (negocioAjeno === null
            ? downloadSalesLinesReport(kind, consulta)
            : downloadSalesLinesReport(kind, consulta, "xlsx", reportsPath))
        }
      />

      {/* Del PERÍODO entero, como el pie de Ventas: suma lo que la tabla lista. */}
      {data?.totals != null && (
        <dl
          className="flex flex-wrap gap-4 rounded-lg border bg-card p-3 text-sm"
          aria-label={t("reports.salesLines.totalsLabel")}
          data-testid="sales-lines-report-totals"
        >
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{t("reports.salesLines.tax")}</dt>
            <dd className="font-medium tabular-nums">{dinero(data.totals.tax)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{t("reports.salesLines.total")}</dt>
            <dd className="font-medium tabular-nums">{dinero(data.totals.total)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
