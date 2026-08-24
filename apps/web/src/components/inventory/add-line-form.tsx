import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { addDocumentLine } from "@/lib/inventory/api";
import { DOCUMENTS_QUERY_KEY } from "@/lib/inventory/hooks";
import { useProducts } from "@/lib/products/hooks";

const DEBOUNCE_MS = 300;
/** Debajo de 2 caracteres la búsqueda devolvería medio catálogo. */
const MIN_QUERY = 2;

interface AddLineFormProps {
  documentId: string;
  /** Avisa la línea recién creada, para que el padre le mande el FOCO. */
  onAdded?: (lineId: string | null) => void;
}

/**
 * F3-ENTRY-02 — agregar líneas buscando el producto.
 *
 * La línea nace SIN cantidad, a propósito: quien carga 80 productos los va
 * agregando y después escribe las cantidades. Exigir la cantidad en el alta
 * obligaría a completar cada fila antes de pasar a la siguiente, que es
 * justamente el flujo que el borrador vino a evitar (y por eso `quantity` es
 * opcional en `upsertDocumentLineSchema`).
 */
export function AddLineForm({ documentId, onAdded }: AddLineFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const buscar = debounced.length >= MIN_QUERY;
  const { data, isFetching } = useProducts({ query: debounced, pageSize: 10 }, { enabled: buscar });

  const agregar = useMutation({
    mutationFn: (productId: string) => addDocumentLine(documentId, { productId }),
    onSuccess: (creada) => {
      setTerm("");
      setDebounced("");
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, documentId] });
      // El id de la línea nueva viaja al padre: quien captura 80 líneas
      // agrega y teclea — el foco tiene que aterrizar en la cantidad solo
      // (Carlos, 2026-08-24), no tras un viaje de ratón por línea.
      onAdded?.((creada as { id?: string } | undefined)?.id ?? null);
    },
  });

  const resultados = buscar ? (data?.items ?? []) : [];

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="add-line-search" className="font-medium text-sm">
        {t("inventory.document.searchProduct")}
      </label>
      <input
        id="add-line-search"
        type="search"
        autoComplete="off"
        value={term}
        placeholder={t("inventory.document.searchProductPlaceholder")}
        onChange={(event) => setTerm(event.target.value)}
        className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
      />

      {term.trim().length > 0 && !buscar && (
        <p className="text-muted-foreground text-xs">{t("inventory.document.searchHint")}</p>
      )}

      {buscar && !isFetching && resultados.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("inventory.document.searchNoResults")}</p>
      )}

      {resultados.length > 0 && (
        <ul className="flex max-w-md flex-col gap-1">
          {resultados.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                disabled={agregar.isPending}
                onClick={() => agregar.mutate(product.id)}
                className="w-full rounded-md border border-input px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="font-mono">{product.sku}</span> — {product.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
