import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * F9-CLINIC-HC-04 — «Negados» / «Ninguno» / «Negadas» en un clic.
 *
 * El médico marca lo positivo; lo negativo es UNA casilla. Se GUARDA
 * explícito (`{ negated: true }`): un expediente con «AHF negados» no es un
 * expediente sin AHF, y la NOM distingue las dos cosas. Quien lo usa
 * deshabilita el resto del formulario mientras esté marcado y manda solo la
 * marca; lo tecleado antes se queda en pantalla hasta guardar, por si fue un
 * clic de más.
 */
export function NegatedToggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="font-medium">
          {label}
        </Label>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
    </div>
  );
}
