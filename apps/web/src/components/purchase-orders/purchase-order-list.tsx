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
import { businessToday, formatCalendarDate } from "@/lib/inventory/format-date";
import type { PurchaseOrderRow } from "@/lib/purchase-orders/api";
import { usePurchaseOrders } from "@/lib/purchase-orders/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

/** Los chips de estado: los siete de VISTA (con «Facturada», derivado) más dos que el API entiende como filtros. */
type Filtro = "todas" | "pendingOnly" | "pendingInvoice" | PurchaseOrderRow["status"];

const VARIANTE: Record<
  PurchaseOrderRow["status"],
  "default" | "success" | "warning" | "destructive"
> = {
  draft: "default",
  open: "warning",
  partially_received: "warning",
  received: "success",
  closed: "default",
  invoiced: "success",
  canceled: "destructive",
};

/**
 * F9-PO-11 — el listado de órdenes (molde: `purchase-list.tsx`). Lo que
 * pregunta quien lo abre: ¿qué espero, de quién, para cuándo, y qué llegó
 * sin factura todavía? Por eso los chips «Con pendiente» y «Recibidas sin
 * factura», y la fecha esperada en rojo cuando ya pasó y sigue pendiente.
 */
export function PurchaseOrderList() {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("purchases:manage") && canWrite;
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const hoy = businessToday(useAuthStore((s) => s.user?.tenant.timezone));

  const [folio, setFolio] = useState("");
  const folioBuscado = useDebouncedValue(folio.trim());
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [proveedor, setProveedor] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [folioBuscado, filtro, proveedor, rango.from, rango.to]);

  const { data, isPending, error } = usePurchaseOrders({
    ...(folioBuscado !== "" && { folio: folioBuscado }),
    ...(filtro === "pendingOnly" && { pendingOnly: true }),
    ...(filtro === "pendingInvoice" && { pendingInvoice: true }),
    ...(filtro !== "todas" &&
      filtro !== "pendingOnly" &&
      filtro !== "pendingInvoice" && { status: filtro }),
    ...(proveedor !== null && { supplierId: proveedor }),
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page: pagina,
    pageSize: 20,
  });
  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const espera = (fila: PurchaseOrderRow) =>
    fila.status === "open" || fila.status === "partially_received";

  return (
    <section className="flex flex-col gap-4" data-testid="purchase-order-list">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("purchaseOrders.list.title")}</h1>
        {canManage && (
          <Link to="/purchase-orders/new" className={BOTON_PRIMARIO}>
            {t("purchaseOrders.list.new")}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="purchase-orders-folio" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("purchaseOrders.list.folio")}</span>
          <input
            id="purchase-orders-folio"
            type="search"
            className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm"
            value={folio}
            placeholder="OCO-000001"
            onChange={(event) => setFolio(event.target.value)}
          />
        </label>
        <label htmlFor="purchase-orders-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("purchaseOrders.list.status")}</span>
          <select
            id="purchase-orders-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filtro}
            onChange={(event) => setFiltro(event.target.value as Filtro)}
          >
            <option value="todas">{t("purchaseOrders.list.statusAll")}</option>
            <option value="pendingOnly">{t("purchaseOrders.list.pendingOnly")}</option>
            <option value="pendingInvoice">{t("purchaseOrders.list.pendingInvoice")}</option>
            {(
              [
                "draft",
                "open",
                "partially_received",
                "received",
                "closed",
                "invoiced",
                "canceled",
              ] as const
            ).map((estado) => (
              <option key={estado} value={estado}>
                {t(`purchaseOrders.status.${estado}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="w-64">
          <SupplierPicker
            value={proveedor}
            onChange={(s) => setProveedor(s?.id ?? null)}
            label={t("purchaseOrders.list.supplier")}
          />
        </div>
        <DateRangeFilter id="purchase-orders" from={rango.from} to={rango.to} onChange={setRango} />
      </div>

      {data !== undefined && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="purchase-orders-summary">
          <span className="text-muted-foreground">
            {t("purchaseOrders.list.summary.count", { count: data.summary.count })}
          </span>
          <span className="tabular-nums">
            {t("purchaseOrders.list.summary.total", { total: dinero(data.summary.total) })}
          </span>
          {data.summary.pendingCount > 0 && (
            <span className="text-warning" data-testid="purchase-orders-summary-pending">
              {t("purchaseOrders.list.summary.pending", { count: data.summary.pendingCount })}
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
        <p className="text-muted-foreground text-sm">{t("purchaseOrders.list.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="p-2">{t("purchaseOrders.list.columns.folio")}</th>
                <th className="p-2">{t("purchaseOrders.list.columns.date")}</th>
                <th className="p-2">{t("purchaseOrders.list.columns.expected")}</th>
                <th className="p-2">{t("purchaseOrders.list.columns.supplier")}</th>
                <th className="p-2 text-right">{t("purchaseOrders.list.columns.total")}</th>
                <th className="p-2 text-right">{t("purchaseOrders.list.columns.received")}</th>
                <th className="p-2">{t("purchaseOrders.list.columns.status")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((orden) => {
                const vencida =
                  espera(orden) && orden.expectedDate !== null && orden.expectedDate < hoy;
                return (
                  <tr
                    key={orden.id}
                    data-testid={`purchase-order-${orden.id}`}
                    className={`border-b last:border-0 ${TABLE_ROW_HOVER}`}
                  >
                    <td className="p-2 font-mono">{orden.folio}</td>
                    <td className="p-2">{formatCalendarDate(orden.orderDate, i18n.language)}</td>
                    <td className={`p-2 ${vencida ? "text-destructive" : ""}`}>
                      {orden.expectedDate === null
                        ? "—"
                        : formatCalendarDate(orden.expectedDate, i18n.language)}
                      {vencida && (
                        <span
                          className="ml-1 text-xs"
                          data-testid={`overdue-${orden.id}`}
                        >{`(${t("purchaseOrders.list.overdue")})`}</span>
                      )}
                    </td>
                    <td className="p-2">{orden.supplierName}</td>
                    <td className="p-2 text-right tabular-nums">{dinero(orden.total)}</td>
                    {/* Carlos, 2026-09-12: cuánto llegó, de un vistazo. */}
                    <td className="p-2 text-right tabular-nums">
                      <span data-testid={`received-pct-${orden.id}`}>{orden.receivedPercent}%</span>
                      <span
                        aria-hidden="true"
                        className="mt-1 block h-1.5 w-20 overflow-hidden rounded bg-muted"
                      >
                        <span
                          className="block h-full rounded bg-primary"
                          style={{ width: `${orden.receivedPercent}%` }}
                        />
                      </span>
                    </td>
                    <td className="p-2">
                      <Badge variant={VARIANTE[orden.status]}>
                        {t(`purchaseOrders.status.${orden.status}`)}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Link
                        to="/purchase-orders/$orderId"
                        params={{ orderId: orden.id }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {t("purchaseOrders.list.view")}
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
