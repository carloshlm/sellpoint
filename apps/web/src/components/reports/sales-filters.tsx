import { localCalendarDate } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { useAdminTenantScope } from "@/lib/admin/scope";
import type { SalesReportQuery } from "@/lib/reports/api";
import { useAuthStore } from "@/stores/auth.store";

type Estado = "todas" | "completed" | "canceled";

/**
 * Con qué rango abren Ventas, Ventas por producto y Ventas por servicio:
 * **desde hoy, sin tope** (Carlos, 2026-11-02: «al entrar vean el listado del
 * día actual»). Un solo lugar para las tres pantallas.
 *
 * «Hoy» es el día del NEGOCIO, el mismo calendario con que el servidor lee
 * `from` (como Cierres de turno e Impuestos); sin zona del negocio, el del
 * navegador. Desde el backoffice no se asume hoy, como en sus hermanos: el
 * negocio mirado es otro y lo interesante suele estar en días anteriores.
 *
 * Es solo el valor INICIAL: «Limpiar fechas» deja el rango vacío y ahí se
 * queda, para ver todas las fechas.
 */
function useRangoInicial(): RangoDeFechas {
  const timeZone = useAuthStore((s) => s.user?.tenant.timezone);
  const { tenantId: negocioAjeno } = useAdminTenantScope();
  if (negocioAjeno !== null) {
    return { from: "", to: "" };
  }
  const zona = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { from: localCalendarDate(zona, new Date()), to: "" };
}

interface SalesFiltersOptions {
  /**
   * Si la pantalla ofrece el filtro de Estado. Ventas sí; «Ventas por
   * producto» y «Ventas por servicio» no (Carlos, 2026-11-02): listan solo lo
   * cobrado y su API responde 400 si llega `status`.
   */
  showStatus?: boolean;
}

/**
 * Los filtros de las ventas y su página. Cambiar un filtro vuelve a la página
 * 1: quedarse en la 7 de otra consulta muestra filas que no son las pedidas.
 */
export function useSalesFilters({ showStatus = true }: SalesFiltersOptions = {}) {
  const rangoInicial = useRangoInicial();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("todas");
  const [rango, setRango] = useState<RangoDeFechas>(rangoInicial);
  const [page, setPage] = useState(1);

  /**
   * Los FILTROS van separados de la paginación: el endpoint de export no
   * pagina y su schema es `.strict()`, así que mandarle `page` responde 400.
   */
  const filtros: SalesReportQuery = {
    ...(warehouseId !== null && { warehouseId }),
    ...(showStatus && estado !== "todas" && { status: estado }),
    // Solo viajan con valor: mandar `from: ""` haría que el API rechace la
    // consulta por formato.
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
  };

  function alFiltrar(accion: () => void) {
    accion();
    setPage(1);
  }

  return {
    filtros,
    page,
    setPage,
    barra: {
      showStatus,
      warehouseId,
      estado,
      rango,
      onWarehouse: (valor: string | null) => alFiltrar(() => setWarehouseId(valor)),
      onEstado: (valor: Estado) => alFiltrar(() => setEstado(valor)),
      onRango: (valor: RangoDeFechas) => alFiltrar(() => setRango(valor)),
    },
  };
}

interface SalesFilterBarProps {
  /** Prefijo de los `id`: el de Ventas sigue siendo `sales-report`. */
  id: string;
  /** Desde el backoffice el filtro de almacén no aplica (sería el del admin). */
  showWarehouse: boolean;
  /** En `false` no hay filtro de Estado; lo decide `useSalesFilters`. */
  showStatus: boolean;
  warehouseId: string | null;
  estado: Estado;
  rango: RangoDeFechas;
  onWarehouse: (valor: string | null) => void;
  onEstado: (valor: Estado) => void;
  onRango: (valor: RangoDeFechas) => void;
}

/**
 * Sucursal, Estado, Desde y Hasta: la barra de Ventas, compartida por sus dos
 * detalles, que no llevan Estado.
 */
export function SalesFilterBar({
  id,
  showWarehouse,
  showStatus,
  warehouseId,
  estado,
  rango,
  onWarehouse,
  onEstado,
  onRango,
}: SalesFilterBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-end gap-3">
      {showWarehouse && (
        <label htmlFor={`${id}-warehouse`} className="flex min-w-48 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.sales.warehouse")}</span>
          <WarehouseSelect
            id={`${id}-warehouse`}
            value={warehouseId}
            // F10-MANFIX-02: "" es «Todas las sucursales» (allowAll) — se
            // traduce a `null` para que los filtros NO manden `warehouseId`.
            onChange={(valor) => onWarehouse(valor === "" ? null : valor)}
            scoped
            allowAll
          />
        </label>
      )}

      {showStatus && (
        <label htmlFor={`${id}-status`} className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("reports.sales.status")}</span>
          <select
            id={`${id}-status`}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(e) => onEstado(e.target.value as Estado)}
          >
            <option value="todas">{t("pos.history.all")}</option>
            <option value="completed">{t("pos.history.completed")}</option>
            <option value="canceled">{t("pos.history.canceled")}</option>
          </select>
        </label>
      )}

      <DateRangeFilter id={id} from={rango.from} to={rango.to} onChange={onRango} />
    </div>
  );
}
