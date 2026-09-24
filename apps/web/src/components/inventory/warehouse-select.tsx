import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useScopedWarehouses, useWarehouses } from "@/lib/warehouses/hooks";
import { useAuthStore } from "@/stores/auth.store";

/** Lo único que el selector lee de una sucursal. */
export interface WarehouseOption {
  id: string;
  name: string;
}

/**
 * Una lista que YA trajo quien llama: el `data` y el `isPending` de su
 * consulta de React Query, que es lo que el selector mira para pintarse.
 */
export interface WarehouseSource {
  data: WarehouseOption[] | undefined;
  isPending: boolean;
}

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
  /**
   * Qué decir sin almacenes. El de fábrica habla de «registrar movimientos»,
   * que en una orden de compra o una compra no es lo que la persona intenta.
   */
  emptyMessage?: string;
  /**
   * F10-MANFIX-02 — suma la opción «Todas las sucursales» (`value` en cadena
   * vacía) y APAGA la auto-selección de la asignada o la única. Solo lo
   * encienden los reportes: ahí «Todas» es un resultado seguro porque el API
   * sin `warehouseId` ya junta el alcance del usuario, y por eso una dueña
   * con una sucursal asignada tiene que poder ver el negocio completo sin
   * que el selector se la gane de entrada.
   *
   * Los movimientos NO prenden esto: ahí la auto-selección de F3-HOME-04
   * sigue siendo lo correcto.
   */
  allowAll?: boolean;
  /**
   * F10-MANFIX-08 — las opciones YA CARGADAS por quien llama, en vez de
   * pedirlas a `/warehouses`. Lo usa «Abrir turno»: el cajero (rol Seller) no
   * tiene `warehouses:read`, así que la caja trae su propia lista
   * (`GET /pos/warehouses`, con `pos:sell`). Con esto puesto el selector no
   * consulta nada por su cuenta y `scoped` no aplica: la lista ya viene
   * acotada. La preselección de la asignada y la auto-selección de la única
   * siguen igual.
   */
  source?: WarehouseSource;
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
  emptyMessage,
  allowAll = false,
  source,
}: WarehouseSelectProps) {
  const { t } = useTranslation();
  // Con `source`, las dos consultas de siempre se quedan apagadas: quien llama
  // ya trajo la lista, y pedirla aquí sería un 403 seguro para quien no tiene
  // `warehouses:read`. Sin `source`, todo queda exactamente como estaba.
  const propia = source === undefined;
  const todos = useWarehouses(propia);
  const delAlcance = useScopedWarehouses(propia);
  const query: WarehouseSource = source ?? (scoped ? delAlcance : todos);

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
    if (allowAll || inicial === undefined || value !== null || yaAviso.current) {
      return;
    }
    yaAviso.current = true;
    onChangeRef.current(inicial);
  }, [inicial, value, allowAll]);

  // Mientras carga, un desplegable DESHABILITADO con el mismo `id`, no un
  // texto suelto (Carlos, 2026-09-14). Las pantallas lo rotulan con
  // `<label htmlFor={id}>`: con un `<p>` en su lugar, la etiqueta apuntaba por
  // un instante a un id que no existía y Chrome lo reportaba como «Incorrect
  // use of <label for=FORM_ELEMENT>» — pasajero, según qué tan rápido
  // respondiera la lista. De paso la pantalla ya no brinca al terminar.
  if (query.isPending) {
    return (
      <select
        id={id}
        disabled
        className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        value=""
        onChange={() => {}}
      >
        <option value="">{t("inventory.warehouse.loading")}</option>
      </select>
    );
  }

  if (opciones.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {emptyMessage ?? t("inventory.warehouse.empty")}
      </p>
    );
  }

  return (
    <select
      id={id}
      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {allowAll ? (
        <option value="">{t("inventory.warehouse.all")}</option>
      ) : (
        <option value="" disabled>
          {t("inventory.warehouse.placeholder")}
        </option>
      )}
      {opciones.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.name}
        </option>
      ))}
    </select>
  );
}
