import type * as React from "react";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface NumberFieldProps
  extends Omit<
    React.ComponentProps<"input">,
    "type" | "inputMode" | "value" | "onChange" | "min" | "max"
  > {
  label: string;
  /** El texto crudo del campo, tal como el padre lo guarda en su estado. */
  value: string;
  onChange: (value: string) => void;
  /** Sufijo dentro del campo: «kg», «cm», «mmHg», «°C», «%», «lpm»… */
  unit?: string;
  /** 0 = entero (teclado numérico sin punto). */
  decimals?: number;
  /** Mensaje de error YA traducido. Presente → input inválido + role=alert. */
  error?: string;
  /** Ayuda contextual (ej. el rango normal). */
  hint?: string;
  /** Pinta el hint con un tono: `warning` (fuera de rango) o `destructive` (alarma). */
  hintTone?: "muted" | "warning" | "destructive";
}

/**
 * F9-CLINIC-HC-03 — un número con su unidad (Carlos, 2026-09-08).
 *
 * Es el primo de `MoneyInput`: la etiqueta dice QUÉ se mide («Peso») y el
 * campo dice EN QUÉ («kg»). Texto con teclado decimal, no `type="number"`
 * (flechitas, «e», rueda del mouse). Las letras no entran; la coma y el
 * punto de más entran y el error los explica, porque descartar «36,5» en
 * silencio lo convertiría en «365».
 */
/** Dígitos, punto y coma: el punto y la coma entran aunque no quepan, para que el error los explique. */
const ADMITIDO = /^[\d.,]*$/;

function NumberField({
  label,
  value,
  onChange,
  unit,
  decimals = 0,
  error,
  hint,
  hintTone = "muted",
  className,
  disabled,
  ...inputProps
}: NumberFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const unitId = `${id}-unit`;
  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null, unit ? unitId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-base transition-[color,box-shadow] md:text-sm",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          error && "border-destructive ring-3 ring-destructive/20 dark:ring-destructive/40",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          id={id}
          type="text"
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const texto = event.target.value;
            if (ADMITIDO.test(texto)) onChange(texto);
          }}
          {...inputProps}
        />
        {unit ? (
          <span id={unitId} className="select-none font-medium text-muted-foreground text-xs">
            {unit}
          </span>
        ) : null}
      </div>
      {hint && !error && (
        <p
          id={hintId}
          aria-live="polite"
          className={cn(
            "text-xs",
            hintTone === "warning" && "text-warning",
            hintTone === "destructive" && "text-destructive",
            hintTone === "muted" && "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export { NumberField, type NumberFieldProps };
