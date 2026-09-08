import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RowAction } from "@/components/ui/row-action";
import { cn } from "@/lib/utils";

interface RowListProps<T> {
  rows: readonly T[];
  onChange: (rows: T[]) => void;
  /** Pinta los campos de UNA fila; `patch` funde cambios en esa fila. */
  render: (row: T, patch: (changes: Partial<T>) => void, index: number) => ReactNode;
  emptyRow: () => T;
  /** Texto del botón de agregar («+ Agregar alergia»); sin él, «Agregar». */
  addLabel?: string;
  /** Nombre accesible de la lista. */
  label?: string;
  max?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * F9-CLINIC-HC-04 — una lista de filas editables: alergias, medicamentos,
 * cirugías, resultados, diagnósticos… Cada formulario decide qué campos
 * lleva la fila; esta primitiva pone el «Agregar», el «Quitar» de cada una
 * y mueve el foco a la fila nueva para que el médico siga tecleando sin
 * tocar el mouse. Sin filas, solo el botón.
 */
export function RowList<T>({
  rows,
  onChange,
  render,
  emptyRow,
  addLabel,
  label,
  max,
  disabled = false,
  className,
}: RowListProps<T>) {
  const { t } = useTranslation();
  const lista = useRef<HTMLUListElement>(null);
  const [enfocar, setEnfocar] = useState<number | null>(null);

  useEffect(() => {
    if (enfocar === null) return;
    const fila = lista.current?.children.item(enfocar);
    const campo = fila?.querySelector<HTMLElement>("input, select, textarea");
    campo?.focus();
    setEnfocar(null);
  }, [enfocar]);

  const patchAt = (index: number) => (changes: Partial<T>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const quitar = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const agregar = () => {
    onChange([...rows, emptyRow()]);
    setEnfocar(rows.length);
  };
  const lleno = max !== undefined && rows.length >= max;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {rows.length > 0 ? (
        <ul ref={lista} aria-label={label} className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li
              // El índice es la identidad: las filas no tienen id propio.
              // biome-ignore lint/suspicious/noArrayIndexKey: filas sin id
              key={index}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end"
            >
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                {render(row, patchAt(index), index)}
              </div>
              <RowAction
                intent="delete"
                type="button"
                disabled={disabled}
                onClick={() => quitar(index)}
                aria-label={`${t("common.form.remove")} ${index + 1}`}
              >
                {t("common.form.remove")}
              </RowAction>
            </li>
          ))}
        </ul>
      ) : null}
      {lleno ? null : (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={disabled}
          onClick={agregar}
        >
          + {addLabel ?? t("common.form.add")}
        </Button>
      )}
    </div>
  );
}
