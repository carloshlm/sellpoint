import { formatMoney, localCalendarDate, shortName } from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { ReportHeading } from "@/components/reports/report-heading";
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
import {
  downloadShiftPdf,
  downloadShiftsReport,
  type ShiftDifference,
  type ShiftsReportQuery,
} from "@/lib/reports/api";
import { useShiftDetail, useShiftsReport } from "@/lib/reports/hooks";
import { useFolioPrefix } from "@/lib/tenant/folio-prefix";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F10-KPI-13 — con qué filtros abre Cierres de turno cuando se llega por un
 * enlace (`/reports/shifts?difference=shortage`), ya validados por la ruta.
 * Solo son el valor INICIAL.
 */
export interface ShiftsFiltersInitial {
  difference?: ShiftDifference;
  from?: string;
  to?: string;
}

/**
 * F5-SHIFT-04 — los cierres de turno: una LECTURA de lo que el cierre guardó
 * (F4-CASHBOX). Abre con el día actual del negocio, como Clientes; la
 * diferencia va en rojo cuando falta y en verde cuando sobra, y «Ver»
 * despliega abajo las ventas de ese turno, como el historial de pagos.
 */
export function ShiftsReport({
  initialFilters = {},
}: {
  initialFilters?: ShiftsFiltersInitial;
} = {}) {
  const { t, i18n } = useTranslation();
  const prefijoFolio = useFolioPrefix("cashbox_session");
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
  // F10-KPI-13: un enlace con fechas manda el rango completo; sin fechas, hoy.
  const [rango, setRango] = useState<RangoDeFechas>(
    initialFilters.from !== undefined || initialFilters.to !== undefined
      ? { from: initialFilters.from ?? "", to: initialFilters.to ?? "" }
      : { from: hoy, to: hoy },
  );
  // "" es «Todas». La diferencia es de un CIERRE: solo viaja con «Cerrados».
  const [filtroDiferencia, setFiltroDiferencia] = useState<ShiftDifference | "">(
    initialFilters.difference ?? "",
  );
  const [page, setPage] = useState(1);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Carlos (2026-11-16): el turno se encuentra por su folio. Quien lo tiene en
  // la mano no sabe de qué día es ni si ya cerró: buscando, el folio manda y
  // las fechas y el estado no estorban.
  const [busqueda, setBusqueda] = useState("");
  const buscado = useDebouncedValue(busqueda.trim());

  const filtros: ShiftsReportQuery =
    buscado !== ""
      ? {
          search: buscado,
          ...(warehouseId !== null && { warehouseId }),
          ...(userId !== "" && { userId }),
        }
      : {
          status: estado,
          ...(estado === "closed" && filtroDiferencia !== "" && { difference: filtroDiferencia }),
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
    { key: "folio", header: t("reports.shifts.folio") },
    // Carlos (2026-11-19): la apertura a la vista, sin descargar el PDF.
    { key: "openedAt", header: t("reports.shifts.openedAt") },
    { key: "closedAt", header: t("reports.shifts.closedAt") },
    { key: "warehouseName", header: t("reports.shifts.warehouse") },
    { key: "closedBy", header: t("reports.shifts.closedBy") },
    { key: "salesCount", header: t("reports.shifts.sales"), numeric: true },
    { key: "openingCash", header: t("reports.shifts.openingCash"), numeric: true },
    { key: "cashExpenses", header: t("reports.shifts.cashExpenses"), numeric: true },
    { key: "calculated", header: t("reports.shifts.calculated"), numeric: true },
    { key: "declared", header: t("reports.shifts.declared"), numeric: true },
    { key: "difference", header: t("reports.shifts.difference"), numeric: true },
    { key: "note", header: t("reports.shifts.note") },
    { key: "view", header: t("common.actions.column") },
  ];

  const filas = (data?.rows ?? []).map((turno) => ({
    folio: <span className="whitespace-nowrap font-mono">{turno.folio}</span>,
    // La fecha y la hora en un renglón: partida en dos se lee como dos datos.
    openedAt: <span className="whitespace-nowrap">{fecha(turno.openedAt)}</span>,
    // Un turno abierto todavía no tiene cierre: «—», no su apertura repetida.
    closedAt: <span className="whitespace-nowrap">{fecha(turno.closedAt)}</span>,
    warehouseName: turno.warehouse.name,
    closedBy: (turno.closedBy ?? turno.openedBy).name,
    salesCount: turno.salesCount,
    // F10-MANFIX-10: el fondo con que abrió el cajón, que lo calculado ya
    // suma; «—» si abrió sin fondo, como los gastos.
    openingCash: Number(turno.openingCash) === 0 ? "—" : dinero(turno.openingCash),
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
      <div className="flex justify-end gap-2">
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
        {/* Carlos (2026-11-16): el cierre en PDF carta, al lado de «Ver». */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("reports.shifts.pdfShift", { folio: turno.folio })}
          onClick={() =>
            void (negocioAjeno === null
              ? downloadShiftPdf(turno.id, turno.folio)
              : downloadShiftPdf(turno.id, turno.folio, reportsPath))
          }
        >
          {t("reports.shifts.pdf")}
        </Button>
      </div>
    ),
  }));

  function alFiltrar(accion: () => void) {
    accion();
    setPage(1);
    setAbierto(null);
  }

  return (
    <section className="flex flex-col gap-4" data-testid="shifts-report">
      <ReportHeading title={t("reports.shifts.title")} />

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="shifts-report-search" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.shifts.search")}</span>
          <input
            id="shifts-report-search"
            type="search"
            className="h-9 w-48 max-w-full rounded-md border border-input bg-background px-2 text-sm"
            value={busqueda}
            maxLength={32}
            placeholder={`${prefijoFolio}-000042`}
            aria-describedby={buscado !== "" ? "shifts-report-search-hint" : undefined}
            onChange={(e) => alFiltrar(() => setBusqueda(e.target.value))}
          />
        </label>
        {negocioAjeno === null && (
          <label htmlFor="shifts-report-warehouse" className="flex min-w-48 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("reports.shifts.warehouse")}</span>
            <WarehouseSelect
              id="shifts-report-warehouse"
              value={warehouseId}
              // F10-MANFIX-02: "" es «Todas las sucursales» (allowAll) — se
              // traduce a `null` para que `filtros` NO mande `warehouseId`.
              onChange={(valor) => alFiltrar(() => setWarehouseId(valor === "" ? null : valor))}
              scoped
              allowAll
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
        {/* F10-KPI-13: los turnos con faltante, sin recorrer la lista. Un turno
            abierto todavía no tiene diferencia: con «Abiertos» no aplica. */}
        <label htmlFor="shifts-report-difference" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.shifts.difference")}</span>
          <select
            id="shifts-report-difference"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
            value={filtroDiferencia}
            disabled={estado === "open"}
            onChange={(e) =>
              alFiltrar(() => setFiltroDiferencia(e.target.value as typeof filtroDiferencia))
            }
          >
            <option value="">{t("reports.shifts.differenceAll")}</option>
            <option value="shortage">{t("reports.shifts.differenceShortage")}</option>
            <option value="overage">{t("reports.shifts.differenceOverage")}</option>
            <option value="balanced">{t("reports.shifts.balanced")}</option>
          </select>
        </label>
        <DateRangeFilter
          id="shifts-report"
          from={rango.from}
          to={rango.to}
          onChange={(nuevo) => alFiltrar(() => setRango(nuevo))}
        />
      </div>
      {buscado !== "" && (
        <p id="shifts-report-search-hint" className="-mt-2 text-muted-foreground text-xs">
          {t("reports.shifts.searchHint")}
        </p>
      )}

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

      {/* F10-KPI-13: cuánto faltó y cuánto sobró en TODO el periodo filtrado,
          cada uno por su lado: un faltante no se compensa con un sobrante. Con
          «Abiertos» no hay cierres que sumar; un API anterior no lo manda. */}
      {data?.differenceTotals !== undefined && (buscado !== "" || estado === "closed") && (
        <p
          className="rounded-lg border bg-card p-3 text-sm tabular-nums"
          data-testid="shifts-report-totals"
        >
          {t("reports.shifts.differenceTotals", {
            shortage: dinero(data.differenceTotals.shortage),
            overage: dinero(data.differenceTotals.overage),
          })}
        </p>
      )}

      {abierto !== null && (
        <section
          className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          aria-label={t("reports.shifts.detailTitle")}
          data-testid="shift-detail"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">
              {detalle.data === undefined
                ? t("reports.shifts.detailTitle")
                : t("reports.shifts.detailTitleOf", { folio: detalle.data.folio })}
            </h2>
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
