import type * as React from "react";

import { cn } from "@/lib/utils";

interface ReadOnlyFieldProps {
  /** El nombre del dato: «Email», «País», «Moneda». */
  label: string;
  /** El valor que se muestra, sin posibilidad de editarlo. */
  children: React.ReactNode;
  /** Por qué no se edita, o qué significa. */
  hint?: string;
  /** Va en el VALOR, para que las pruebas lean lo que ve la persona. */
  testId?: string;
  className?: string;
}

/**
 * Un dato de SOLO LECTURA dentro de un formulario (Carlos, 2026-09-14).
 *
 * ── Por qué no es un `<Label>` ───────────────────────────────────────────
 *
 * El correo, el país y la moneda de Mi perfil se mostraban con `<Label>` sobre
 * un `<p>`. Pero `<label>` es EXCLUSIVO de campos editables: sin `htmlFor` ni un
 * campo adentro, no rotula nada. Chrome lo reportaba en su panel de avisos
 * («No label associated with a form field», `FormLabelHasNeitherForNorNestedInput`)
 * y un lector de pantalla leía «Email» suelto, sin saber de qué.
 *
 * Un par nombre–valor que no se edita es, semánticamente, una lista de
 * definiciones: `<dt>` para el nombre, `<dd>` para el valor. El lector de
 * pantalla anuncia la relación, y se ve IGUAL que un campo con su etiqueta:
 * el `<dt>` usa las mismas clases que `Label`.
 *
 * `components/ui/label-usage.test.ts` impide que vuelva a aparecer un
 * `<Label>` sin campo al que apuntar.
 */
function ReadOnlyField({ label, children, hint, testId, className }: ReadOnlyFieldProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <dl className="flex flex-col gap-2">
        {/* Las mismas clases de `Label`: mismo aspecto que un campo rotulado. */}
        <dt className="flex select-none items-center gap-2 font-medium text-sm leading-none">
          {label}
        </dt>
        <dd data-testid={testId} className="text-sm">
          {children}
        </dd>
      </dl>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export { ReadOnlyField, type ReadOnlyFieldProps };
