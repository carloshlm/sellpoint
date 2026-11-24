import { type Currency, formatMoney, formatQuantity, unitLabelFor } from "@sellpoint/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import { QuoteLoadPanel } from "@/components/pos/quote-load-panel";
import { Button } from "@/components/ui/button";
import { type LookupItem, type LookupProductItem, lookup } from "@/lib/pos/api";
import { useLookup } from "@/lib/pos/hooks";
import { useFolioPrefix } from "@/lib/tenant/folio-prefix";
import { useFittingText } from "@/lib/ui/use-fitting-text";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";
import { useCartStore } from "@/stores/cart.store";

/**
 * F4-CART-01/04 — el input principal del carrito.
 *
 * **Uno solo para todo**: código de barras, SKU, media palabra, servicio o
 * folio `COT-`. Quién reconoce cada cosa lo decide el server
 * (`lookup.strategies`), no esta pantalla — así que agregar una forma de buscar
 * no toca este archivo.
 *
 * Un acierto EXACTO va derecho al carrito sin abrir una lista de un solo
 * renglón: es lo que hace que escanear se sienta instantáneo. Lo difuso se
 * muestra para que una persona elija.
 */
interface CartSearchProps {
  /**
   * Contra qué almacén buscar cuando NO hay turno (F4-QUOTE-03). La venta no
   * lo manda nunca: hereda el del turno. Si viene y hay turno, gana el turno —
   * dejar que una prop mueva el almacén de una venta en curso sería cobrar de
   * una bodega y descontar de otra. Esa precedencia la decide el SERVIDOR.
   */
  warehouseId?: string | null;
}

/**
 * De dónde llegó un código a la fila: la cámara del celular, o el lector de
 * mano que lo escribió en el campo y remató con un Enter.
 */
type Origen = "camara" | "lector";

/**
 * Cuánto espera la búsqueda a que se deje de teclear (2026-11-16). Un lector
 * escribe un dígito cada 60 ms y remata con Enter antes de cumplirse; una
 * persona hace una pausa más larga entre palabras. Así el lector ya no dispara
 * una consulta por dígito: eran 12 por código, y la buena esperaba en la fila
 * del servidor detrás de las once a medias.
 */
const ESPERA_BUSQUEDA_MS = 300;

