import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** Qué se va a hacer. Va como `aria-label` del diálogo. */
  title: string;
  /** Qué se pierde y, si existe, cuál es la alternativa no destructiva. */
  body: string;
  /** Texto del botón que ejecuta. Nunca "Aceptar": nombra la acción. */
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /**
   * Contenido extra ENTRE el cuerpo y los botones: una justificación
   * obligatoria, una casilla de "entiendo". No sustituye al `body` — el texto
   * que explica qué se pierde sigue siendo obligatorio.
   */
  children?: React.ReactNode;
  /**
   * Bloquea el confirmar cuando falta algo que el diálogo mismo pide. Decirlo
   * ANTES del clic es mejor que dejar chocar con el 400 del API.
   */
  confirmDisabled?: boolean;
  /** Un fallo del servidor, contado DENTRO del diálogo y no en otra parte. */
  error?: string;
  "data-testid"?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación para acciones DESTRUCTIVAS.
 *
 * Nació de tener el mismo bloque copiado en el editor de campos y en la tabla
 * de presentaciones, un `window.confirm` en el editor de roles —que no se puede
 * traducir ni estilar y bloquea el hilo— y NADA en el borrado de producto, que
 * es el más caro de todos. Cuatro formas distintas de preguntar lo mismo.
 *
 * Reglas de uso, y son la parte importante:
 *
 * 1. **Solo donde no hay vuelta atrás.** Desactivar, archivar y ocultar se
 *    revierten de un clic y NO llevan confirmación: pedirla para todo entrena
 *    al usuario a aceptar sin leer, y el día que importa ya no lee.
 * 2. **El `body` nombra lo que se va a borrar.** En una tabla de varias filas,
 *    el usuario tiene que poder ver que apuntó a la correcta.
 * 3. **El `confirmLabel` nombra la acción**, no dice "Aceptar". Quien lee solo
 *    los botones tiene que entender qué va a pasar.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  children,
  confirmDisabled = false,
  error,
  "data-testid": testId,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-label={title}
      data-testid={testId}
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
    >
      <p className="text-sm">{body}</p>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {/* `type="button"` NO es opcional: un `<button>` sin type dentro de un
            `<form>` es `submit`. Con el diálogo montado dentro del formulario
            de producto, confirmar disparaba TAMBIÉN el submit — que empieza
            limpiando el error y se comía el mensaje del rechazo. Lo cazó el
            test del 409 "es componente de otro". */}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy || confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

export { ConfirmDialog };
