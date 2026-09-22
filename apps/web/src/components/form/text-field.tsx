import type * as React from "react";
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TextFieldProps extends React.ComponentProps<"input"> {
  label: string;
  /** Mensaje de error YA traducido. Presente → input inválido + role=alert. */
  error?: string;
  /** Ayuda contextual (ej. "Mínimo 12 caracteres"). */
  hint?: string;
  /** Pinta el hint como cumplido (validación en vivo de password). */
  hintMet?: boolean;
  /** Algo pegado al borde derecho DENTRO del campo (el ojo de la contraseña). */
  trailing?: React.ReactNode;
}

/**
 * Campo de texto presentacional: label asociado por htmlFor, error anunciado
 * (role=alert + aria-describedby) y foco visible vía tokens --ring.
 */
function TextField({
  label,
  error,
  hint,
  hintMet = false,
  trailing,
  className,
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(trailing && "pr-10")}
          {...inputProps}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        )}
      </div>
      {hint && !error && (
        <p
          id={hintId}
          aria-live="polite"
          className={cn("text-xs", hintMet ? "text-success" : "text-muted-foreground")}
        >
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

export { TextField };
