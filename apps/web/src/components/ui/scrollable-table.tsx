import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SURFACE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

/**
 * Una tabla ancha dentro de una caja que hace scroll, **y que avisa cuando hay
 * más columnas de las que caben**.
 *
 * El `overflow-x-auto` solo no alcanza: en un celular la barra de scroll es
 * invisible, así que la tabla se corta en el borde y parece que ahí termina.
 * El usuario no descubre lo que no sabe que existe — de nada sirve que se
 * pueda deslizar si nadie le dice que se puede.
 *
 * El aviso aparece **solo si sobra contenido** (se mide de verdad, no se
 * adivina por el ancho de la pantalla) y desaparece al llegar al final: una
 * leyenda que está siempre se vuelve parte del decorado y deja de leerse.
 */
export function ScrollableTable({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const caja = useRef<HTMLDivElement>(null);
  const [sobra, setSobra] = useState(false);

  const medir = useCallback(() => {
    const nodo = caja.current;
    if (!nodo) return;
    // 1px de tolerancia: los anchos fraccionarios del navegador dan falsos
    // positivos de "sobra" cuando en realidad cabe justo.
    const restante = nodo.scrollWidth - nodo.clientWidth - nodo.scrollLeft;
    setSobra(restante > 1);
  }, []);

  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir]);

  return (
    <div className="relative">
      {/* La misma `SURFACE` que `ui/table.tsx`: los listados van sobre su
          tarjeta, no sobre el fondo — y el tema del wizard los re-pinta a
          todos cambiando solo los tokens. */}
      <div
        ref={caja}
        data-testid="scrollable-table"
        onScroll={medir}
        className={cn("overflow-x-auto", SURFACE)}
      >
        {children}
      </div>
      {sobra && (
        <>
          {/* Degradado en el borde: la pista visual de que el contenido sigue. */}
          <div
            aria-hidden="true"
            // `from-card` y no `from-background`: el degradado vive DENTRO de
            // la tarjeta, así que tiene que fundirse con ella. Con el fondo de
            // la página se veía una franja gris flotando sobre el blanco.
            className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-card to-transparent"
          />
          <p data-testid="scroll-hint" className="mt-1 text-muted-foreground text-xs">
            {t("common.table.scrollHint")}
          </p>
        </>
      )}
    </div>
  );
}
