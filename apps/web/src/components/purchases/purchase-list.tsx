import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Badge } from "@/components/ui/badge";
import { Paginator } from "@/components/ui/paginator";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import type { PurchaseRow } from "@/lib/purchases/api";
import { usePurchases } from "@/lib/purchases/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

type Estado = "todas" | PurchaseRow["status"];

/**
 * F9-PURCH-10 — el listado de compras (molde: `document-list.tsx`): folio con
 * debounce, chips de estado, proveedor y rango sobre la FECHA DEL PAPEL. La
 * bandera de descuadre viaja por fila: quien revisa el mes ve de un vistazo
 * cuáles no cuadraban con la factura, sin abrir una por una.
 */
export function PurchaseList() {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("purchases:manage") && canWrite;
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  const [folio, setFolio] = useState("");
  const folioBuscado = useDebouncedValue(folio.trim());
  const [estado, setEstado] = useState<Estado>("todas");
  const [proveedor, setProveedor] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [folioBuscado, estado, proveedor, rango.from, rango.to]);

  const { data, isPending, error } = usePurchases({
    ...(folioBuscado !== "" && { folio: folioBuscado }),
    ...(estado !== "todas" && { status: estado }),
    ...(proveedor !== null && { supplierId: proveedor }),
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page: pagina,
    pageSize: 20,
  });
  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

  return (
    <section className="flex flex-col gap-4" data-testid="purchase-list">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("purchases.list.title")}</h1>
        {canManage && (
          <Link to="/purchases/new" className={BOTON_PRIMARIO}>
            {t("purchases.list.new")}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="purchases-folio" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("purchases.list.folio")}</span>
          <input
            id="purchases-folio"
            type="search"
            className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm"
            value={folio}
            placeholder="COM-000001"
            onChange={(event) => setFolio(event.target.value)}
          />
        </label>
        <label htmlFor="purchases-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("purchases.list.status")}</span>
          <select
            id="purchases-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(event) => setEstado(event.target.value as Estado)}
          >
            <option value="todas">{t("purchases.list.statusAll")}</option>
            <option value="draft">{t("purchases.status.draft")}</option>
            <option value="confirmed">{t("purchases.status.confirmed")}</option>
            <option value="canceled">{t("purchases.status.canceled")}</option>
          </select>
        </label>
        <div className="w-64">
          <SupplierPicker
            value={proveedor}
            onChange={(s) => setProveedor(s?.id ?? null)}
            label={t("purchases.list.supplier")}
          />
        </div>
        <DateRangeFilter id="purchases" from={rango.from} to={rango.to} onChange={setRango} />
      </div>

      {/* El resumen del RANGO, no de la página: cuántas compras y cuánto suman
          en el filtro que está puesto, sin las anuladas. El descuadre aparece
          solo cuando hay: un cero permanente entrena a no leerlo. */}
      {data !== undefined && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="purchases-summary">
          <span className="text-muted-foreground">
            {t("purchases.list.summary.count", { count: data.summary.count })}
          </span>
          <span className="tabular-nums">
            {t("purchases.list.summary.total", { total: dinero(data.summary.total) })}
          </span>
          {data.summary.mismatchCount > 0 && (
            <span className="text-destructive" data-testid="purchases-summary-mismatch">
              {t("purchases.list.summary.mismatch", { count: data.summary.mismatchCount })}
            </span>
          )}
        </p>
      )}

      {isPending ? (
        <p role="status">{t("common.form.loading")}</p>
      ) : error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : data?.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("purchases.list.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="p-2">{t("purchases.list.columns.folio")}</th>
                <th className="p-2">{t("purchases.list.columns.date")}</th>
                <th className="p-2">{t("purchases.list.columns.supplier")}</th>
                <th className="p-2">{t("purchases.list.columns.invoice")}</th>
                <th className="p-2 text-right">{t("purchases.list.columns.lines")}</th>
                <th className="p-2 text-right">{t("purchases.list.columns.total")}</th>
                <th className="p-2">{t("purchases.list.columns.status")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((compra) => {
                const anulada = compra.status === "canceled";
                return (
                  <tr
                    key={compra.id}
                    data-testid={`purchase-${compra.id}`}
                    className={`border-b ${TABLE_ROW_HOVER} ${anulada ? "text-muted-foreground" : ""}`}
                  >
                    <td className="p-2 font-medium tabular-nums whitespace-nowrap">
                      {compra.folio}
                    </td>
                    <td className="p-2 tabular-nums whitespace-nowrap">
                      {formatCalendarDate(compra.purchaseDate, i18n.language)}
                    </td>
                    <td className="p-2">{compra.supplierName}</td>
                    <td className="p-2">{compra.supplierInvoice ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{compra.lineCount}</td>
                    <td className="p-2 text-right tabular-nums">
                      {dinero(compra.total)}
                      {/* El descuadre viaja por fila: revisar el mes sin abrir
                          una compra por una es de lo que se trata el listado. */}
                      {compra.mismatch && (
                        <span
                          data-testid={`mismatch-${compra.id}`}
                          className="block text-destructive text-xs"
                        >
                          {t("purchases.list.mismatch", {
                            difference: dinero(compra.difference ?? "0"),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          anulada
                            ? "destructive"
                            : compra.status === "confirmed"
                              ? "success"
                              : "default"
                        }
                      >
                        {t(`purchases.status.${compra.status}`)}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Link
                        to="/purchases/$purchaseId"
                        params={{ purchaseId: compra.id }}
                        className="inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline"
                      >
                        {t("purchases.list.view")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </section>
  );
}
