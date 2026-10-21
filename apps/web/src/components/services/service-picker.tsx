import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Money } from "@/components/common/money";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { Service } from "@/lib/services/api";
import { useServiceSearch } from "@/lib/services/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface ServicePickerProps {
  /** Los que ya están en la lista: siguen visibles, pero no se agregan dos veces. */
  selectedIds: ReadonlySet<string>;
  disabled?: boolean;
  onAdd: (service: Service) => void;
}

/**
 * F9-RECEP-32 — el buscador de servicios, para elegir uno de un catálogo que
 * puede tener miles (Carlos, 2026-10-21: con casillas «la interfaz se va a
 * ver muy mal»).
 *
 * Se comporta como el de estudios del Consultorio y el del punto de venta: en
 * blanco no propone nada, solo salen los ACTIVOS, y un clic en el renglón lo
 * agrega y deja el buscador listo para el siguiente. Quitar es cosa de la
 * lista de quien lo usa.
 */
export function ServicePicker({ selectedIds, disabled = false, onAdd }: ServicePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const busqueda = useServiceSearch(termino);
  const items = busqueda.data ?? [];
  const buscando = termino !== "";

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t("services.search")}
        placeholder={t("services.searchPlaceholder")}
        type="search"
        autoComplete="off"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!buscando ? null : busqueda.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("services.noResults")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {items.map((service) => (
            <li key={service.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between gap-3 py-2 text-left"
                disabled={disabled || selectedIds.has(service.id)}
                onClick={() => {
                  onAdd(service);
                  setQuery("");
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{service.name}</span>
                  <span className="font-mono text-muted-foreground text-xs">{service.code}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  <Money value={service.price} />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
