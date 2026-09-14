import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { Supplier } from "@/lib/suppliers/api";
import { useSupplier, useSuppliers } from "@/lib/suppliers/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface SupplierPickerProps {
  /** El id elegido; null sin proveedor. */
  value: string | null;
  /** El proveedor elegido (null al quitar, solo si `clearable`). */
  onChange: (supplier: Supplier | null) => void;
  disabled?: boolean;
  label?: string;
  /**
   * ¿Se puede dejar SIN proveedor? (Carlos, 2026-09-13.)
   *
   * Un filtro de listado sí —quitarlo es «todos»— y un gasto también, porque
   * puede pagarse a un beneficiario suelto. Una orden de compra y una compra
   * NO: son un compromiso con alguien, y el API las exige con proveedor desde
   * que nacen. Ahí el botón pasa a ser «Cambiar»: muestra el buscador sin
   * soltar al que ya está, y el documento nunca queda huérfano.
   */
  clearable?: boolean;
}

/**
 * F9-SUPPL-07 — el buscador de proveedores, UNO para Compras y Gastos (molde:
 * `medication-picker.tsx`). Busca solo ACTIVOS con debounce, un clic en el
 * renglón elige. Con solo el id (una ficha que se abre después) trae el
 * nombre por su cuenta.
 *
 * Con uno elegido el buscador se esconde, así que el botón de al lado es la
 * ÚNICA salida: por eso donde no se puede quitar tampoco se puede borrar el
 * botón —quien se equivocó de proveedor quedaría atrapado en su borrador— y
 * lo que cambia es lo que el botón hace.
 */
export function SupplierPicker({
  value,
  onChange,
  disabled = false,
  label,
  clearable = true,
}: SupplierPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  /** Buscando un reemplazo, con el actual todavía puesto. */
  const [cambiando, setCambiando] = useState(false);
  const termino = useDebouncedValue(query.trim());
  const elegido = useSupplier(value);
  const buscando = value === null || cambiando;
  const busqueda = useSuppliers(
    { query: termino, isActive: true, pageSize: 20 },
    { enabled: buscando && termino !== "" },
  );
  const filas = busqueda.data?.rows ?? [];

  if (value !== null && !cambiando) {
    return (
      <div className="flex flex-col gap-2" data-testid="supplier-picker">
        {/*
          Misma medida que `Label` + `Input` (Carlos, 2026-09-13): el título
          era un `span` con la altura de línea normal y la caja tenía `py-2`
          alrededor de un botón `sm`. El `Label` de al lado usa `leading-none`
          y el `Input` mide `h-9`, así que el proveedor quedaba unos píxeles
          más abajo y más alto que la fecha con la que comparte fila.
        */}
        <span className="font-medium text-sm leading-none" data-testid="supplier-picker-label">
          {label ?? t("suppliers.picker.label")}
        </span>
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm">
          <span className="truncate font-medium" data-testid="supplier-picker-selected">
            {elegido.data?.name ?? "…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (clearable) {
                onChange(null);
                return;
              }
              setQuery("");
              setCambiando(true);
            }}
          >
            {clearable ? t("suppliers.picker.clear") : t("suppliers.picker.change")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="supplier-picker">
      <TextField
        label={label ?? t("suppliers.picker.label")}
        placeholder={t("suppliers.picker.placeholder")}
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      {/* Buscando un reemplazo: se puede volver al que ya estaba, o el
          borrador quedaría a medio cambiar hasta recargar la pantalla. */}
      {cambiando && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setQuery("");
              setCambiando(false);
            }}
          >
            {t("suppliers.picker.cancelChange")}
          </Button>
        </div>
      )}
      {termino === "" ? null : busqueda.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("suppliers.picker.searchFailed")}
        </p>
      ) : busqueda.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("suppliers.picker.noResults")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {filas.map((fila) => (
            <li key={fila.id} data-testid={`supplier-option-${fila.id}`}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between py-2 text-left"
                onClick={() => {
                  onChange(fila);
                  setQuery("");
                  setCambiando(false);
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{fila.name}</span>
                  <span className="flex flex-wrap gap-2 text-muted-foreground text-xs">
                    <span className="font-mono">{fila.code}</span>
                    {fila.taxId && <span className="font-mono">{fila.taxId}</span>}
                    {fila.contactName && <span>{fila.contactName}</span>}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
