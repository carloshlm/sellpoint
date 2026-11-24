import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProducts } from "@/lib/products/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const MIN_QUERY = 2;

export interface ProductoElegido {
  id: string;
  sku: string;
  name: string;
  /**
   * F10-PRESCODE: la presentación cuyo código de barras o código interno es
   * lo que se tecleó o escaneó (la bolsa de 10 kg).
   */
  matchedPresentation?: { id: string; name: string } | null;
}

/**
 * La presentación con que nace la línea: la que se encontró por su código si
 * se puede comprar (Carlos, 2026-11-23: «dar la entrada a por ejemplo la
 * bolsa de 1 Kilo o la Bolsa de 10 Kilos, ya sea por código de barra o
 * código interno»); si no, la comprable; si no hay ninguna marcada, la
 * primera. Vacío deja que el API caiga a la unidad base.
 */
export function presentacionInicialDe(
  presentaciones: readonly { id: string; isPurchasable: boolean }[],
  elegido: Pick<ProductoElegido, "matchedPresentation">,
): string {
  const encontrada = presentaciones.find(
    (p) => p.id === elegido.matchedPresentation?.id && p.isPurchasable,
  );
  return (encontrada ?? presentaciones.find((p) => p.isPurchasable) ?? presentaciones[0])?.id ?? "";
}

/**
 * El buscador de producto de una captura por líneas (compra, orden de
 * compra): teclea, espera el debounce y elige. Extraído de
 * `purchase-lines-table.tsx` (F9-PO-12): la orden lo necesita igual y una
 * lista de resultados con dos comportamientos distintos sería un bug en
 * espera.
 */
export function ProductSearch({
  id,
  label,
  placeholder,
  onPick,
}: {
  id: string;
  label: string;
  placeholder: string;
  onPick: (producto: ProductoElegido) => void;
}) {
  const [termino, setTermino] = useState("");
  const buscado = useDebouncedValue(termino.trim());
  const buscar = buscado.length >= MIN_QUERY;
  const { data: encontrados } = useProducts({ query: buscado, pageSize: 10 }, { enabled: buscar });

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      <Input
        id={id}
        type="search"
        value={termino}
        placeholder={placeholder}
        onChange={(event) => setTermino(event.target.value)}
        className="max-w-sm"
      />
      {buscar && (encontrados?.items ?? []).length > 0 && (
        <ul className="flex max-h-48 max-w-sm flex-col gap-1 overflow-y-auto">
          {(encontrados?.items ?? []).map((producto) => (
            <li key={producto.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start py-2 text-left"
                data-testid={`add-product-${producto.id}`}
                onClick={() => {
                  setTermino("");
                  onPick(producto);
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{producto.name}</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {producto.sku}
                    {producto.matchedPresentation && ` · ${producto.matchedPresentation.name}`}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
