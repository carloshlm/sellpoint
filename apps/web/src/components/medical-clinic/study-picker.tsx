import type { Currency } from "@sellpoint/shared";
import { formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import type { Study, StudyKind } from "@/lib/medical-clinic/api";
import { useStudies } from "@/lib/medical-clinic/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

interface StudyPickerProps {
  kind: StudyKind;
  label: string;
  placeholder: string;
  selectedIds: ReadonlySet<string>;
  onToggle: (study: Study) => void;
}

/**
 * F9-CLINIC-WEB-17 — el buscador de estudios del catálogo: cada resultado es
 * una casilla; marcarla agrega la línea, desmarcarla la quita. Sin
 * búsqueda muestra la primera página del catálogo, que en un consultorio
 * chico es TODO el catálogo.
 */
export function StudyPicker({ kind, label, placeholder, selectedIds, onToggle }: StudyPickerProps) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const estudios = useStudies(kind, { query: termino || undefined, page: 1 });
  const items = (estudios.data?.rows ?? []).filter((s) => s.isActive);

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={label}
        placeholder={placeholder}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {estudios.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.orders.noResults")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-md border">
          {items.map((study) => (
            <li key={study.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                aria-label={study.name}
                checked={selectedIds.has(study.id)}
                onCheckedChange={() => onToggle(study)}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{study.name}</span>
                <span className="font-mono text-muted-foreground text-xs">{study.code}</span>
              </span>
              <span className="text-sm tabular-nums">
                {study.price === null ? "—" : formatMoney(Number(study.price), currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
