import type * as React from "react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TextAreaFieldProps extends React.ComponentProps<"textarea"> {
  label: string;
  /** Mensaje de error YA traducido. Presente → campo inválido + role=alert. */
  error?: string;
  hint?: string;
}

/**
 * F9-CLINIC-WEB-02 — el gemelo de `TextField` para texto largo (motivo de
 * consulta, padecimiento actual, indicaciones). Mismo contrato de
 * accesibilidad: label enlazado, hint por `aria-describedby`, error con
 * `role="alert"`. Solo tokens.
 */
function TextAreaField({ label, error, hint, className, rows = 4, ...props }: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint && !error ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
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

export { TextAreaField };
