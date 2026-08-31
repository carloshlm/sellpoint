import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * La acción de fila unificada de los listados (Carlos, 2026-08-25).
 *
 * Antes cada listado inventaba su vocabulario para la misma acción:
 * "Archivar" en subcatálogos, "Quitar" en campos, "Desactivar" en servicios.
 * Acá el label viene AMARRADO a la intención (claves `common.actions.*`), así
 * que usar el componente ES unificar la nomenclatura — divergir requeriría no
 * usarlo. `children` existe para los casos con semántica propia (un usuario
 * se SUSPENDE, no se desactiva) y aun ahí el color sigue el de la intención.
 *
 * Colores por TOKEN del tema, nunca literales — el mismo contrato que
 * `SURFACE` (ui/surface.ts): los temas del wizard re-pintan estos enlaces
 * cambiando solo los tokens de index.css.
 */
export type RowActionIntent = "view" | "edit" | "deactivate" | "reactivate" | "delete";

export const INTENT_CLASS: Record<RowActionIntent, string> = {
  // `view` comparte color con `edit`: las dos LLEVAN al detalle, y el color
  // dice "esta es la acción principal de la fila". Lo que cambia es la
  // promesa de la palabra — ver no compromete a nada, editar sí.
  view: "text-primary hover:text-primary",
  edit: "text-primary hover:text-primary",
  deactivate: "text-warning hover:text-warning",
  reactivate: "text-success hover:text-success",
  delete: "text-destructive hover:text-destructive",
};

const INTENT_LABEL_KEY: Record<RowActionIntent, string> = {
  view: "common.actions.view",
  edit: "common.actions.edit",
  deactivate: "common.actions.deactivate",
  reactivate: "common.actions.reactivate",
  delete: "common.actions.delete",
};

interface RowActionProps extends Omit<React.ComponentProps<typeof Button>, "variant" | "size"> {
  intent: RowActionIntent;
}

function RowAction({ intent, className, children, ...buttonProps }: RowActionProps) {
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(INTENT_CLASS[intent], className)}
      {...buttonProps}
    >
      {children ?? t(INTENT_LABEL_KEY[intent])}
    </Button>
  );
}

export { RowAction };
