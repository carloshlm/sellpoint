import {
  formatMoney,
  formatQuantity,
  formatQuantityWithUnit,
  type Locale,
  localCalendarDate,
} from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemKindIcon } from "@/components/reports/item-kind-icon";
import { ReportHeading } from "@/components/reports/report-heading";
import { type ReportColumn, ReportTable } from "@/components/reports/report-table";
import {
  SalesFilterBar,
  type SalesLinesFiltersInitial,
  useSalesFilters,
  validateSalesLinesSearch,
} from "@/components/reports/sales-filters";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import {
  downloadItemsReport,
  type ItemsReportQuery,
  type ItemsReportRow,
  type ItemsReportType,
  type ItemsReportView,
} from "@/lib/reports/api";
import { useItemsReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/** La tarjeta del hub de cada vista: de ahí sale el título. */
const HUB: Record<ItemsReportView, string> = {
  "top-sold": "topSold",
  "top-profit": "topProfit",
  "below-cost": "belowCost",
};

/** Literales y no una plantilla: las capturas del manual los buscan en el código. */
const TEST_ID: Record<ItemsReportView, string> = {
  "top-sold": "top-sold-report",
  "top-profit": "top-profit-report",
  "below-cost": "below-cost-report",
};

const TIPOS: readonly ItemsReportType[] = ["all", "product", "service"];

/**
 * Con qué filtros abre por un enlace (`/reports/top-sold?type=service`), ya
 * validados por la ruta. Solo son el valor INICIAL: la pantalla los cambia
 * como siempre.
 */
export interface ItemsReportSearch {
  type?: ItemsReportType;
  warehouseId?: string;
  from?: string;
  to?: string;
}

/**
 * El `validateSearch` de las tres rutas: lo inválido se descarta y la
 * pantalla abre como siempre. La sucursal y las fechas se validan como en
 * «Ventas por producto» (`validateSalesLinesSearch`), y devuelve las cuatro
 * claves SIEMPRE: el router mezcla lo validado encima de lo crudo de la URL.
 */
export function validateItemsReportSearch(search: Record<string, unknown>): ItemsReportSearch {
  const { warehouseId, from, to } = validateSalesLinesSearch(search);
  const tipo = TIPOS.find((candidato) => candidato === search.type);
  return { type: tipo, warehouseId, from, to };
}

/**
 * Con qué rango abre: el MES en curso del negocio, del día 1 a hoy, que es la
 * ventana `month` con que el panel calcula sus «Más vendidos» y «Mayor
 * utilidad» (mismos números para el mismo periodo). Un ranking de un solo día
 * dice poco; Impuestos abre igual. Desde el backoffice no se asume ninguna
 * fecha, como en sus hermanos: `useSalesFilters` lo deja vacío.
 */
function useMesEnCurso(): { from?: string; to?: string } {
  const timeZone = useAuthStore((s) => s.user?.tenant.timezone);
  const { tenantId: negocioAjeno } = useAdminTenantScope();
  if (negocioAjeno !== null) {
    return {};
  }
  const hoy = localCalendarDate(
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date(),
  );
  return { from: `${hoy.slice(0, 7)}-01`, to: hoy };
}

type Filtros = Omit<ItemsReportQuery, "view" | "type" | "page" | "pageSize">;

/**
 * Decisión 2 de F10-RPT — el nombre lleva a los tickets del artículo en
 * «Ventas por producto» o «Ventas por servicio», con su sucursal y sus fechas
 * (el contrato de F10-RPT-02). Un concepto (texto libre de una cotización) no
 * tiene un id que filtrar: va a «Ventas por producto», que también lo lista,
 * sin artículo.
 *
 * Desde el expediente del backoffice el nombre se lee sin enlazar, como en el
 * panel: `/reports/*` sería la app propia del admin, no el negocio mirado.
 */
function NombreDelArticulo({ fila, filtros }: { fila: ItemsReportRow; filtros: Filtros }) {
  const { tenantId: negocioAjeno } = useAdminTenantScope();
  if (negocioAjeno !== null) {
    return <span>{fila.name}</span>;
  }
  const search: SalesLinesFiltersInitial = {
    ...(fila.kind !== "concept" && { itemId: fila.itemId }),
    ...filtros,
  };
  const clase = "underline-offset-2 hover:underline";
  return fila.kind === "service" ? (
    <Link to="/reports/sales-by-service" search={search} className={clase}>
      {fila.name}
    </Link>
  ) : (
    <Link to="/reports/sales-by-product" search={search} className={clase}>
      {fila.name}
    </Link>
  );
}

/**
 * F10-RPT-04 — «Más vendidos», «Mayor utilidad» y «Vendidos bajo su costo»
 * (Carlos, 2026-11-25): una sola pantalla con tres vistas sobre
 * `GET reports/items`, que es la consulta del panel con filtros.
 *
 * Los filtros son los de las ventas (sucursal y fechas) más el Tipo: todos,
 * productos (con los conceptos libres) o servicios. Cada renglón es un
 * artículo con su ícono, su cantidad en la unidad base, su venta sin
 * impuesto, su costo, su utilidad y su margen; sin costo capturado, esas tres
 * celdas quedan vacías: ni cero ni inventadas.
 */
export function ItemsReport({
  view,
  initial = {},
}: {
  view: ItemsReportView;
  initial?: ItemsReportSearch;
}) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es") as Locale;
  const currency = useScopedCurrency();
  const { reportsPath, tenantId: negocioAjeno } = useAdminTenantScope();
  const mes = useMesEnCurso();
  // Un enlace con fechas manda el rango completo; sin ellas, el mes en curso.
  const conFechas = initial.from !== undefined || initial.to !== undefined;
  const { filtros, page, setPage, barra } = useSalesFilters({
    showStatus: false,
    initial: conFechas ? { from: initial.from, to: initial.to } : mes,
    initialWarehouseId: initial.warehouseId,
  });
  const [tipo, setTipo] = useState<ItemsReportType>(initial.type ?? "all");

  // Solo los filtros que este reporte conoce: su DTO es `.strict()`.
  const { warehouseId, from, to } = filtros;
  const filtrosDelArticulo: Filtros = {
    ...(warehouseId !== undefined && { warehouseId }),
    ...(from !== undefined && { from }),
    ...(to !== undefined && { to }),
  };
  // Lo mismo para la tabla y para el Excel: exportar baja lo que se ve.
  const consulta: Omit<ItemsReportQuery, "page" | "pageSize"> = {
    view,
    type: tipo,
    ...filtrosDelArticulo,
  };
  const { data, isPending, error } = useItemsReport({ ...consulta, page, pageSize: 20 });

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  /** La pérdida en rojo: en «bajo su costo» son todas, y en las otras se distingue. */
  const utilidad = (valor: string) => (
    <span className={Number(valor) < 0 ? "text-destructive" : undefined}>{dinero(valor)}</span>
  );

  const columnas: ReportColumn[] = [
    { key: "item", header: t("reports.items.item") },
    { key: "quantity", header: t("reports.items.quantity"), numeric: true },
    { key: "revenue", header: t("reports.items.revenue"), numeric: true },
    { key: "cost", header: t("reports.items.cost"), numeric: true },
    { key: "profit", header: t("reports.items.profit"), numeric: true },
    { key: "margin", header: t("reports.items.margin"), numeric: true },
  ];

  const filas = (data?.rows ?? []).map((fila) => ({
    item: (
      <span className="flex items-center gap-2">
        <ItemKindIcon kind={fila.kind} />
        <NombreDelArticulo fila={fila} filtros={filtrosDelArticulo} />
      </span>
    ),
    // En la unidad base («2.500 kilogramos», «24 piezas»); un servicio o un
    // concepto no tiene unidad y se cuenta.
    quantity: (
      <span className="whitespace-nowrap">
        {fila.baseUnit === null
          ? formatQuantity(fila.quantity, "unit")
          : formatQuantityWithUnit(fila.quantity, fila.baseUnit, locale)}
      </span>
    ),
    revenue: dinero(fila.revenue),
    // Vacías sin costo, como en el Excel: la celda vacía ya dice «no hay dato».
    cost: fila.cost === null ? "" : dinero(fila.cost),
    profit: fila.profit === null ? "" : utilidad(fila.profit),
    margin: fila.margin === null ? "" : `${fila.margin}%`,
  }));

  const pie =
    data?.totals == null
      ? []
      : [
          { key: "revenue", valor: dinero(data.totals.revenue) },
          { key: "cost", valor: data.totals.cost === null ? "—" : dinero(data.totals.cost) },
          {
            key: "profit",
            valor: data.totals.profit === null ? "—" : utilidad(data.totals.profit),
          },
          { key: "margin", valor: data.totals.margin === null ? "—" : `${data.totals.margin}%` },
        ];

  return (
    <section className="flex flex-col gap-4" data-testid={TEST_ID[view]}>
      <ReportHeading title={t(`reports.hub.${HUB[view]}.title`)} />

      {view === "below-cost" && (
        <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm">
          {t("reports.items.belowCostNotice")}
        </p>
      )}

      <SalesFilterBar id={`items-${view}`} showWarehouse={negocioAjeno === null} {...barra}>
        <label htmlFor={`items-${view}-type`} className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.items.type")}</span>
          <select
            id={`items-${view}-type`}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as ItemsReportType);
              setPage(1);
            }}
          >
            {TIPOS.map((candidato) => (
              <option key={candidato} value={candidato}>
                {t(`reports.items.types.${candidato}`)}
              </option>
            ))}
          </select>
        </label>
      </SalesFilterBar>

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
            ? downloadItemsReport(consulta)
            : downloadItemsReport(consulta, "xlsx", reportsPath))
        }
      />

      {/* De TODO lo filtrado, no de la página, como el pie de Ventas. */}
      {pie.length > 0 && (
        <dl
          className="flex flex-wrap gap-4 rounded-lg border bg-card p-3 text-sm"
          aria-label={t("reports.items.totalsLabel")}
          data-testid="items-report-totals"
        >
          {pie.map(({ key, valor }) => (
            <div key={key} className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">{t(`reports.items.${key}`)}</dt>
              <dd className="font-medium tabular-nums">{valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