export function CartSearch({ warehouseId }: CartSearchProps = {}) {
  const { t } = useTranslation();
  const [texto, setTexto] = useState("");
  /**
   * Los códigos del lector que no entraron mientras el campo ya tenía otra
   * cosa escrita (el siguiente código, casi siempre). No se devuelven al campo
   * para no pisar lo que se está escribiendo; se avisan aquí.
   */
  const [sinAgregar, setSinAgregar] = useState<string[]>([]);
  const campoRef = useRef<HTMLInputElement | null>(null);
  /**
   * El folio que se está cargando (F4-QUOTE-04). Mientras hay uno, la búsqueda
   * cede su lugar al panel de confirmación: son dos cosas que compiten por la
   * misma decisión del cajero, y mostrarlas juntas invitaría a seguir agregando
   * artículos sobre una cotización a medio revisar.
   */
  const [folioCargando, setFolioCargando] = useState<string | null>(null);
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const agregar = useCartStore((s) => s.add);
  const escaneosPendientes = useCartStore((s) => s.pendingScans);
  const escaneoEmpezado = useCartStore((s) => s.scanStarted);
  const escaneoTerminado = useCartStore((s) => s.scanFinished);

  // Con el campo vacío no se espera: la lista anterior desaparece al instante.
  const busqueda = useDebouncedValue(texto, ESPERA_BUSQUEDA_MS);
  const termino = texto.trim() === "" ? "" : busqueda;
  // La respuesta corresponde a lo que hay en el campo. Mientras no, la lista
  // anterior sigue a la vista, pero nada entra solo al carrito.
  const alDia = busqueda === texto;
  const { data, isFetching } = useLookup(termino, true, warehouseId ?? undefined);

  // F10-MANFIX-16: la ayuda completa no cabe en un celular ni en una tableta
  // con el menú abierto, y un `placeholder` se corta en vez de partirse
  // («…el nombre o un»). Ahí va la corta, que se lee entera; en el celular,
  // «Escanear con la cámara» queda justo debajo y dice lo que la corta calla.
  // El prefijo de la cotización es el del NEGOCIO (`COT` o `QTE`), no el del
  // idioma de quien vende.
  const prefijoCotizacion = useFolioPrefix("quote");
  const ayuda = useFittingText<HTMLInputElement>(
    t("pos.cart.searchPlaceholder", { prefix: prefijoCotizacion }),
    t("pos.cart.searchPlaceholderShort", { prefix: prefijoCotizacion }),
  );
  // Estable a propósito: `ayuda.ref` guarda el campo en un estado, y un ref
  // nuevo en cada render lo soltaría y lo volvería a tomar en cada pintada.
  const ayudaRef = ayuda.ref;
  const unirCampo = useCallback(
    (campo: HTMLInputElement | null) => {
      campoRef.current = campo;
      ayudaRef(campo);
    },
    [ayudaRef],
  );

  /**
   * ── Escanear es una ACCIÓN, no una búsqueda (2026-08-23) ───────────────
   *
   * El escáner metía el código por `setTexto`, el mismo estado del teclado, y
   * el agregado dependía de la consulta reactiva. Si un segundo escaneo
   * llegaba con la consulta del primero EN VUELO, la clave cambiaba y el
   * primero se perdía sin ruido — el «a veces no agrega» que Carlos reportó,
   * agravado por el modo continuo de la cámara.
   *
   * Ahora cada código entra a una COLA SECUENCIAL: consulta y agrega uno por
   * uno, en orden, sin pasar por el input. Lo ambiguo y los errores SÍ caen
   * al input — que una persona decida; nada se pierde en silencio. El input
   * queda como canal del teclado.
   *
   * ── El lector de mano usa la MISMA fila (2026-11-16) ─────────────────
   *
   * Un lector USB o Bluetooth es un teclado: escribe en el campo y remata con
   * Enter. Antes el campo se limpiaba hasta que llegaba la respuesta, y si el
   * segundo código llegaba antes, sus dígitos se pegaban al primero y los dos
   * se perdían («el segundo producto pisa al anterior», un cliente). Ahora el
   * Enter vacía el campo al instante y manda el código a la fila: se puede
   * escanear sin esperar, y cada uno entra en orden.
   */
  const colaRef = useRef<Promise<void>>(Promise.resolve());
  const seleccionarAlPintarRef = useRef(false);

  // Seleccionar hasta que el código ya está pintado en el campo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: corre cuando el texto cambia
  useEffect(() => {
    if (!seleccionarAlPintarRef.current) {
      return;
    }
    seleccionarAlPintarRef.current = false;
    campoRef.current?.select();
  }, [texto]);

  /**
   * Lo que no entró solo vuelve al campo para que una persona elija. Con el
   * lector, si el campo ya tiene escrito el siguiente código, devolverlo lo
   * pisaría: se avisa aparte. La cámara no escribe en el campo; lo que haya
   * ahí lo tecleó una persona, y se reemplaza como siempre.
   */
  const devolverAlCampo = (codigo: string, origen: Origen) => {
    if (origen === "camara" || (campoRef.current?.value ?? "") === "") {
      setTexto(codigo);
      // El del lector queda SELECCIONADO: el siguiente escaneo lo reemplaza
      // en vez de pegarle sus dígitos, que perdería los dos.
      seleccionarAlPintarRef.current = origen === "lector";
      return;
    }
    setSinAgregar((previos) => (previos.includes(codigo) ? previos : [...previos, codigo]));
  };

  const procesarEscaneo = async (codigo: string, origen: Origen) => {
    try {
      const resultado = await lookup(codigo, warehouseId ?? undefined);
      const unico =
        resultado.exact && resultado.items.length === 1 ? (resultado.items[0] ?? null) : null;
      if (unico === null) {
        devolverAlCampo(codigo, origen);
        return;
      }
      if (unico.type === "quote") {
        setFolioCargando(unico.folio);
        return;
      }
      agregar(unico);
      // Con la cámara el campo se limpia al acertar: si el cajero venía
      // tecleando media palabra y decidió escanear, dejar ese resto colgando
      // con su lista de resultados invita a agregar el artículo equivocado.
      // Con el lector, el Enter ya lo limpió, y lo que haya ahora es el
      // siguiente código a medio escribir.
      if (origen === "camara") {
        setTexto("");
      }
    } catch {
      devolverAlCampo(codigo, origen);
    }
  };

  const escanear = (codigo: string, origen: Origen) => {
    escaneoEmpezado();
    colaRef.current = colaRef.current.then(async () => {
      try {
        await procesarEscaneo(codigo, origen);
      } finally {
        escaneoTerminado();
      }
    });
  };

  const escanearConCamara = (codigo: string) => escanear(codigo, "camara");

  const agregarYLimpiar = (item: LookupItem) => {
    agregar(item);
    // El input se vacía para el siguiente artículo: en un mostrador nadie
    // borra a mano entre uno y otro.
    setTexto("");
  };

  // Un acierto EXACTO no necesita que nadie elija: entra solo. Va en un
  // efecto y no en el cuerpo del render porque agrega al store — mutar
  // durante el render es lo que hace que React repinte en bucle.
  //
  // La cotización queda AFUERA: no es una línea, es un carrito entero que se
  // vuelca con confirmación (F4-QUOTE-04). Meterla sola sería volcar precios
  // viejos sin que nadie los vea.
  //
  // Solo si la respuesta es de lo que hay en el campo (`alDia`): si la
  // persona siguió escribiendo, el acierto viejo no entra ni le borra lo que
  // escribe.
  const aciertoExacto =
    alDia && data?.exact === true && data.items.length === 1 && data.items[0]?.type !== "quote"
      ? (data.items[0] ?? null)
      : null;

  // Un folio COT tecleado o escaneado abre la confirmación sin que nadie tenga
  // que hacer clic en un renglón de uno solo (F4-QUOTE-04).
  // También solo si está al día: si no, cerrar el panel y teclear antes de la
  // espera lo volvía a abrir con la respuesta vieja.
  const folioExacto =
    alDia && data?.exact === true && data.items.length === 1 && data.items[0]?.type === "quote"
      ? data.items[0].folio
      : null;

  useEffect(() => {
    if (folioExacto !== null) {
      setFolioCargando(folioExacto);
    }
  }, [folioExacto]);

  useEffect(() => {
    if (aciertoExacto === null) {
      return;
    }
    agregar(aciertoExacto);
    // El input se vacía para el siguiente artículo: en un mostrador nadie borra
    // a mano entre uno y otro.
    setTexto("");
  }, [aciertoExacto, agregar]);

  if (folioCargando !== null) {
    return (
      <QuoteLoadPanel
        folio={folioCargando}
        onClose={() => {
          setFolioCargando(null);
          setTexto("");
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="cart-search">
      <input
        ref={unirCampo}
        id="pos-cart-search"
        name="q"
        className="h-12 w-full rounded-md border bg-background px-3 text-lg"
        value={texto}
        placeholder={ayuda.text}
        aria-label={t("pos.cart.search")}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) {
            return;
          }
          // El valor sale del DOM y no del estado: el lector escribe el código
          // y el Enter en el mismo suspiro, y el estado puede venir atrasado.
          const codigo = e.currentTarget.value.trim();
          if (codigo === "") {
            return;
          }
          // Si la lista a la vista ya es la de este texto, el Enter no la
          // tira para volver a buscar lo mismo: la persona está eligiendo.
          if (alDia && data !== undefined && !(data.exact && data.items.length === 1)) {
            return;
          }
          e.preventDefault();
          setTexto("");
          escanear(codigo, "lector");
        }}
      />

      {/* La cámara NO pasa por el input: cada código entra a la cola
          imperativa, que consulta y agrega en orden. Ver `escanear`. */}
      <BarcodeScanner onScan={escanearConCamara} />

      {escaneosPendientes > 0 && <p role="status">{t("pos.cart.adding")}</p>}

      {sinAgregar.length > 0 && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          <span className="min-w-0 break-words">
            {t("pos.cart.notAdded", { codes: sinAgregar.join(", ") })}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("pos.cart.dismissNotAdded")}
            onClick={() => setSinAgregar([])}
          >
            ×
          </Button>
        </div>
      )}

      {isFetching && <p role="status">{t("common.form.loading")}</p>}

      {data !== undefined &&
        data.items.length === 0 &&
        alDia &&
        texto.trim() !== "" &&
        !isFetching && <p className="text-muted-foreground text-sm">{t("pos.cart.noResults")}</p>}

      <ul className="flex flex-col gap-1">
        {(data?.items ?? []).map((item) => (
          <li key={`${item.type}:${item.id}`}>
            <Button
              variant="outline"
              // `whitespace-normal`: el botón no parte el texto por omisión, y un
              // nombre largo («California Pistachios Unsalted Dry-Roasted to
              // Perfection») ensanchaba la columna entera en el celular: el
              // precio y «Cobrar» quedaban fuera de la pantalla (Carlos,
              // 2026-11-01). El nombre se parte; el precio nunca se encoge.
              className="h-auto w-full justify-between gap-3 whitespace-normal py-2 text-left"
              onClick={() => {
                // Una cotización no es una línea: abre su confirmación.
                if (item.type === "quote") {
                  setFolioCargando(item.folio);
                  return;
                }
                agregarYLimpiar(item);
              }}
            >
              <span className="flex min-w-0 flex-col">
                <span className="break-words font-medium">
                  {item.type === "quote"
                    ? item.folio
                    : item.type === "concept"
                      ? item.description
                      : item.name}
                </span>
                <span className="break-words text-muted-foreground text-xs">
                  {item.type === "product" && (
                    <>
                      {item.sku}
                      {/* F4-POSVIS: sin el dato (null) no se dice cuántas hay. */}
                      {item.available !== null && " · "}
                      {item.available !== null &&
                        t("pos.cart.available", {
                          quantity: formatQuantity(item.available, item.baseUnit),
                          // El plural lo decide la CANTIDAD: «1 pieza disponible»,
                          // no «1 piezas». Con `{ plural: true }` fijo decía lo
                          // segundo — lo destapó la prueba de punta a punta.
                          unit: unitLabelFor(item.available, item.baseUnit, locale),
                        })}
                      {item.expired !== null && Number(item.expired) > 0 && (
                        // El dato de vencido evita que "no hay" mienta frente a
                        // un anaquel con mercancía a la vista.
                        <>
                          {" · "}
                          {t("pos.cart.expiredAside", {
                            quantity: formatQuantity(item.expired, item.baseUnit),
                          })}
                        </>
                      )}
                    </>
                  )}
                  {item.type === "service" && item.code}
                  {item.type === "quote" && t(`pos.quote.status.${item.status}`)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {item.type === "product" && precioDeResultado(item, currency, locale, t)}
                {item.type === "service" && formatMoney(Number(item.price ?? 0), currency, locale)}
                {item.type === "quote" && formatMoney(Number(item.total), currency, locale)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * El precio que muestra un resultado: el de su presentación predeterminada.
 * F10-NOPRICE-02: si no tiene precio lo dice, en vez de «$0.00»; la caja no
 * lo cobra.
 */
function precioDeResultado(
  item: LookupProductItem,
  currency: Currency,
  locale: Parameters<typeof formatMoney>[2],
  t: (key: string) => string,
) {
  const predeterminada = item.presentations.find((p) => p.isDefaultSale);
  if (predeterminada !== undefined && predeterminada.price === null) {
    return <span className="text-destructive">{t("pos.cart.noPrice")}</span>;
  }
  return formatMoney(Number(predeterminada?.price ?? 0), currency, locale);
}
