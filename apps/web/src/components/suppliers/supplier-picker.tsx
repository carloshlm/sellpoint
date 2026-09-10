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
  /** El proveedor elegido (null al quitar). */
  onChange: (supplier: Supplier | null) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * F9-SUPPL-07 — el buscador de proveedores, UNO para Compras y Gastos (molde:
 * `medication-picker.tsx`). Busca solo ACTIVOS con debounce, un clic en el
 * renglón elige, y con uno elegido muestra su nombre con «Quitar». Con solo
 * el id (una ficha que se abre después) trae el nombre por su cuenta.
 */
export function SupplierPicker({ value, onChange, disabled = false, label }: SupplierPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const elegido = useSupplier(value);
  const busqueda = useSuppliers(
    { query: termino, isActive: true, pageSize: 20 },
    { enabled: value === null && termino !== "" },
  );
  const filas = busqueda.data?.rows ?? [];

  if (value !== null) {
    return (
      <div className="flex flex-col gap-2" data-testid="supplier-picker">
        <span className="font-medium text-sm">{label ?? t("suppliers.picker.label")}</span>
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <span className="truncate font-medium" data-testid="supplier-picker-selected">
            {elegido.data?.name ?? "…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            {t("suppliers.picker.clear")}
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
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{fila.name}</span>
                  {(fila.taxId || fila.contactName) && (
                    <span className="flex flex-wrap gap-2 text-muted-foreground text-xs">
                      {fila.taxId && <span className="font-mono">{fila.taxId}</span>}
                      {fila.contactName && <span>{fila.contactName}</span>}
                    </span>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
