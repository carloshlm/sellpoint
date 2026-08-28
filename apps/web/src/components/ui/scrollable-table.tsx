import { ScrollHint } from "@/components/ui/scroll-hint";
import { SURFACE } from "@/components/ui/surface";
import { useOverflowHint } from "@/lib/ui/use-overflow-hint";
import { cn } from "@/lib/utils";

/**
 * Una tabla ancha —armada a mano, sin el `<Table>` de la casa— dentro de una
 * caja que hace scroll y que avisa cuando hay más columnas de las que caben.
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
        className={cn("overflow-x-auto", SURFACE)}
      >
        {children}
      </div>
      <ScrollHint visible={sobra} />
    </div>
  );
}
