import type * as React from "react";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends Omit<React.ComponentProps<"select">, "children"> {
  label: string;
  options: readonly SelectOption[];
  /** Mensaje de error YA traducido. Presente → select inválido + role=alert. */
  error?: string;
  /** Ayuda contextual bajo el campo. */
  hint?: string;
}

/**
 * Gemelo de `TextField` para selección: label asociado por htmlFor, error
 * anunciado (role=alert + aria-describedby) y foco visible vía tokens --ring.
 * SOLO clases semánticas: el theming por tenant lo repinta sin tocarlo.
 */
function SelectField({ label, options, error, hint, className, ...selectProps }: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { SelectField };
