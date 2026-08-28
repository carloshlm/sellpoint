import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * F7-WEB-03 — el primitivo de diálogo modal de la casa. Antes de F7 los
 * "modales" eran secciones inline (checkout-panel); un overlay real exige lo
 * que este componente garantiza: portal al body (ningún overflow lo
 * recorta), `role="dialog"` + `aria-modal` + título anunciado, cierre por
 * Escape y por backdrop, y el foco ARRANCANDO adentro — un lector de
 * pantalla detrás del overlay queda atrapado en una página que ya no existe.
 *
 * Cerrado se DESMONTA por completo (no `display:none`): sin foco fantasma,
 * sin lectores anunciando contenido invisible.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // El foco entra al panel al abrir; al cerrar, el desmontaje libera.
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: el backdrop es superficie de cierre, no un control — el diálogo interno es el elemento interactivo anunciado
    // biome-ignore lint/a11y/useKeyWithClickEvents: el teclado ya cierra por Escape (listener global de este componente); duplicar un keydown en el backdrop no aporta accesibilidad
    <div
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      onClick={(event) => {
        // Solo el click DIRECTO al fondo cierra: un click dentro del panel
        // burbujea hasta acá pero su target no es el backdrop.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border bg-background p-6 shadow-lg outline-none"
      >
        <h2 id={titleId} className="mb-4 font-semibold text-lg">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
