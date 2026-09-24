import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** La variable que lee `TABLE_PIN_FULL_WIDTH_ROW`: el mismo nombre, letra por letra. */
const VISIBLE_WIDTH = "--table-visible-width";

/**
 * Mide si una caja con scroll horizontal tiene MÁS contenido a la derecha del
 * que se ve, para poder avisarlo.
 *
 * Vive aparte porque lo usan las dos formas de tabla de la casa: el
 * contenedor de `ui/table.tsx` (que envuelve a casi todos los listados) y
 * `ScrollableTable` (para las tablas armadas a mano). Duplicar la medición
 * garantizaba que una de las dos se quedara atrás.
 *
 * Se MIDE, no se adivina por el ancho de la pantalla: una tabla de tres
 * columnas cabe en un celular y no debe avisar nada, y una de quince no cabe
 * ni en un monitor.
 *
 * De paso publica el ancho VISIBLE de la caja en `--table-visible-width`
 * (F10-MANFIX-18): el panel de una fila a lo ancho —el aviso de cancelar una
 * venta— no tiene otra forma de saber cuánto se ve, porque su 100 % es la
 * tabla entera. La regla que lo usa es `TABLE_PIN_FULL_WIDTH_ROW`
 * (`components/ui/table.tsx`).
 */
export function useOverflowHint<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  sobra: boolean;
  medir: () => void;
} {
  const ref = useRef<T>(null);
  const [sobra, setSobra] = useState(false);

  const medir = useCallback(() => {
    const nodo = ref.current;
    if (!nodo) {
      return;
    }
    // 1px de tolerancia: los anchos fraccionarios del navegador dan falsos
    // positivos de "sobra" cuando en realidad cabe justo.
    setSobra(nodo.scrollWidth - nodo.clientWidth - nodo.scrollLeft > 1);

    // Solo con una medida real: una caja todavía oculta mide 0, y con 0 el
    // panel se encogería hasta desaparecer. Sin la variable, el panel no
    // tiene tope y se ve como siempre. Va directo al nodo y no al estado: así
    // no se vuelve a pintar la tabla entera cuando cambia, y las dos cajas la
    // reciben sin tocar su JSX. Se compara antes porque esto corre también
    // con cada scroll.
    const visible = `${nodo.clientWidth}px`;
    if (nodo.clientWidth > 0 && nodo.style.getPropertyValue(VISIBLE_WIDTH) !== visible) {
      nodo.style.setProperty(VISIBLE_WIDTH, visible);
    }
  }, []);

  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);

    // El contenido llega DESPUÉS del primer render (los datos son asíncronos)
    // y puede cambiar de ancho sin que la ventana cambie: sin observar el
    // nodo, una tabla que se llena tarde nunca avisaría.
    const nodo = ref.current;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => medir());
    if (nodo && observer) {
      observer.observe(nodo);
      for (const hijo of Array.from(nodo.children)) {
        observer.observe(hijo);
      }
    }

    return () => {
      window.removeEventListener("resize", medir);
      observer?.disconnect();
    };
  }, [medir]);

  return { ref, sobra, medir };
}
