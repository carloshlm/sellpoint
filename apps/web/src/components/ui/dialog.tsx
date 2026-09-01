import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * El callback vive en una ref para que el listener de Escape no dependa de
   * su identidad. Quien usa este diálogo escribe `onClose={() => setX(null)}`
   * —una función NUEVA en cada render— y con eso en las dependencias el
   * efecto se re-ejecutaba en cada cambio de estado del padre.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /**
   * ⚠ El foco entra al panel SOLO al abrir, y por eso este efecto depende
   * únicamente de `open`.
   *
   * Antes compartía efecto con el listener de Escape, que dependía también
   * de `onClose`: como esa función se recrea en cada render del padre, el
   * efecto corría de nuevo con cada cambio de estado y el `focus()` ROBABA
   * el cursor. Con campos no controlados no se notaba —escribir no
   * re-renderizaba al padre—, pero en cuanto un diálogo tuvo un input
   * controlado, solo entraba la PRIMERA letra de lo que se tecleaba
   * (2026-08-29). Volver a meter dependencias acá reintroduce ese bug.
   */
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

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
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-semibold text-lg">
            {title}
          </h2>
          {/* La X existe por el celular (Carlos, 2026-09-01): el panel llena
              la pantalla —no queda backdrop que tocar— y Escape no existe en
              un teléfono. Sin un botón visible, el diálogo es una trampa. */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.dialog.close")}
            className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground leading-none transition-colors hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
