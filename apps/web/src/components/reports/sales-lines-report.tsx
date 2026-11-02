import { formatMoney, formatSoldQuantity, type Locale } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { type ReportColumn, ReportTable } from "@/components/reports/report-table";
import { SalesFilterBar, useSalesFilters } from "@/components/reports/sales-filters";
import { Badge } from "@/components/ui/badge";
import { useScopedCurrency } from "@/lib/admin/scope";
import { downloadSalesLinesReport, type SalesLineKind, type SalesLineRow } from "@/lib/reports/api";
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
 * Los filtros, el rango con que abre, el orden y el criterio de las anuladas
 * son los de Ventas: las anuladas se listan MARCADAS y no suman en el pie.
 */
export function SalesLinesReport({ kind }: { kind: SalesLineKind }) {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es") as Locale;
  const currency = useScopedCurrency();
  const { filtros, page, setPage, barra } = useSalesFilters();

  const { data, isPending, error } = useSalesLinesReport(kind, { ...filtros, page, pageSize: 20 });

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
    folio: <Folio linea={linea} />,
    sellerName: linea.seller.name,
    warehouseName: linea.warehouse.name,
    // Vacío y no un guion, como el código de barras de Ventas: la celda vacía
    // ya significa «no hay dato».
    code: linea.code ?? "",
    barcode: linea.barcode ?? "",
    name: linea.name,
    // Como la imprime el ticket: «1 Caja ×12 (12 piezas)», y un servicio, que
    // no tiene unidad, con el número solo.
    quantity:
      linea.baseUnit === null
        ? linea.quantity
        : formatSoldQuantity(linea.quantity, linea.baseUnit, linea.presentation, locale),
    unitPrice: dinero(linea.unitPrice),
    tax: dinero(linea.taxAmount),
    total: dinero(linea.lineTotal),
  }));

  return (
    <section className="flex flex-col gap-4" data-testid={TEST_ID[kind]}>
      <h1 className="font-semibold text-xl">{t(`reports.hub.${HUB[kind]}.title`)}</h1>

      <SalesFilterBar id={`sales-by-${kind}`} showWarehouse {...barra} />

      <ReportTable
        columns={columnas}
        rows={filas}
        total={data?.total ?? 0}
        page={page}
        pageSize={data?.pageSize ?? 20}
        isPending={isPending}
        error={error === null ? null : (error?.message ?? null)}
        onQueryChange={(query) => setPage(query.page)}
        onExport={() => void downloadSalesLinesReport(kind, filtros)}
      />

      {/* Del PERÍODO entero y solo lo cobrado, como el pie de Ventas. */}
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

/**
 * El folio, y la marca de ANULADA cuando lo es: la línea se lista, como en
 * Ventas, pero no suma en el pie y quien lee la tabla tiene que saber por qué.
 */
function Folio({ linea }: { linea: SalesLineRow }) {
  const { t } = useTranslation();
  return (
    // La marca va DEBAJO del folio y no al lado: en una sola línea, una venta
    // cancelada ensanchaba la columna de todas y el Total se salía de la
    // pantalla en una laptop.
    <span className="flex flex-col items-start gap-1">
      <span className="whitespace-nowrap">{linea.folio}</span>
      {linea.status === "canceled" && (
        <Badge variant="destructive">{t("pos.history.canceled")}</Badge>
      )}
    </span>
  );
}
