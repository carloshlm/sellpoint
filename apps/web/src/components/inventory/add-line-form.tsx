import { isScannableBarcode } from "@sellpoint/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { addDocumentLine } from "@/lib/inventory/api";
import { DOCUMENTS_QUERY_KEY } from "@/lib/inventory/hooks";
import { listProducts } from "@/lib/products/api";
import { useProducts } from "@/lib/products/hooks";
import { useScannerBurst } from "@/lib/scanner/use-scanner-burst";

const DEBOUNCE_MS = 300;
/** Debajo de 2 caracteres la búsqueda devolvería medio catálogo. */
const MIN_QUERY = 2;

interface AddLineFormProps {
  documentId: string;
  /** Avisa la línea recién creada, para que el padre le mande el FOCO. */
  onAdded?: (lineId: string | null) => void;
  /**
   * Los campos de las líneas, con cómo devolverle a cada uno su valor.
   *
   * Cuando la pistola dispara con el cursor parado en una cantidad o en un
   * lote, esos dígitos aterrizan ahí antes de que nadie pueda saber que era un
   * escaneo. Este mapa es lo que permite deshacerlo.
   */
  camposDeLineas?: RefObject<Map<HTMLInputElement, (valor: string) => void>>;
  /** En un documento confirmado no se agregan líneas por la espalda. */
  escaneoActivo?: boolean;
}

/**
 * F3-ENTRY-02 — agregar líneas buscando el producto.
 *
 * La línea nace SIN cantidad, a propósito: quien carga 80 productos los va
 * agregando y después escribe las cantidades. Exigir la cantidad en el alta
 * obligaría a completar cada fila antes de pasar a la siguiente, que es
 * justamente el flujo que el borrador vino a evitar (y por eso `quantity` es
 * opcional en `upsertDocumentLineSchema`).
 *
 * ── El escaneo agrega solo (Carlos, 2026-09-17) ──────────────────────────
 *
 * Antes el único camino era hacer clic en un resultado, así que pasar la
 * pistola dejaba el producto colgado en el buscador esperando un ratón. Ahora
 * hay tres caminos que terminan igual —Enter, el botón «Agregar» y la pistola—
 * y un escaneo que resuelve a UN solo producto se agrega sin preguntar.
 *
 * ── Por qué el buscador de siempre y no `/products/barcode-lookup` ───────
 *
 * Ese endpoint devuelve el producto exacto, pero exige `products:manage`, y un
 * rol de almacén puede tener `inventory:write` sin él: la función se rompería
 * justo para el almacenista. `GET /products` ya compara contra los códigos de
 * barras de todas las presentaciones y solo pide `products:read`, que es lo
 * mismo que este buscador necesita para existir.
 */
export function AddLineForm({
  documentId,
  onAdded,
  camposDeLineas,
  escaneoActivo = true,
}: AddLineFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);

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
      setAviso(null);
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, documentId] });
      // El id de la línea nueva viaja al padre: quien captura 80 líneas
      // agrega y teclea — el foco tiene que aterrizar en la cantidad solo
      // (Carlos, 2026-08-24), no tras un viaje de ratón por línea.
      onAdded?.((creada as { id?: string } | undefined)?.id ?? null);
    },
  });

  /**
   * Resuelve un código a UN producto y lo agrega. Si no hay uno solo, no
   * inventa: deja el término en el buscador para que la persona elija.
   *
   * El código que no está en el catálogo se AVISA y nada más (Carlos,
   * 2026-09-17): una entrada de inventario no debería poder inventar productos
   * a medias, sin precio ni unidad, y quien recibe mercancía no siempre es
   * quien decide esos datos.
   */
  const resolverYAgregar = async (texto: string) => {
    const codigo = texto.trim();
    if (codigo === "") {
      return;
    }
    setAviso(null);
    const pagina = await listProducts({ query: codigo, pageSize: 2 });
    const unico = pagina.items.length === 1 ? pagina.items[0] : undefined;
    if (unico !== undefined) {
      agregar.mutate(unico.id);
      return;
    }
    if (pagina.items.length === 0 && isScannableBarcode(codigo)) {
      setAviso(t("inventory.document.scanNotFound", { code: codigo }));
      setTerm("");
      setDebounced("");
      return;
    }
    // Varios candidatos: la lista de abajo ya los muestra.
    setTerm(codigo);
    setDebounced(codigo);
  };

  useScannerBurst({
    looksLikeBarcode: isScannableBarcode,
    enabled: escaneoActivo,
    // Este campo ya tiene su propio camino por el `submit` del formulario.
    ignore: (activo) => activo === campoRef.current,
    onScan: (codigo, origen) => {
      // Devolverle al campo lo que tenía ANTES de la ráfaga. El autoguardado
      // de la línea compara contra el valor del servidor y se salta cuando
      // coinciden, así que restaurar el estado cancela el guardado pendiente
      // sin escribir nada.
      if (origen !== null) {
        camposDeLineas?.current.get(origen.campo)?.(origen.valor);
      }
      campoRef.current?.focus();
      void resolverYAgregar(codigo);
    },
  });

  const resultados = buscar ? (data?.items ?? []) : [];

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="add-line-search" className="font-medium text-sm">
        {t("inventory.document.searchProduct")}
      </label>
      <form
        className="flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // Del DOM y NO del estado: un lector escribe el código y el Enter en
          // el mismo suspiro, y para cuando el Enter llega React todavía no
          // aplicó el `onChange` — el estado vendría vacío.
          void resolverYAgregar(campoRef.current?.value ?? "");
        }}
      >
        <input
          id="add-line-search"
          ref={campoRef}
          type="search"
          autoComplete="off"
          enterKeyHint="done"
          value={term}
          placeholder={t("inventory.document.searchProductPlaceholder")}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" variant="secondary" disabled={term.trim() === ""}>
          {t("inventory.document.addLine")}
        </Button>
      </form>

      {aviso !== null && (
        <p role="status" className="max-w-md rounded-md bg-muted px-3 py-2 text-sm">
          {aviso}
        </p>
      )}

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
