import { useEffect, useRef } from "react";

/**
 * El cuadro rojo de «no se pudo» — y el FOCO se va ahí solo.
 *
 * Hermano de `SuccessNotice` y por la misma razón (Carlos, 2026-09-10): en
 * «Datos del negocio» el formulario es largo y el aviso vive arriba, así que
 * un guardado rechazado por el servidor parecía no hacer nada — el mensaje
 * estaba fuera de la pantalla. Al mover el foco al cuadro, el lector de
 * pantalla lo anuncia y el navegador desplaza hasta él.
 *
 * `role="alert"` y no `status`: esto SÍ interrumpe, algo no se guardó.
 * `tabIndex={-1}` lo vuelve enfocable por código sin meterlo en el orden de
 * tabulación.
 */
export function ErrorNotice({
  children,
  testId = "error-notice",
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
      role="alert"
      data-testid={testId}
      className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
    >
      {children}
    </div>
  );
}
