import { ScrollHint } from "@/components/ui/scroll-hint";
import { useOverflowHint } from "@/lib/ui/use-overflow-hint";

/**
 * Una lista de filas que no cabe a lo ancho —los tops del panel, la atención
 * de inventario, las caducidades— dentro de una caja que hace scroll y que
 * avisa cuando hay más contenido del que se ve.
 *
 * Es el hermano de `ScrollableTable` para contenido que vive DENTRO de una
 * tarjeta: no trae la piel `SURFACE` (la pone la card que lo envuelve) y su
 * leyenda no habla de columnas. El motor es el mismo (`useOverflowHint`):
 * se MIDE si sobra contenido, no se adivina por el ancho de pantalla.
 *
 * El hijo debe declarar su propio `min-w-*`: sin un ancho mínimo, flexbox
 * encoge las filas hasta que "caben" trituradas y nunca hay nada que
 * deslizar.
 */
export function ScrollableList({ children }: { children: React.ReactNode }) {
  const { ref, sobra, medir } = useOverflowHint<HTMLDivElement>();

  return (
    <div className="relative">
      <div ref={ref} data-testid="scrollable-list" onScroll={medir} className="overflow-x-auto">
        {children}
      </div>
      <ScrollHint visible={sobra} messageKey="common.list.scrollHint" />
    </div>
  );
}
