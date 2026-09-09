import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { Icd10Code } from "@/lib/medical-clinic/api";
import { useIcd10Search } from "@/lib/medical-clinic/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface Icd10PickerProps {
  label: string;
  onPick: (code: Icd10Code) => void;
}

/**
 * F9-CLINIC-HC-23 — el buscador del catálogo CIE-10 (México, DGIS). Se
 * teclea código («j06») o texto («faringitis»), sin acentos si se quiere, y
 * un clic en el renglón elige. La captura a mano sigue permitida: esto
 * ayuda, no obliga.
 */
export function Icd10Picker({ label, onPick }: Icd10PickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const resultados = useIcd10Search(termino);
  const items = resultados.data ?? [];

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <TextField
        label={label}
        placeholder={t("medicalClinic.forms.diagnoses.searchPlaceholder")}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {termino === "" ? null : resultados.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("medicalClinic.attend.searchFailed")}
        </p>
      ) : resultados.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.orders.noResults")}</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.code}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start gap-3 py-2 text-left"
                onClick={() => {
                  onPick(item);
                  setQuery("");
                }}
              >
                <span className="shrink-0 font-mono text-xs">{item.code}</span>
                <span className="min-w-0 truncate font-normal">{item.title}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
