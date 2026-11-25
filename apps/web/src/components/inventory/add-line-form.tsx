import { isScannableBarcode } from "@sellpoint/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { addDocumentLine } from "@/lib/inventory/api";
import { DOCUMENTS_QUERY_KEY } from "@/lib/inventory/hooks";
import { listProducts, type ProductListItem } from "@/lib/products/api";
import { useProducts } from "@/lib/products/hooks";
import { useScannerBurst } from "@/lib/scanner/use-scanner-burst";
import { cn } from "@/lib/utils";

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
 *
 * ── Cada presentación es un botón (F10-BULK-07) ───────────────────────────
 *
 * Buscar otra vez el queso sumaba al renglón del kilo: para tener el de la
 * «Bolsa 10 Kg» había que escanear su código o cambiar la presentación
 * después. Ahora un resultado con más de una presentación ACTIVA las ofrece
 * como botones («Kilogramo · Bolsa 1 Kg · Bolsa 10 Kg») y cada uno agrega su
 * renglón con su `presentationId`. Son `<button>` nativos: se llega con Tab y
 * se eligen con Enter. El Enter del buscador y la pistola siguen agregando el
 * resultado único con su presentación encontrada (F10-PRESCODE) o la base.
 * El inventario físico no usa este buscador: ahí se cuenta en unidad base.
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
    // Sin presentación, el API pone la de factor 1. Con la misma presentación
    // y el mismo lote, `DocumentLinesService.add` suma al renglón que ya está.
    mutationFn: (line: NewLine) =>
      addDocumentLine(documentId, {
        productId: line.productId,
        ...(line.presentationId === undefined ? {} : { presentationId: line.presentationId }),
      }),
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
      agregar.mutate(lineFromResult(unico));
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
          {resultados.map((product) => {
            const activePresentations = (product.presentations ?? []).filter((p) => p.isActive);
            const label = (
              <>
                <span className="font-mono">{product.sku}</span> — {product.name}
                {product.matchedPresentation && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {product.matchedPresentation.name}
                  </span>
                )}
              </>
            );

            // Con una sola presentación no hay nada que elegir: el resultado
            // entero es el botón, como siempre.
            if (activePresentations.length < 2) {
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    disabled={agregar.isPending}
                    onClick={() => agregar.mutate(lineFromResult(product))}
                    className="w-full rounded-md border border-input px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {label}
                  </button>
                </li>
              );
            }

            const labelId = `add-line-result-${product.id}`;
            return (
              <li
                key={product.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-input px-3 py-2 text-sm"
              >
                <span id={labelId} className="min-w-0">
                  {label}
                </span>
                <span className="flex flex-wrap gap-1">
                  {activePresentations.map((presentation) => (
                    <button
                      key={presentation.id}
                      type="button"
                      disabled={agregar.isPending}
                      // El botón se llama como la presentación y DESCRIBE su
                      // producto: con diez resultados, «Bolsa 1 Kg» a secas no
                      // diría de cuál es.
                      aria-describedby={labelId}
                      onClick={() =>
                        agregar.mutate({ productId: product.id, presentationId: presentation.id })
                      }
                      className={cn(
                        "rounded-md border px-2 py-1 font-medium text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                        presentation.id === product.matchedPresentation?.id
                          ? "border-primary"
                          : "border-input",
                      )}
                    >
                      {presentation.name}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** El renglón que se pide al API: el producto y, si se eligió, su presentación. */
interface NewLine {
  productId: string;
  presentationId?: string;
}

/**
 * Lo que agrega un resultado elegido entero (Enter, «Agregar», la pistola o
 * el clic en un resultado con una sola presentación).
 *
 * F10-PRESCODE: si lo que se escaneó o tecleó es el código de UNA
 * presentación (la bolsa de 10 kg), la línea entra con ella.
 */
function lineFromResult(product: ProductListItem): NewLine {
  return product.matchedPresentation
    ? { productId: product.id, presentationId: product.matchedPresentation.id }
    : { productId: product.id };
}
