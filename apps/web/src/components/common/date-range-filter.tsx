import { useTranslation } from "react-i18next";

/**
 * F3/F5 — el filtro de rango de fechas (2026-08-23, pedido de Carlos).
 *
 * Uno solo para el Kardex y para los tres listados de movimientos. Compartido
 * y no copiado porque son cuatro sitios hoy y los reportes de la Fase 5 van a
 * pedir el quinto: cuatro copias divergen, y la que se quede atrás miente sin
 * ponerse roja.
 *
 * El componente es CONTROLADO y avisa el par completo: el padre arma la
 * consulta con los dos extremos, y mandarle solo el que cambió lo obligaría a
 * recordar el otro — la clase de estado duplicado que un día se desincroniza.
 */
export interface RangoDeFechas {
  /** `YYYY-MM-DD`, o `""` cuando no hay tope por ese lado. */
  from: string;
  to: string;
}

interface DateRangeFilterProps extends RangoDeFechas {
  /** Prefijo de los `id`: dos filtros en la misma pantalla no pueden chocar. */
  id: string;
  onChange: (rango: RangoDeFechas) => void;
}

export function DateRangeFilter({ id, from, to, onChange }: DateRangeFilterProps) {
  const { t } = useTranslation();
  const hayRango = from !== "" || to !== "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-from`}>
        <span className="text-muted-foreground">{t("common.dateRange.from")}</span>
        <input
          id={`${id}-from`}
          type="date"
          value={from}
          // `max` contra el otro extremo: un rango invertido devuelve vacío y
          // el usuario creería que no hay movimientos, cuando lo que hay es un
          // filtro imposible.
          {...(to !== "" && { max: to })}
          onChange={(event) => onChange({ from: event.target.value, to })}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-to`}>
        <span className="text-muted-foreground">{t("common.dateRange.to")}</span>
        <input
          id={`${id}-to`}
          type="date"
          value={to}
          {...(from !== "" && { min: from })}
          onChange={(event) => onChange({ from, to: event.target.value })}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      {/* El botón aparece solo cuando hay algo que limpiar: uno permanente y
          deshabilitado es ruido en una barra que ya tiene cuatro controles. */}
      {hayRango && (
        <button
          type="button"
          onClick={() => onChange({ from: "", to: "" })}
          className="rounded-md border border-input px-3 py-2 text-muted-foreground text-sm hover:bg-accent"
        >
          {t("common.dateRange.clear")}
        </button>
      )}
    </div>
  );
}

/**
 * El rango de los últimos `dias`, con HOY incluido.
 *
 * `dias - 1` no es un error de uno: 30 días contando hoy van del día 30 hacia
 * atrás **inclusive**, así que el 23 de agosto arranca el 25 de julio y no el
 * 24 — son 30 fechas, no 31.
 *
 * Se trabaja en UTC a propósito. `toISOString().slice(0, 10)` sobre una fecha
 * local puede devolver el día anterior para quien está en UTC-6 antes del
 * mediodía, y ese corrimiento silencioso dejaría fuera el movimiento más
 * reciente — justo el que se está buscando.
 */
export function rangoUltimosDias(dias: number, hoy: Date = new Date()): RangoDeFechas {
  const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const inicio = new Date(fin);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  return { from: inicio.toISOString().slice(0, 10), to: fin.toISOString().slice(0, 10) };
}
