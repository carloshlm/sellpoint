import { type Currency, formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { type ReportQuery, ReportTable } from "@/components/reports/report-table";
import { downloadStockReport, type StockReportQuery } from "@/lib/reports/api";
import { useStockReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-STK-04 — la pantalla del stock por almacén.
 *
 * Monta el componente común de F5-HUB-03 y se ocupa solo del cableado: qué
 * filtros existen, cómo se ven las columnas y qué se exporta. El orden y la
 * paginación son del servidor —ver el docblock de `ReportTable`—: acá solo se
 * reenvían.
 *
 * ── Por qué el detalle por lote cambia las COLUMNAS ─────────────────────
 *
 * Porque cambia la unidad de la fila. Sin detalle, una fila es «este producto
 * en esta bodega»; con detalle, es «este lote en esta ubicación». Mostrar las
 * dos formas con las mismas columnas obligaría a dejar celdas vacías que se
 * leen como datos faltantes.
 */
export function StockReport() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [belowMin, setBelowMin] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | undefined>(undefined);

  /**
   * Los FILTROS van separados de la paginación, y no es cosmético: el endpoint
   * de export no pagina y su schema es `.strict()`, así que mandarle `page`
   * responde 400. Se descubrió en producción, no en los tests —el mock de la
   * API acepta cualquier objeto—.
   */
  const filtros: StockReportQuery = {
    ...(warehouseId !== null && { warehouseId }),
    ...(belowMin && { belowMin: true }),
    ...(detalle && { detail: "lots" as const }),
  };

  const { data, isPending, error } = useStockReport({ ...filtros, page, pageSize: 20 });

  const columnas = detalle
    ? [
        { key: "name", header: t("reports.stock.product") },
        { key: "warehouseName", header: t("reports.stock.warehouse") },
        { key: "lotCode", header: t("reports.stock.lot") },
        { key: "expiresAt", header: t("reports.stock.expiresAt") },
        { key: "location", header: t("reports.stock.location") },
        { key: "quantity", header: t("reports.stock.quantity"), numeric: true },
      ]
    : [
        { key: "name", header: t("reports.stock.product"), sortable: true },
        { key: "warehouseName", header: t("reports.stock.warehouse") },
        { key: "quantity", header: t("reports.stock.quantity"), numeric: true },
        { key: "stockMin", header: t("reports.stock.min"), numeric: true },
        { key: "avgCost", header: t("reports.stock.avgCost"), numeric: true },
        { key: "totalValue", header: t("reports.stock.value"), numeric: true },
      ];

  /**
   * Los importes se formatean acá y no en la tabla: la tabla no sabe —ni tiene
   * por qué saber— cuáles columnas son dinero.
   *
   * El `?? null` cubre los DOS huecos, y no es lo mismo: `null` es «este
   * producto nunca se compró» y `undefined` es «esta consulta no trae esa
   * columna» (el detalle por lote no devuelve costos). Los dos terminan en
   * celda vacía, pero tratar solo el `null` mandaba `Number(undefined)` —o
   * sea `NaN`— al formateador y reventaba la pantalla entera.
   */
  const dinero = (valor: string | null | undefined) =>
    valor === null || valor === undefined ? "" : formatMoney(Number(valor), currency, locale);

  const filas = (data?.rows ?? []).map((fila) => ({
    ...fila,
    avgCost: dinero(fila.avgCost),
    totalValue: dinero(fila.totalValue),
    expiresAt:
      fila.expiresAt === null || fila.expiresAt === undefined
        ? ""
        : new Intl.DateTimeFormat(i18n.language, { dateStyle: "short" }).format(
            new Date(`${fila.expiresAt}T00:00:00`),
          ),
  }));

  function cambiarConsulta(query: ReportQuery) {
    setPage(query.page);
    setSortBy(query.sortBy);
    setSortDir(query.sortDir);
  }

  /** Cualquier cambio de filtro vuelve a la página 1: ver `ReportTable`. */
  function alFiltrar(accion: () => void) {
    accion();
    setPage(1);
  }

  return (
    <section className="flex flex-col gap-4" data-testid="stock-report">
      <h1 className="font-semibold text-xl">{t("reports.hub.stock.title")}</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="stock-warehouse" className="flex min-w-48 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.stock.warehouse")}</span>
          <WarehouseSelect
            id="stock-warehouse"
            value={warehouseId}
            onChange={(valor) => alFiltrar(() => setWarehouseId(valor))}
            scoped
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={belowMin}
            onChange={(e) => alFiltrar(() => setBelowMin(e.target.checked))}
          />
          {t("reports.stock.onlyBelowMin")}
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={detalle}
            onChange={(e) => alFiltrar(() => setDetalle(e.target.checked))}
          />
          {t("reports.stock.byLot")}
        </label>
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
        onQueryChange={cambiarConsulta}
        onExport={() => void downloadStockReport(filtros)}
      />
    </section>
  );
}
