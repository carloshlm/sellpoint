import { formatMoney, localCalendarDate, shortName } from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { type ReportQuery, ReportTable } from "@/components/reports/report-table";
import { Button } from "@/components/ui/button";
import {
  TABLE_HEAD_ROW,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { listUsers } from "@/lib/rbac/api";
import { downloadShiftsReport, type ShiftsReportQuery } from "@/lib/reports/api";
import { useShiftDetail, useShiftsReport } from "@/lib/reports/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-SHIFT-04 — los cierres de turno: una LECTURA de lo que el cierre guardó
 * (F4-CASHBOX). Abre con el día actual del negocio, como Clientes; la
 * diferencia va en rojo cuando falta y en verde cuando sobra, y «Ver»
 * despliega abajo las ventas de ese turno, como el historial de pagos.
 */
export function ShiftsReport() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const timeZone = useAuthStore((s) => s.user?.tenant.timezone);
  const currency = useScopedCurrency();
  const { has } = usePermissions();
  const { reportsPath, tenantId: negocioAjeno } = useAdminTenantScope();

  // Desde el backoffice no se asume «hoy»: el negocio mirado es otro y lo
  // interesante suele estar en días anteriores.
  const hoy = negocioAjeno === null && timeZone ? localCalendarDate(timeZone, new Date()) : "";
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [estado, setEstado] = useState<"closed" | "open">("closed");
  const [rango, setRango] = useState<RangoDeFechas>({ from: hoy, to: hoy });
  const [page, setPage] = useState(1);
  const [abierto, setAbierto] = useState<string | null>(null);

  const filtros: ShiftsReportQuery = {
    status: estado,
    ...(warehouseId !== null && { warehouseId }),
    ...(userId !== "" && { userId }),
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
  };
  const { data, isPending, error } = useShiftsReport({ ...filtros, page, pageSize: 20 });
  const detalle = useShiftDetail(abierto);
  const puedeListarEmpleados = negocioAjeno === null && has("users:read");
  const empleados = useQuery({
    queryKey: ["reports", "shifts", "employees"],
    queryFn: listUsers,
    enabled: puedeListarEmpleados,
  });

  const fecha = (iso: string | null) =>
    iso === null
      ? "—"
      : new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "short",
          timeStyle: "short",
          ...(timeZone ? { timeZone } : {}),
        }).format(new Date(iso));
  const dinero = (valor: string | null) =>
    valor === null ? "—" : formatMoney(Number(valor), currency, locale);
  const diferencia = (valor: string | null) => {
    if (valor === null) return "—";
    const n = Number(valor);
    if (n === 0)
      return <span className="text-muted-foreground">{t("reports.shifts.balanced")}</span>;
    return (
      <span className={n < 0 ? "font-medium text-destructive" : "font-medium text-success"}>
        {formatMoney(n, currency, locale)}
      </span>
    );
  };

  const columnas = [
    { key: "closedAt", header: t("reports.shifts.closedAt") },
    { key: "warehouseName", header: t("reports.shifts.warehouse") },
    { key: "closedBy", header: t("reports.shifts.closedBy") },
    { key: "salesCount", header: t("reports.shifts.sales"), numeric: true },
    { key: "cashExpenses", header: t("reports.shifts.cashExpenses"), numeric: true },
    { key: "calculated", header: t("reports.shifts.calculated"), numeric: true },
    { key: "declared", header: t("reports.shifts.declared"), numeric: true },
    { key: "difference", header: t("reports.shifts.difference"), numeric: true },
    { key: "note", header: t("reports.shifts.note") },
    { key: "view", header: "" },
  ];

  const filas = (data?.rows ?? []).map((turno) => ({
    closedAt: fecha(turno.closedAt ?? turno.openedAt),
    warehouseName: turno.warehouse.name,
    closedBy: (turno.closedBy ?? turno.openedBy).name,
    salesCount: turno.salesCount,
    // F9-EXP-10: con signo, como se lee en un arqueo; «—» si no salió nada.
    cashExpenses: turno.cashExpenses.count === 0 ? "—" : `−${dinero(turno.cashExpenses.total)}`,
    calculated: dinero(turno.calculatedCash),
    declared: dinero(turno.declaredCash),
    difference: diferencia(turno.cashDifference),
    note: turno.closingNote ? (
      <span className="block max-w-56 truncate" title={turno.closingNote}>
        {turno.closingNote}
      </span>
    ) : (
      ""
    ),
    view: (
      <Button
        type="button"
        size="sm"
        variant={abierto === turno.id ? "default" : "outline"}
        aria-label={t("reports.shifts.viewShift", {
          when: fecha(turno.closedAt ?? turno.openedAt),
        })}
        onClick={() => setAbierto(abierto === turno.id ? null : turno.id)}
      >
        {t("reports.shifts.view")}
      </Button>
    ),
  }));

  function alFiltrar(accion: () => void) {
    accion();
    setPage(1);
    setAbierto(null);
  }

  return (
    <section className="flex flex-col gap-4" data-testid="shifts-report">
      <h1 className="font-semibold text-xl">{t("reports.shifts.title")}</h1>

      <div className="flex flex-wrap items-end gap-3">
        {negocioAjeno === null && (
          <label htmlFor="shifts-report-warehouse" className="flex min-w-48 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("reports.shifts.warehouse")}</span>
            <WarehouseSelect
              id="shifts-report-warehouse"
              value={warehouseId}
              onChange={(valor) => alFiltrar(() => setWarehouseId(valor))}
              scoped
            />
          </label>
        )}
        {puedeListarEmpleados && (
          <label htmlFor="shifts-report-employee" className="flex min-w-48 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("reports.shifts.employee")}</span>
            <select
              id="shifts-report-employee"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={userId}
              onChange={(e) => alFiltrar(() => setUserId(e.target.value))}
            >
              <option value="">{t("reports.shifts.allEmployees")}</option>
              {(empleados.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {shortName(u)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="shifts-report-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.shifts.status")}</span>
          <select
            id="shifts-report-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(e) => alFiltrar(() => setEstado(e.target.value as typeof estado))}
          >
            <option value="closed">{t("reports.shifts.closed")}</option>
            <option value="open">{t("reports.shifts.open")}</option>
          </select>
        </label>
        <DateRangeFilter
          id="shifts-report"
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
        error={error === null ? null : (error?.message ?? null)}
        onQueryChange={(query: ReportQuery) => setPage(query.page)}
        onExport={() =>
          void (negocioAjeno === null
            ? downloadShiftsReport(filtros)
            : downloadShiftsReport(filtros, "xlsx", reportsPath))
        }
      />

      {abierto !== null && (
        <section
          className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          aria-label={t("reports.shifts.detailTitle")}
          data-testid="shift-detail"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t("reports.shifts.detailTitle")}</h2>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(null)}>
              {t("reports.shifts.close")}
            </Button>
          </div>
          {detalle.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("common.form.loading")}
            </p>
          ) : detalle.data === undefined ? (
            <p role="alert" className="text-destructive text-sm">
              {detalle.error?.message}
            </p>
          ) : detalle.data.sales.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("reports.shifts.noSales")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className={TABLE_HEAD_ROW}>
                  <TableHead className="px-2">{t("reports.shifts.folio")}</TableHead>
                  <TableHead className="px-2">{t("reports.shifts.time")}</TableHead>
                  <TableHead className="px-2">{t("reports.shifts.seller")}</TableHead>
                  <TableHead className="px-2">{t("reports.shifts.method")}</TableHead>
                  <TableHead className="px-2 text-right">{t("reports.shifts.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detalle.data.sales.map((venta) => (
                  <TableRow
                    key={venta.id}
                    className={
                      venta.status === "canceled" ? "text-muted-foreground line-through" : ""
                    }
                  >
                    <TableCell className="px-2 font-mono">{venta.folio}</TableCell>
                    <TableCell className="px-2">{fecha(venta.createdAt)}</TableCell>
                    <TableCell className="px-2">{venta.seller.name}</TableCell>
                    <TableCell className="px-2">
                      {t(`pos.payment.${venta.paymentMethod}`)}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {formatMoney(Number(venta.total), currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </section>
  );
}
