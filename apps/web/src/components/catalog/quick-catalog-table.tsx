import { isScannableBarcode, parseMoneyInput } from "@sellpoint/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MoneyInput } from "@/components/form/money-input";
import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { usePlan } from "@/lib/billing/use-plan";
import { quickLineErrorsOf } from "@/lib/field-errors";
import { moneyInputError } from "@/lib/money";
import { lookupBarcode } from "@/lib/products/api";
import { useQuickAddProducts } from "@/lib/products/hooks";
import {
  QUICK_MAX_LINES,
  type QuickLine,
  useQuickCatalogStore,
} from "@/stores/quick-catalog.store";

/**
 * F10-QUICKCAT-08 — la cinta transportadora.
 *
 * ── La regla que ordena todo el diseño ──────────────────────────────────
 *
 * **El escaneo nunca espera a la pantalla, y la pantalla nunca le roba el foco
 * a quien está tecleando.** De ahí salen la fila optimista, la cola serial y
 * la condición del foco; sin esa regla, cada una parecería una complicación.
 *
 * ── La cola serial ──────────────────────────────────────────────────────
 *
 * Misma lección que `pos/cart-search.tsx` ya pagó: dos consultas en vuelo se
 * pisan y una línea se pierde. Con la pistola en la mano, dos escaneos
 * separados por 200 ms son normales. Cada código entra a una cola y se procesa
 * en orden.
 *
 * ── La fila optimista ───────────────────────────────────────────────────
 *
 * La fila se pinta en el mismo tick del Enter, antes de consultar nada. Un
 * escaneo que desaparece es el peor error posible acá, porque no deja rastro:
 * la persona sigue escaneando y se entera al final, contando.
 *
 * ── El Enter del precio ─────────────────────────────────────────────────
 *
 * Devuelve el foco al campo de escaneo, y eso es lo que hace viable escanear
 * 80 productos seguidos: escanear, teclear el precio, Enter, escanear. Sin
 * ese Enter habría que ir al campo con el mouse ochenta veces.
 */
/**
 * ¿El dedo es el puntero principal de este aparato?
 *
 * Decide si se ofrece escanear con la cámara. En una laptop la cámara apunta
 * a la cara, no al anaquel: el botón está de adorno y ocupa el lugar donde se
 * espera algo útil. `(pointer: coarse)` pregunta por la CAPACIDAD —el puntero
 * principal es grueso, o sea un dedo— y no por el ancho de la ventana, que es
 * lo que se suele usar mal: una laptop con la ventana angosta sigue siendo una
 * laptop.
 *
 * `?.` y el respaldo en `false` por jsdom, que no implementa `matchMedia`: sin
 * eso las pruebas revientan antes de llegar a lo que prueban.
 */
