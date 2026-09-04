import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { Study, StudyKind } from "@/lib/medical-clinic/api";
import { useStudies } from "@/lib/medical-clinic/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface StudyPickerProps {
  kind: StudyKind;
  label: string;
  placeholder: string;
  selectedIds: ReadonlySet<string>;
  onToggle: (study: Study) => void;
}

/**
 * F9-CLINIC-WEB-17 — el buscador de estudios del catálogo.
 *
 * Se comporta como el del punto de venta (Carlos, 2026-09-04): en blanco no
 * propone nada —un catálogo entero desplegado invita a agregar el estudio
 * equivocado— y un CLIC en el renglón lo baja al detalle de la orden, sin
 * casillas que marcar. Quitar es cosa de la tabla de abajo.
 *
 * Y no habla de dinero: el médico ordena estudios, no los cotiza. El total de
 * la orden sí se muestra, porque eso es lo que la caja va a cobrar.
 */
export function StudyPicker({ kind, label, placeholder, selectedIds, onToggle }: StudyPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const estudios = useStudies(kind, { query: termino, page: 1 }, termino !== "");
  const items = (estudios.data?.rows ?? []).filter((s) => s.isActive);
  const buscando = termino !== "";

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={label}
        placeholder={placeholder}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!buscando ? null : estudios.isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.orders.noResults")}</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {items.map((study) => (
            <li key={study.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between py-2 text-left"
                // Ya en la orden: el renglón sigue visible pero no se agrega
                // dos veces (la cantidad de un estudio es una).
                disabled={selectedIds.has(study.id)}
                onClick={() => {
                  onToggle(study);
                  // La lista se va con el término: el renglón ya está abajo y
                  // el buscador queda listo para el siguiente.
                  setQuery("");
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{study.name}</span>
                  <span className="font-mono text-muted-foreground text-xs">{study.code}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
