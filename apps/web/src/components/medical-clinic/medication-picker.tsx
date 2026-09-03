import type { Currency } from "@sellpoint/shared";
import { formatMoney, formatQuantity } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MedicationItem } from "@/lib/medical-clinic/api";
import { useStockSearch } from "@/lib/medical-clinic/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

export type MedicationPresentation = MedicationItem["presentations"][number];

interface MedicationPickerProps {
  label: string;
  placeholder: string;
  /** Falso cuando el negocio no vende medicamentos: la existencia no aplica. */
  showStock: boolean;
  onAdd: (item: MedicationItem, presentation: MedicationPresentation) => void;
}

/** La presentación con la que se receta: la de venta por defecto, o la primera. */
export function salePresentationOf(item: MedicationItem): MedicationPresentation | undefined {
  return item.presentations.find((p) => p.isDefaultSale) ?? item.presentations[0];
}

/**
 * F9-CLINIC-WEB-18 — el buscador de medicamentos en el stock del médico.
 * Un producto en cero se lista con «Sin existencia» y SÍ se puede recetar:
 * la receta es del paciente, no del anaquel.
 */
export function MedicationPicker({ label, placeholder, showStock, onAdd }: MedicationPickerProps) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const stock = useStockSearch(termino);
  const items = stock.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={label}
        placeholder={placeholder}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {termino === "" ? null : stock.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("medicalClinic.attend.searchFailed")}
        </p>
      ) : stock.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.orders.noResults")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-md border">
          {items.map((item) => {
            const presentacion = salePresentationOf(item);
            const disponible = Number(item.available);
            return (
              <li
                key={item.id}
                data-testid={`medication-${item.id}`}
                className="flex items-center gap-3 px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                    <span className="font-mono">{item.sku}</span>
                    {showStock ? (
                      disponible > 0 ? (
                        <span>
                          {t("medicalClinic.orders.available", {
                            quantity: formatQuantity(item.available, item.baseUnit),
                          })}
                        </span>
                      ) : (
                        <Badge variant="warning">{t("medicalClinic.orders.noStock")}</Badge>
                      )
                    ) : null}
                  </span>
                </span>
                <span className="text-sm tabular-nums">
                  {presentacion?.price
                    ? formatMoney(Number(presentacion.price), currency, locale)
                    : "—"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!presentacion}
                  onClick={() => presentacion && onAdd(item, presentacion)}
                >
                  {t("common.form.add")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
