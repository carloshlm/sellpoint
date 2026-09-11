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
                  <span className="font-mono text-muted-foreground text-xs">{producto.sku}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
