import { useLayoutEffect, useState } from "react";

/** Un solo lienzo para medir texto: crearlo en cada medición sería basura. */
let lienzo: HTMLCanvasElement | null = null;

/**
 * ¿Cabe `texto` en una sola línea dentro de `campo`? `null` cuando no hay con
 * qué medir: sin layout (jsdom, un campo oculto) el ancho es 0.
 *
 * Se mide con la tipografía que el campo tiene CALCULADA, armada con sus
 * propiedades sueltas y no con `font`: la abreviada calculada trae el
 * interlineado y Firefox la devuelve vacía, y un `font` inválido el lienzo lo
 * ignora sin avisar.
 */
function cabe(campo: HTMLElement, texto: string): boolean | null {
  const estilo = getComputedStyle(campo);
  const disponible =
    campo.clientWidth -
    (Number.parseFloat(estilo.paddingLeft) || 0) -
    (Number.parseFloat(estilo.paddingRight) || 0);
  if (disponible <= 0) {
    return null;
  }
  lienzo ??= document.createElement("canvas");
  const contexto = lienzo.getContext("2d");
  if (!contexto) {
    return null;
  }
  contexto.font = `${estilo.fontStyle} ${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`;
  return contexto.measureText(texto).width <= disponible;
}

/**
 * De dos versiones de un texto de una sola línea —la completa y la corta—,
 * la que CABE en el campo. Nació para la ayuda del buscador del punto de
 * venta (F10-MANFIX-16): un `placeholder` no se parte en renglones, y la
 * completa se cortaba en el celular («…el nombre o un») y en una tableta con
 * el menú abierto, donde el buscador ocupa media pantalla.
 *
 * Se MIDE, como `useOverflowHint`, y no se adivina por el ancho de la
 * pantalla: lo que decide es el ancho del CAMPO, que cambia con el menú, con
 * las columnas y con el idioma. Se vuelve a medir cuando el campo cambia de
 * tamaño y cuando termina de cargar la tipografía (con la de respaldo el
 * texto mide otra cosa). Sin forma de medir se queda la completa, que es la
 * que se ve en una pantalla ancha.
 *
 * El `ref` es de callback a propósito: el buscador se desmonta mientras se
 * revisa una cotización y vuelve con OTRO elemento, que también hay que medir.
 */
export function useFittingText<T extends HTMLElement>(
  completa: string,
  corta: string,
): { ref: (campo: T | null) => void; text: string } {
  const [campo, setCampo] = useState<T | null>(null);
  const [usaCorta, setUsaCorta] = useState(false);

  // Antes de pintar: en un celular no debe asomarse, ni un instante, la
  // completa cortada.
  useLayoutEffect(() => {
    if (!campo) {
      return;
    }
    let vivo = true;
    const medir = () => {
      const resultado = cabe(campo, completa);
      if (vivo && resultado !== null) {
        setUsaCorta(!resultado);
      }
    };

    medir();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observer?.observe(campo);
    void document.fonts?.ready.then(medir);

    return () => {
      vivo = false;
      observer?.disconnect();
    };
  }, [campo, completa]);

  return { ref: setCampo, text: usaCorta ? corta : completa };
}
