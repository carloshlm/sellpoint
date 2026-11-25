import { localCalendarDate } from "@sellpoint/shared";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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

/**
 * F10-KPI-12 — con qué filtros abre Ventas cuando se llega por un enlace
 * (`/reports/sales?status=canceled&discounted=true`), ya validados por la
 * ruta. Solo son el valor INICIAL: después, la pantalla los cambia como
 * siempre.
 */
export interface SalesFiltersInitial {
  status?: "completed" | "canceled";
  discounted?: boolean;
  from?: string;
  to?: string;
}

/**
 * F10-RPT-02 — con qué filtros abren «Ventas por producto» y «Ventas por
 * servicio» por un enlace: el del aviso «creció» del panel y los de los
 * reportes por artículo. El contrato de esos enlaces es
 * `/reports/sales-by-product?itemId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD`, y
 * lo mismo con `sales-by-service`.
 */
export interface SalesLinesFiltersInitial {
  /** El producto (o el servicio) del que se ven las ventas. */
  itemId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
}

const fechaDeCalendario = z.iso.date();

/** Un id del API, o nada: el API responde 400 a cualquier otra cosa. */
function idValido(valor: unknown): string | undefined {
  const id = z.uuid().safeParse(valor);
  return id.success ? id.data : undefined;
}

function fechaValida(valor: unknown): string | undefined {
  const fecha = fechaDeCalendario.safeParse(valor);
  return fecha.success ? fecha.data : undefined;
}

/**
 * El `validateSearch` de las dos rutas, como el de Ventas: lo que venga en la
 * URL es texto que escribió cualquiera, y lo inválido se descarta (la
 * pantalla abre como siempre) en vez de mandarle al API algo que respondería
 * 400.
 *
 * Devuelve las cuatro claves SIEMPRE, en `undefined` si no sirven: el router
 * mezcla lo validado ENCIMA de lo crudo de la URL, y omitir una clave dejaría
 * pasar el valor inválido tal como llegó.
 */
export function validateSalesLinesSearch(
  search: Record<string, unknown>,
): SalesLinesFiltersInitial {
  return {
    itemId: idValido(search.itemId),
    warehouseId: idValido(search.warehouseId),
    from: fechaValida(search.from),
    to: fechaValida(search.to),
  };
}

interface SalesFiltersOptions {
  /**
   * Si la pantalla ofrece el filtro de Estado. Ventas sí; «Ventas por
   * producto» y «Ventas por servicio» no (Carlos, 2026-11-02): listan solo lo
   * cobrado y su API responde 400 si llega `status`.
   */
  showStatus?: boolean;
  /**
   * F10-KPI-12 — si ofrece «Solo con descuento». Solo Ventas: el descuento es
   * del ticket, y los reportes de líneas responden 400 si llega `discounted`.
   */
  showDiscounted?: boolean;
  initial?: SalesFiltersInitial;
  /**
   * F10-RPT-02 — la sucursal con que abre, ya validada. Va aparte de
   * `initial` a propósito: Ventas le pasa su búsqueda ENTERA, y ahí el router
   * deja lo crudo de la URL que su `validateSearch` no conoce; un
   * `?warehouseId=` cualquiera llegaría al API sin pasar por la aduana.
   */
  initialWarehouseId?: string;
}

/**
 * Los filtros de las ventas y su página. Cambiar un filtro vuelve a la página
 * 1: quedarse en la 7 de otra consulta muestra filas que no son las pedidas.
 */
export function useSalesFilters({
  showStatus = true,
  showDiscounted = false,
  initial = {},
  initialWarehouseId,
}: SalesFiltersOptions = {}) {
  const rangoPorOmision = useRangoInicial();
  // Un enlace con fechas manda el rango completo: si trae solo «Hasta», no se
  // asume «Desde» en hoy (daría un rango al revés).
  const rangoInicial =
    initial.from !== undefined || initial.to !== undefined
      ? { from: initial.from ?? "", to: initial.to ?? "" }
      : rangoPorOmision;
  const [warehouseId, setWarehouseId] = useState<string | null>(initialWarehouseId ?? null);
  const [estado, setEstado] = useState<Estado>(initial.status ?? "todas");
  const [soloConDescuento, setSoloConDescuento] = useState(initial.discounted === true);
  const [rango, setRango] = useState<RangoDeFechas>(rangoInicial);
  const [page, setPage] = useState(1);

  /**
   * Los FILTROS van separados de la paginación: el endpoint de export no
   * pagina y su schema es `.strict()`, así que mandarle `page` responde 400.
   */
  const filtros: SalesReportQuery = {
    ...(warehouseId !== null && { warehouseId }),
    ...(showStatus && estado !== "todas" && { status: estado }),
    ...(showDiscounted && soloConDescuento && { discounted: true }),
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
      showDiscounted,
      warehouseId,
      estado,
      discounted: soloConDescuento,
      rango,
      onWarehouse: (valor: string | null) => alFiltrar(() => setWarehouseId(valor)),
      onEstado: (valor: Estado) => alFiltrar(() => setEstado(valor)),
      onDiscounted: (valor: boolean) => alFiltrar(() => setSoloConDescuento(valor)),
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
  /** En `false` no hay «Solo con descuento»; lo decide `useSalesFilters`. */
  showDiscounted: boolean;
  warehouseId: string | null;
  estado: Estado;
  discounted: boolean;
  rango: RangoDeFechas;
  onWarehouse: (valor: string | null) => void;
  onEstado: (valor: Estado) => void;
  onDiscounted: (valor: boolean) => void;
  onRango: (valor: RangoDeFechas) => void;
  /**
   * F10-RPT-04 — los filtros propios de una pantalla, al final de la barra:
   * el Tipo de los reportes por artículo. Así comparten renglón y separación
   * con los de siempre.
   */
  children?: ReactNode;
}

/**
 * Sucursal, Estado, Desde y Hasta: la barra de Ventas, compartida por sus dos
 * detalles, que no llevan Estado. Ventas suma «Solo con descuento», y los
 * reportes por artículo, su Tipo.
 */
export function SalesFilterBar({
  id,
  showWarehouse,
  showStatus,
  showDiscounted,
  warehouseId,
  estado,
  discounted,
  rango,
  onWarehouse,
  onEstado,
  onDiscounted,
  onRango,
  children,
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

      {showDiscounted && (
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="discounted"
            checked={discounted}
            onChange={(e) => onDiscounted(e.target.checked)}
          />
          {t("reports.sales.onlyDiscounted")}
        </label>
      )}

      {children}
    </div>
  );
}