function conCamaraDeMano(): boolean {
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/**
 * «fr» → «francés» / «French», en el idioma de quien lee.
 *
 * `Intl.DisplayNames` lo trae el navegador: mantener a mano una lista de
 * idiomas traducida sería copiar algo que la plataforma ya sabe, y el volcado
 * tiene decenas. Si el navegador no lo conoce, se muestra el código tal cual
 * antes que una etiqueta vacía.
 */
function nombreDeIdioma(codigo: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

export function QuickCatalogTable({ owner }: { owner: string }) {
  const { t, i18n } = useTranslation();
  const idiomaDelUsuario = i18n.language.slice(0, 2);
  // Misma regla que el resto de las pantallas de alta: un plan vencido o
  // suspendido no escribe. El botón de esta pantalla ya vive detrás de la
  // misma condición en el listado; esto cubre a quien llega por la URL.
  const { canWrite } = usePlan();
  const lines = useQuickCatalogStore((s) => s.lines);
  const storageFailed = useQuickCatalogStore((s) => s.storageFailed);
  const claim = useQuickCatalogStore((s) => s.claim);
  const add = useQuickCatalogStore((s) => s.add);
  const patch = useQuickCatalogStore((s) => s.patch);
  const remove = useQuickCatalogStore((s) => s.remove);
  const clear = useQuickCatalogStore((s) => s.clear);

  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  // Indexados por código de barras: la fila nueva se pinta arriba, así que
  // el índice visual no coincide con el del envío.
  const [errores, setErrores] = useState<Map<string, string>>(new Map());
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  /**
   * Si ya se intentó dar de alta.
   *
   * Los faltantes NO se marcan antes: una línea recién escaneada todavía no
   * está mal, le falta que la persona llegue a ella. Pintarle «escribe el
   * precio» a cada renglón mientras se escanea llena la pantalla de rojo y
   * entrena a ignorarlo — justo cuando el rojo tiene que significar algo.
   */
  const [intentado, setIntentado] = useState(false);
  const [guardado, setGuardado] = useState<{ created: number; updated: number } | null>(null);
  const [descartado, setDescartado] = useState<number | null>(null);
  /** Qué acción está esperando confirmación. */
  const [confirmando, setConfirmando] = useState<"guardar" | "descartar" | null>(null);
  // Se calcula UNA vez y no en cada render: la capacidad del aparato no cambia
  // mientras la pantalla está abierta.
  const [camaraALaMano] = useState(conCamaraDeMano);
  /**
   * Si la pantalla da para la tabla de cuatro columnas.
   *
   * Es una decisión en JavaScript y no en CSS a propósito: los dos diseños
   * pintan los MISMOS `id` en sus campos, así que esconder uno con `hidden`
   * dejaría ids duplicados en el documento — el defecto que ya arreglamos en
   * el editor de lotes. Solo uno de los dos existe a la vez.
   */
  const [enPantallaAncha, setEnPantallaAncha] = useState(
    () => window.matchMedia?.("(min-width: 768px)")?.matches ?? true,
  );

  useEffect(() => {
    const consulta = window.matchMedia?.("(min-width: 768px)");
    if (consulta === undefined) {
      return;
    }
    const alCambiar = (evento: MediaQueryListEvent) => setEnPantallaAncha(evento.matches);
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);

  const escanerRef = useRef<HTMLInputElement | null>(null);
  const camposRef = useRef(
    new Map<string, { name?: HTMLInputElement; price?: HTMLInputElement }>(),
  );
  const colaRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * Cuántos escaneos esperan su TURNO, sin contar el que se está procesando.
   *
   * Es lo que distingue «escaneó uno y ahora va a teclear el precio» de «está
   * pasando la pistola por el anaquel». En el primero el foco tiene que ir al
   * precio; en el segundo, quedarse donde la pistola escribe.
   *
   * Sin contar el propio a propósito: contándolo, un escaneo suelto también
   * se vería como ráfaga y el foco no se movería nunca.
   */
  const esperandoTurnoRef = useRef(0);

  const guardar = useQuickAddProducts();

  // El sello de dueño: si el borrador guardado es de otra cuenta, se descarta.
  // Un mostrador con dos cuentas no puede dar de alta el catálogo del vecino.
  useEffect(() => {
    claim(owner);
  }, [claim, owner]);

  /**
   * Mueve el foco SOLO si nadie está escribiendo.
   *
   * ── Las dos formas de «estar escribiendo» ───────────────────────────
   *
   * La obvia es tener el cursor en un precio tres filas más abajo: una
   * respuesta que llega tarde no puede arrancárselo.
   *
   * La que no es obvia —y que destapó la prueba de dos escaneos seguidos— es
   * estar tecleando el SIGUIENTE código en el campo de escaneo. Con el lector
   * en la mano eso pasa todo el tiempo: el código anterior sigue en vuelo y
   * el siguiente ya está entrando. Mandar el foco al precio a mitad de esa
   * ráfaga parte el código en dos campos y pierde el escaneo.
   *
   * Por eso no alcanza con mirar QUIÉN tiene el foco: hay que mirar si el
   * campo de escaneo tiene algo escrito. Vacío significa que el lector ya
   * entregó y está esperando; con texto, que está entregando ahora.
   */
  const enfocarSiNadieEscribe = (destino: HTMLInputElement | undefined) => {
    if (destino === undefined) {
      return;
    }
    // ── La ráfaga manda ─────────────────────────────────────────────────
    //
    // Con otro escaneo en la cola, el foco NO se mueve. Lo destapó la prueba
    // de dos escaneos seguidos: la respuesta del primero llegaba en la ventana
    // entre el clic y la primera tecla del segundo —campo enfocado y vacío,
    // que es justo lo que este guardia consideraba «nadie escribe»— y mandaba
    // el cursor al precio. El segundo código entero terminaba dentro del
    // campo de precio de la primera línea.
    //
    // Mirar la cola en vez del reloj: si hay algo esperando, la persona está
    // pasando la pistola y el foco no es suyo para moverlo.
    if (esperandoTurnoRef.current > 0) {
      return;
    }
    const activo = document.activeElement;
    const escaneandoAhora =
      activo === escanerRef.current && (escanerRef.current?.value ?? "") !== "";
    if (escaneandoAhora) {
      return;
    }
    if (activo === escanerRef.current || activo === document.body || activo === null) {
      destino.focus();
      destino.select();
    }
  };

  const procesar = async (code: string) => {
    const nueva = add(code);
    if (!nueva) {
      // Ya estaba: no se duplica. Se lleva el foco a SU precio y se avisa —
      // escanear dos veces el mismo producto es corregir el precio, no
      // agregarlo otra vez.
      const yaEsta = useQuickCatalogStore.getState().lines.some((linea) => linea.code === code);
      setAviso(
        yaEsta
          ? t("products.quick.alreadyInDraft", { code })
          : t("products.quick.tooManyLines", { max: QUICK_MAX_LINES }),
      );
      if (yaEsta) {
        enfocarSiNadieEscribe(camposRef.current.get(code)?.price);
      }
      return;
    }

    setAviso(null);
    try {
      const encontrado = await lookupBarcode(code);
      if (encontrado.status === "tenant" && encontrado.tenant !== null) {
        patch(code, {
          status: "owned",
          name: encontrado.tenant.name,
          price: encontrado.tenant.price ?? "",
          contributable: false,
        });
      } else if (encontrado.status === "global" && encontrado.global !== null) {
        patch(code, {
          status: "known",
          name: encontrado.global.name,
          brand: encontrado.global.brand,
          nameLang: encontrado.global.lang,
          contributable: false,
        });
      } else {
        patch(code, { status: "new", contributable: encontrado.contributable });
      }

      const campos = camposRef.current.get(code);
      // Con nombre puesto, lo único que falta es el precio; sin nombre, el
      // precio no tiene a qué pertenecer todavía.
      enfocarSiNadieEscribe(encontrado.status === "unknown" ? campos?.name : campos?.price);
    } catch {
      patch(code, { status: "failed" });
    }
  };

  const escanear = (code: string) => {
    const limpio = code.trim();
    if (limpio === "") {
      return;
    }
    // Se rechaza ANTES de crear la fila: una línea con un código que ningún
    // lector puede entregar no es una línea a medio llenar, es basura que
    // después hay que quitar a mano. El campo se queda con lo tecleado para
    // que se vea qué entró y se pueda corregir.
    if (!isScannableBarcode(limpio)) {
      setAviso(t("products.quick.invalidBarcode", { code: limpio }));
      return;
    }
    setGuardado(null);
    setDescartado(null);
    // Seguir escaneando es seguir capturando: el rojo de un intento anterior
    // deja de aplicar en cuanto la lista cambia.
    setIntentado(false);
    setErrores(new Map());
    setErrorGeneral(null);
    setTexto("");
    esperandoTurnoRef.current += 1;
    colaRef.current = colaRef.current.then(() => {
      // Se descuenta al empezar, no al terminar: desde acá el que espera es
      // otro, y es la cuenta de los OTROS la que decide si el foco se mueve.
      esperandoTurnoRef.current -= 1;
      return procesar(limpio);
    });
  };

  const problemaDe = (linea: QuickLine): string | null => {
    if (linea.status === "searching") {
      return null;
    }
    // Las líneas que entraron antes de que existiera esta validación: el
    // borrador vive en el navegador y puede traerlas.
    if (!isScannableBarcode(linea.code)) {
      return t("products.quick.invalidBarcode", { code: linea.code });
    }
    if (linea.name.trim() === "") {
      return t("products.quick.nameRequired");
    }
    if (linea.price.trim() === "") {
      return t("products.quick.priceRequired");
    }
    const clave = moneyInputError(linea.price);
    return clave === null ? null : t(clave);
  };

  const errorDelApi = (code: string): string | null => errores.get(code) ?? null;

  const enviar = () => {
    setErrores(new Map());
    setErrorGeneral(null);
    setGuardado(null);
    setIntentado(true);

    const pendientes = lines.filter((linea) => linea.status === "searching");
    if (pendientes.length > 0) {
      setErrorGeneral(t("products.quick.stillSearching"));
      return;
    }
    const conProblema = lines.filter((linea) => problemaDe(linea) !== null);
    if (conProblema.length > 0) {
      setErrorGeneral(t("products.quick.fixLines"));
      // Al primer renglón con problema, que puede estar fuera de la vista.
      const primero = conProblema[conProblema.length - 1];
      if (primero !== undefined) {
        camposRef.current.get(primero.code)?.name?.focus();
      }
      return;
    }

    setConfirmando("guardar");
  };

  /** El alta de verdad, ya confirmada. */
  const darDeAlta = () => {
    setConfirmando(null);
    guardar.mutate(
      {
        // Se manda en el orden en que se escanearon, no como se ven: la fila
        // nueva se pinta arriba y «línea 1» tiene que ser la primera capturada.
        lines: [...lines].reverse().map((linea) => ({
          code: linea.code,
          name: linea.name.trim(),
          price: parseMoneyInput(linea.price) ?? 0,
        })),
      },
      {
        onSuccess: (reporte) => {
          setGuardado(reporte);
          clear();
          escanerRef.current?.focus();
        },
        onError: (error: ApiError) => {
          // El borrador NO se toca: media hora de escaneo no se pierde porque
          // un renglón esté mal.
          setErrores(quickLineErrorsOf(error));
          setErrorGeneral(error.message !== "" ? error.message : t("products.quick.saveFailed"));
        },
      },
    );
  };

  /** Cuántas líneas crean un producto; el resto solo le cambian el precio. */
  const porCrear = lines.filter((linea) => linea.status !== "owned").length;

  // ── Las piezas de una línea, compartidas por los dos diseños ───────────
  //
  // La tabla y la lista apilada pintan lo MISMO con otra caja alrededor.
  // Escribirlo una vez es lo único que impide que un día el campo de precio
  // del celular deje de devolver el foco al escáner y nadie se entere.

  /** Guarda el nodo del campo para poder moverle el foco después. */
  const registrarCampo =
    (code: string, campo: "name" | "price") => (nodo: HTMLInputElement | null) => {
      const actual = camposRef.current.get(code) ?? {};
      if (nodo === null) {
        delete actual[campo];
      } else {
        actual[campo] = nodo;
      }
      camposRef.current.set(code, actual);
    };

  /** Lo que dice el servidor se muestra siempre; lo que falta, tras intentar. */
  const problemaVisible = (linea: QuickLine): string | null =>
    errorDelApi(linea.code) ?? (intentado ? problemaDe(linea) : null);

  const identidad = (linea: QuickLine) => (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-sm tabular-nums">{linea.code}</span>
      {insignia(linea)}
      {linea.brand !== null && <span className="text-muted-foreground text-xs">{linea.brand}</span>}
    </div>
  );

  const campoNombre = (linea: QuickLine) => (
    <Input
      id={`quick-name-${linea.code}`}
      name={`quickName-${linea.code}`}
      ref={registrarCampo(linea.code, "name")}
      value={linea.name}
      // El nombre del negocio NO se pisa desde acá: ya decidió cómo se llama
      // su producto. Solo el precio se edita.
      //
      // Y se NOTA que no se puede: un campo de solo lectura con el mismo
      // aspecto que los demás invita a teclear en él y a no entender por qué
      // no pasa nada. Carlos llegó con uno enfocado y el texto seleccionado,
      // que es la peor señal posible — parece estar esperando que escribas.
      readOnly={linea.status === "owned"}
      className={linea.status === "owned" ? "bg-muted text-muted-foreground" : undefined}
      aria-label={t("products.quick.columns.name")}
      placeholder={t("products.quick.namePlaceholder")}
      onChange={(event) =>
        // Al editar el nombre, la insignia del idioma deja de aplicar: lo que
        // hay ahora lo escribió la persona, en el suyo.
        patch(linea.code, { name: event.target.value, nameLang: null })
      }
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          camposRef.current.get(linea.code)?.price?.focus();
        }
      }}
    />
  );

  const campoPrecio = (linea: QuickLine) => (
    <MoneyInput
      id={`quick-price-${linea.code}`}
      name={`quickPrice-${linea.code}`}
      ref={registrarCampo(linea.code, "price")}
      value={linea.price}
      aria-label={t("products.quick.columns.price")}
      onChange={(valor) => patch(linea.code, { price: valor })}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          // De vuelta a la pistola: esto es lo que hace que escanear ochenta
          // productos seguidos sea posible.
          escanerRef.current?.focus();
        }
      }}
    />
  );

  const botonQuitar = (linea: QuickLine) => (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={t("products.quick.removeLine", { code: linea.code })}
      onClick={() => {
        remove(linea.code);
        camposRef.current.delete(linea.code);
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );

  const insignia = (linea: QuickLine) => {
    if (linea.status === "searching") {
      return <Badge>{t("products.quick.status.searching")}</Badge>;
    }
    if (linea.status === "owned") {
      return <Badge variant="warning">{t("products.quick.status.owned")}</Badge>;
    }
    if (linea.status === "failed") {
      return <Badge variant="destructive">{t("products.quick.status.failed")}</Badge>;
    }
    if (linea.status === "known") {
      // El caso que originó F10-LANG: un aceite vendido en Canadá que Open
      // Food Facts solo tiene en francés. Se sugiere igual —con la marca al
      // lado alcanza para reconocer la botella— pero se dice en qué idioma
      // está, en vez de disfrazarlo de sugerencia como cualquier otra.
      // Truthy y no `!== null`: un borrador guardado por una versión anterior
      // puede traer el campo ausente, y `undefined !== null` es verdadero.
      // La versión del store descarta esos borradores, pero el cinturón vale:
      // una insignia vacía es peor que no tener insignia.
      const otroIdioma =
        linea.nameLang && linea.nameLang !== idiomaDelUsuario ? linea.nameLang : null;
      if (otroIdioma !== null) {
        return (
          <Badge variant="warning">
            {t("products.quick.status.otherLanguage", {
              language: nombreDeIdioma(otroIdioma, idiomaDelUsuario),
            })}
          </Badge>
        );
      }
      return <Badge variant="success">{t("products.quick.status.known")}</Badge>;
    }
    return <Badge>{t("products.quick.status.new")}</Badge>;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Las tres cosas que un cliente nuevo necesita saber ───────────
          Tres líneas y no un manual: quien llega acá quiere escanear, no
          leer. Cada una contesta una pregunta que la pantalla provocaba
          —«¿y mis productos sin código?», «¿puedo volver después?», «¿qué
          nombre pongo?»— y ninguna explica lo que ya se entiende solo. */}
      <ul className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
        {/* Las claves van LITERALES y no armadas con una plantilla: la barrera
            de i18n solo puede verificar las literales, y una clave que se
            renombra sin que nadie avise sale en pantalla como texto crudo. */}
        <li>
          <strong className="font-medium text-foreground">
            {t("products.quick.help.barcodeOnlyTitle")}
          </strong>{" "}
          {t("products.quick.help.barcodeOnly")}
        </li>
        <li>
          <strong className="font-medium text-foreground">
            {t("products.quick.help.comeBackTitle")}
          </strong>{" "}
          {t("products.quick.help.comeBack")}
        </li>
        <li>
          <strong className="font-medium text-foreground">
            {t("products.quick.help.namingTitle")}
          </strong>{" "}
          {t("products.quick.help.naming")}
        </li>
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
        {/* `gap-2` es el mismo espacio que `TextField` le da a toda etiqueta de
            la casa. Sin él, la etiqueta queda pegada al campo y se lee como
            parte del texto de adentro. */}
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="quick-scan">{t("products.quick.scanLabel")}</Label>
          <Input
            id="quick-scan"
            name="quickScan"
            ref={escanerRef}
            value={texto}
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: el cursor tiene que estar donde apunta la pistola
            autoFocus
            placeholder={t("products.quick.scanPlaceholder")}
            onChange={(event) => setTexto(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                // ── El valor sale del DOM, NO del estado de React ──────────
                //
                // Carlos (2026-09-17), con un lector Bluetooth: escaneaba el
                // segundo producto y no se agregaba la línea; el código se
                // quedaba escrito en el campo y el foco aparecía en el nombre
                // de la línea anterior.
                //
                // Un lector es un teclado que escribe doce caracteres y el
                // Enter en el mismo suspiro. React agrupa los `onChange` y los
                // aplica después, así que cuando llegaba el Enter la variable
                // `texto` todavía traía lo de ANTES —vacío, casi siempre— y la
                // función se salía por la puerta del «no hay nada que
                // escanear». El campo conservaba el código porque nunca se
                // llegó a limpiar, y el foco que se veía en el nombre era la
                // respuesta del escaneo ANTERIOR llegando tarde.
                //
                // `currentTarget.value` es lo que el campo tiene AHORA, sin
                // esperar a ningún render. Con un teclado humano las dos
                // lecturas coinciden siempre; con un lector, solo esta sirve.
                escanear(event.currentTarget.value);
              }
            }}
          />
          <p className="text-muted-foreground text-xs">{t("products.quick.scanHint")}</p>
        </div>
        {camaraALaMano && <BarcodeScanner onScan={escanear} />}
      </div>

      {aviso !== null && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          {aviso}
        </p>
      )}
      {storageFailed && (
        <p role="status" className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          {t("products.quick.storageFailed")}
        </p>
      )}
      {errorGeneral !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {errorGeneral}
        </p>
      )}
      {/* `SuccessNotice` se enfoca solo al montarse, y eso es lo que trae la
          pantalla hasta el aviso: el autoscroll que pidió Carlos no es código
          nuevo, es el cuadro que ya usan las tres importaciones de la casa. */}
      {guardado !== null && (
        <SuccessNotice testId="quick-saved">
          {t("products.quick.saved", { count: guardado.created, updated: guardado.updated })}
        </SuccessNotice>
      )}
      {descartado !== null && (
        <SuccessNotice testId="quick-discarded">
          {t("products.quick.discarded", { count: descartado })}
        </SuccessNotice>
      )}

      {lines.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("products.quick.empty")}</p>
      )}

      {lines.length > 0 && enPantallaAncha && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">{t("products.quick.columns.code")}</TableHead>
              <TableHead className="min-w-56">{t("products.quick.columns.name")}</TableHead>
              <TableHead className="w-32">{t("products.quick.columns.price")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((linea) => (
              <TableRow key={linea.code} data-testid={`quick-line-${linea.code}`}>
                <TableCell className="align-top">{identidad(linea)}</TableCell>
                <TableCell className="align-top">
                  {campoNombre(linea)}
                  {problemaVisible(linea) !== null && (
                    <p className="mt-1 text-destructive text-xs">{problemaVisible(linea)}</p>
                  )}
                </TableCell>
                <TableCell className="align-top">{campoPrecio(linea)}</TableCell>
                <TableCell className="align-top">{botonQuitar(linea)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ── En un celular la línea se APILA, no se desplaza de lado ────────
          Carlos pidió agrandar la columna del nombre, y agrandarla sola no
          alcanzaba: con cuatro columnas en 390 px la tabla se desplaza, y como
          el foco salta al precio después de cada escaneo, el navegador arrastra
          la vista hasta el precio y el nombre desaparece. Se veía UNA columna a
          la vez, nunca las dos que hacen falta.
          
          Apilada, la línea entera cabe sin desplazar nada. Es un render
          DISTINTO y no la misma tabla escondida con CSS: los dos a la vez
          duplicarían los `id` de cada campo, que es justo el defecto que
          arreglamos en el editor de lotes. */}
      {lines.length > 0 && !enPantallaAncha && (
        <ul className="flex flex-col gap-3">
          {lines.map((linea) => (
            <li
              key={linea.code}
              data-testid={`quick-line-${linea.code}`}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                {identidad(linea)}
                {botonQuitar(linea)}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`quick-name-${linea.code}`}>
                  {t("products.quick.columns.name")}
                </Label>
                {campoNombre(linea)}
                {problemaVisible(linea) !== null && (
                  <p className="text-destructive text-xs">{problemaVisible(linea)}</p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`quick-price-${linea.code}`}>
                  {t("products.quick.columns.price")}
                </Label>
                {campoPrecio(linea)}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={enviar}
          disabled={lines.length === 0 || guardar.isPending || !canWrite}
        >
          {guardar.isPending
            ? t("common.form.submitting")
            : // Plural real: «Dar de alta 1 productos» es de los detalles que
              // hacen que una pantalla se sienta a medio hacer.
              t("products.quick.submit", { count: lines.length })}
        </Button>
        {lines.length > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmando("descartar")}
            disabled={guardar.isPending}
          >
            {t("products.quick.discard")}
          </Button>
        )}
        <span className="text-muted-foreground text-sm">
          {t("products.quick.counter", { count: lines.length, max: QUICK_MAX_LINES })}
        </span>
      </div>

      {/* ── Por qué el alta TAMBIÉN pregunta ────────────────────────────
          La regla de `ConfirmDialog` dice que solo se pregunta donde no hay
          vuelta atrás, y crear no borra nada. Pero deshacer un alta de 60
          productos es borrarlos de a uno, con su propia confirmación cada uno:
          en la práctica no hay vuelta atrás. Y el diálogo se gana el lugar
          diciendo qué va a pasar —cuántos nuevos y a cuántos les cambia el
          precio— que es justo lo que no se ve mirando la tabla. */}
      {confirmando === "guardar" && (
        <ConfirmDialog
          data-testid="quick-confirm-add"
          title={t("products.quick.confirmAdd.title")}
          body={t("products.quick.confirmAdd.body", {
            count: lines.length,
            created: porCrear,
            updated: lines.length - porCrear,
          })}
          confirmLabel={t("products.quick.confirmAdd.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={guardar.isPending}
          onConfirm={darDeAlta}
          onCancel={() => setConfirmando(null)}
        />
      )}

      {confirmando === "descartar" && (
        <ConfirmDialog
          data-testid="quick-confirm-discard"
          title={t("products.quick.confirmDiscard.title")}
          body={t("products.quick.confirmDiscard.body", { count: lines.length })}
          confirmLabel={t("products.quick.confirmDiscard.confirm")}
          cancelLabel={t("common.form.cancel")}
          onConfirm={() => {
            const cuantas = lines.length;
            clear();
            setConfirmando(null);
            setErrores(new Map());
            setErrorGeneral(null);
            setIntentado(false);
            // Cuántas se perdieron, no un «listo» a secas: media hora de
            // escaneo merece que se diga qué se fue.
            setDescartado(cuantas);
            escanerRef.current?.focus();
          }}
          onCancel={() => setConfirmando(null)}
        />
      )}

      {/*
        Atribución ODbL. Los nombres que sugiere el catálogo compartido vienen
        de Open Food Facts, cuya licencia EXIGE nombrar la fuente donde se usan
        los datos. No es un pie de página decorativo: es la condición bajo la
        que tenemos permiso de mostrarlos.
      */}
      <p className="text-muted-foreground text-xs">{t("products.quick.attribution")}</p>
    </div>
  );
}
