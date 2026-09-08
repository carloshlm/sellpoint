import { useId } from "react";

import { MoneyInput, type MoneyInputProps } from "@/components/form/money-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface MoneyFieldProps
  extends Omit<MoneyInputProps, "id" | "aria-invalid" | "aria-describedby"> {
  label: string;
  /** Mensaje de error YA traducido. Presente → input inválido + role=alert. */
  error?: string;
  /** Ayuda contextual bajo el campo. */
  hint?: string;
}

/**
 * Gemelo de `TextField` para importes: label asociado por htmlFor, error
 * anunciado (role=alert + aria-describedby) y `MoneyInput` en el medio. El
 * error lo calcula el formulario con `moneyInputError` y lo pasa ya traducido,
 * igual que en `TextField`: el que bloquea el envío y el que pinta en rojo
 * tienen que ser el mismo criterio.
 */
function MoneyField({ label, error, hint, className, ...inputProps }: MoneyFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <MoneyInput
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs">
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

export { MoneyField };
