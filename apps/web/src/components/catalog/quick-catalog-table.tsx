import { parseMoneyInput } from "@sellpoint/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "@/components/form/money-input";
import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
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
export function QuickCatalogTable({ owner }: { owner: string }) {
  const { t } = useTranslation();
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

  const escanerRef = useRef<HTMLInputElement | null>(null);
  const camposRef = useRef(
    new Map<string, { name?: HTMLInputElement; price?: HTMLInputElement }>(),
  );
  const colaRef = useRef<Promise<void>>(Promise.resolve());

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
    setTexto("");
    setGuardado(null);
    // Seguir escaneando es seguir capturando: el rojo de un intento anterior
    // deja de aplicar en cuanto la lista cambia.
    setIntentado(false);
    setErrores(new Map());
    setErrorGeneral(null);
    colaRef.current = colaRef.current.then(() => procesar(limpio));
  };

  const problemaDe = (linea: QuickLine): string | null => {
    if (linea.status === "searching") {
      return null;
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
      return <Badge variant="success">{t("products.quick.status.known")}</Badge>;
    }
    return <Badge>{t("products.quick.status.new")}</Badge>;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
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
                escanear(texto);
              }
            }}
          />
          <p className="mt-1 text-muted-foreground text-xs">{t("products.quick.scanHint")}</p>
        </div>
        <BarcodeScanner onScan={escanear} />
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
      {guardado !== null && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm">
          {t("products.quick.saved", { created: guardado.created, updated: guardado.updated })}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("products.quick.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("products.quick.columns.code")}</TableHead>
              <TableHead>{t("products.quick.columns.name")}</TableHead>
              <TableHead className="w-44">{t("products.quick.columns.price")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((linea) => {
              // Lo que dice el servidor se muestra siempre; lo que falta, recién
              // cuando se intentó guardar.
              const problema = errorDelApi(linea.code) ?? (intentado ? problemaDe(linea) : null);
              const registrar = (campo: "name" | "price") => (nodo: HTMLInputElement | null) => {
                const actual = camposRef.current.get(linea.code) ?? {};
                if (nodo === null) {
                  delete actual[campo];
                } else {
                  actual[campo] = nodo;
                }
                camposRef.current.set(linea.code, actual);
              };

              return (
                <TableRow key={linea.code} data-testid={`quick-line-${linea.code}`}>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-sm tabular-nums">{linea.code}</span>
                      {insignia(linea)}
                      {linea.brand !== null && (
                        <span className="text-muted-foreground text-xs">{linea.brand}</span>
                      )}
                      {/* Lo que este código le va a dejar al catálogo de
                          todos. Se dice acá y no en un aviso aparte: es una
                          consecuencia de ESTA línea. */}
                      {linea.contributable && (
                        <span className="text-muted-foreground text-xs">
                          {t("products.quick.willContribute")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Input
                      id={`quick-name-${linea.code}`}
                      name={`quickName-${linea.code}`}
                      ref={registrar("name")}
                      value={linea.name}
                      // El nombre del negocio NO se pisa desde acá: ya decidió
                      // cómo se llama su producto. Solo el precio se edita.
                      readOnly={linea.status === "owned"}
                      aria-label={t("products.quick.columns.name")}
                      placeholder={t("products.quick.namePlaceholder")}
                      onChange={(event) => patch(linea.code, { name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          camposRef.current.get(linea.code)?.price?.focus();
                        }
                      }}
                    />
                    {problema !== null && (
                      <p className="mt-1 text-destructive text-xs">{problema}</p>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <MoneyInput
                      id={`quick-price-${linea.code}`}
                      name={`quickPrice-${linea.code}`}
                      ref={registrar("price")}
                      value={linea.price}
                      aria-label={t("products.quick.columns.price")}
                      onChange={(valor) => patch(linea.code, { price: valor })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          // De vuelta a la pistola: esto es lo que hace que
                          // escanear ochenta productos seguidos sea posible.
                          escanerRef.current?.focus();
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="align-top">
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={enviar} disabled={lines.length === 0 || guardar.isPending}>
          {guardar.isPending
            ? t("common.form.submitting")
            : t("products.quick.submit", { count: lines.length })}
        </Button>
        {lines.length > 0 && (
          <Button type="button" variant="outline" onClick={clear} disabled={guardar.isPending}>
            {t("products.quick.discard")}
          </Button>
        )}
        <span className="text-muted-foreground text-sm">
          {t("products.quick.counter", { count: lines.length, max: QUICK_MAX_LINES })}
        </span>
      </div>

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
