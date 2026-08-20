import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useScopedWarehouses, useWarehouses } from "@/lib/warehouses/hooks";
import { useAuthStore } from "@/stores/auth.store";

interface WarehouseSelectProps {
  value: string | null;
  onChange: (warehouseId: string) => void;
  /**
   * `true` en todo lo que MUEVE stock: solo los almacenes que el usuario
   * administra. Un Manager no tiene que poder ni elegir uno ajeno — el 403
   * posterior sería una explicación tardía de algo que la pantalla no debió
   * ofrecer.
   */
  scoped?: boolean;
  /** El destino de un traspaso no puede ser el origen. */
  excludeIds?: string[];
  id?: string;
  disabled?: boolean;
}

/**
 * F3-NAV-01 — el selector de almacén de toda la Fase 3.
 *
 * Dos comportamientos que parecen detalles y no lo son:
 *
 *  · **auto-selección con uno solo**: la enorme mayoría de los negocios tiene
 *    un almacén, y obligarlos a elegirlo en cada movimiento es fricción pura;
 *  · **estado vacío en vez de un desplegable sin opciones**: un `<select>`
 *    vacío no dice qué hacer; el mensaje sí.
 */
export function WarehouseSelect({
  value,
  onChange,
  scoped = false,
  excludeIds = [],
  id,
  disabled = false,
}: WarehouseSelectProps) {
  const { t } = useTranslation();
  const todos = useWarehouses();
  const delAlcance = useScopedWarehouses();
  const query = scoped ? delAlcance : todos;

  const opciones = useMemo(
    () => (query.data ?? []).filter((w) => !excludeIds.includes(w.id)),
    [query.data, excludeIds],
  );

  // El aviso se dispara UNA vez por montaje. Ni `onChange` ni `excludeIds`
  // son estables entre renders (los llamadores pasan literales:
  // `onChange={(id) => mutate(...)}`, `excludeIds={[origen]}`), así que sin
  // este guardia el efecto se re-dispara mientras `value` siga en null — y
  // `value` se queda en null para siempre si el PATCH que el aviso dispara
  // FALLA. Eso no es un render de más: es martillar al servidor con el mismo
  // PATCH que ya falló.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const yaAviso = useRef(false);

  // F3-HOME-04: el almacén ASIGNADO del usuario manda sobre el auto-select de
  // "hay uno solo" — pero SOLO si está entre sus opciones. Un asignado fuera de
  // alcance o desactivado no se fuerza: mandarlo sería ofrecerle al usuario un
  // almacén que el API va a rechazar. En ese caso se degrada al comportamiento
  // de siempre, que es lo que este componente hacía antes de existir la
  // asignación.
  const asignado = useAuthStore((state) => state.user?.defaultWarehouseId ?? null);
  const asignadoDisponible =
    asignado !== null && opciones.some((w) => w.id === asignado) ? asignado : undefined;

  const unico = opciones.length === 1 ? opciones[0] : undefined;
  const inicial = asignadoDisponible ?? unico?.id;
  useEffect(() => {
    if (inicial === undefined || value !== null || yaAviso.current) {
      return;
    }
    yaAviso.current = true;
    onChangeRef.current(inicial);
  }, [inicial, value]);

  if (query.isPending) {
    return <p className="text-muted-foreground text-sm">{t("inventory.warehouse.loading")}</p>;
  }

  if (opciones.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("inventory.warehouse.empty")}</p>;
  }

  return (
    <select
      id={id}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        {t("inventory.warehouse.placeholder")}
      </option>
      {opciones.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.name}
        </option>
      ))}
    </select>
  );
}
