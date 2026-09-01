import { useEffect, useRef } from "react";

/**
 * El cuadro verde de «salió bien» — y el FOCO se va ahí solo.
 *
 * ── Por qué existe (Carlos, 2026-09-01) ─────────────────────────────────
 *
 * Al terminar de importar un catálogo, el resultado era un par de líneas
 * grises debajo del formulario: se leía igual que una nota al pie, y nadie
 * sabía si la subida había terminado. Un éxito tiene que VERSE (verde, con
 * borde) y OÍRSE: al mover el foco al cuadro, el lector de pantalla lo
 * anuncia y la pantalla se desplaza hasta él aunque el formulario sea largo.
 *
 * `role="status"` y no `alert`: es una confirmación, no una interrupción.
 * `tabIndex={-1}` lo vuelve enfocable por código sin meterlo en el orden de
 * tabulación — nadie tiene que "pasar" por un cuadro de texto al tabular.
 *
 * Lo usan las tres subidas de archivo de la casa: productos, servicios y el
 * conteo de inventario. Un mismo cuadro para el mismo momento.
 */
export function SuccessNotice({
  children,
  testId = "success-notice",
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
      className="flex flex-col gap-1 rounded-md border border-success/40 bg-success-soft px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-success/50"
    >
      {children}
    </div>
  );
}
