import { ScrollHint } from "@/components/ui/scroll-hint";
import { SURFACE } from "@/components/ui/surface";
import { TABLE_PIN_FULL_WIDTH_ROW } from "@/components/ui/table";
import { useOverflowHint } from "@/lib/ui/use-overflow-hint";
import { cn } from "@/lib/utils";

/**
 * Una tabla ancha —armada a mano, sin el `<Table>` de la casa— dentro de una
 * caja que hace scroll y que avisa cuando hay más columnas de las que caben.
 * Y el aviso de una fila a lo ancho se queda en lo que se ve
 * (`TABLE_PIN_FULL_WIDTH_ROW`, F10-MANFIX-18).
 *
 * Las tablas que SÍ usan `<Table>` ya traen este comportamiento en su propio
 * contenedor: este componente es para las que no.
 */
export function ScrollableTable({ children }: { children: React.ReactNode }) {
  const { ref, sobra, medir } = useOverflowHint<HTMLDivElement>();

  return (
    <div className="relative">
      <div
        ref={ref}
        data-testid="scrollable-table"
        onScroll={medir}
        className={cn("overflow-x-auto", SURFACE, TABLE_PIN_FULL_WIDTH_ROW)}
      >
        {children}
      </div>
      <ScrollHint visible={sobra} />
    </div>
  );
}
