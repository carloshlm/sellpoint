import { useEffect, useRef } from "react";

/**
 * El cuadro rojo de «quedó anulada» — y la vista se va ahí sola.
 *
 * Gemelo de `SuccessNotice` (Carlos, 2026-09-12): al anular una orden, una
 * recepción o una compra, el aviso vive arriba del documento y quien anuló
 * desde el botón de la cabecera de una pantalla larga no lo veía. El foco se
 * mueve al cuadro (`tabIndex={-1}`, fuera del orden de tabulación), y con él
 * el desplazamiento y el anuncio del lector de pantalla. `role="status"`: es
 * una confirmación de lo que pasó, no una interrupción.
 */
export function CanceledNotice({
  children,
  testId = "canceled-notice",
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      data-testid={testId}
      className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
    >
      {children}
    </div>
  );
}
