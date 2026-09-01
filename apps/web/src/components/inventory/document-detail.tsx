import {
  formatQuantity,
  normalizeLotCode,
  REASON_RULES,
  unitLabelFor,
  unitName,
} from "@sellpoint/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { resolveUiLocale } from "@/lib/accept-language";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { removeDocumentLine, updateDocumentLine } from "@/lib/inventory/api";
import { headerErrors } from "@/lib/inventory/entry-schema";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import {
  DOCUMENTS_QUERY_KEY,
  useCancelDocument,
  useConfirmDocument,
  useDocument,
} from "@/lib/inventory/hooks";
import { useStock } from "@/lib/inventory/kardex-hooks";
import type { DocumentProduct, DocumentRow } from "@/lib/inventory/types";
import { MONEY_STEP } from "@/lib/products/money";
import { useAuthStore } from "@/stores/auth.store";
import { AddLineForm } from "./add-line-form";
import { CountPanel, CountSummary } from "./count-panel";
import { DocumentHeaderForm } from "./document-header-form";
import { DownloadDocumentButton } from "./download-document-button";

const DEBOUNCE_MS = 400;

interface DocumentDetailProps {
  documentId: string;
}

/**
 * F3-DOC-09 + F3-ENTRY-02 — la pantalla del documento.
 *
 * **Una sola pantalla con dos caras.** En `draft` es captura con autoguardado y
 * previa en vivo; en `confirmed` o `canceled` es solo lectura de lo que
 * realmente pasó. Separarlas obligaría a mantener dos veces la misma tabla y
 * las haría divergir — y para quien la usa es el mismo papel, antes y después
 * de firmarlo.
 *
 * El panel de previa no es un extra: es lo que evita confirmar a ciegas. Cada
 * fila dice qué hay HOY y en qué queda, y las que están mal se marcan antes de
 * que el stock se mueva.
 *
 * Lo que agrega F3-ENTRY-02: el MOTIVO, que decide qué campos pide la cabecera
 * y si las líneas llevan costo. Esa reactividad sale de `REASON_RULES` —la
 * misma tabla que valida el API—, así que el formulario no puede pedir algo
 * distinto de lo que el servidor exige.
 */
export function DocumentDetail({ documentId }: DocumentDetailProps) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  // El interruptor de ubicaciones del NEGOCIO. Hook: va arriba del return
  // temprano de carga, o React ve distinta cantidad entre renders.
  const usaUbicaciones = useAuthStore((state) => state.user?.tenant?.usesLocations === true);
  const { data: document, isPending } = useDocument(documentId);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  // La línea recién agregada desde el buscador: su CANTIDAD recibe el foco.
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  // El aviso de "asentado": se trae a la vista al confirmar.
  const avisoRef = useRef<HTMLDivElement>(null);

  /**
   * Al asentar, el aviso de "movimiento confirmado" se trae a la vista.
   *
   * Vive ARRIBA del documento y un conteo de 300 líneas deja al usuario a
   * media página: sin esto confirma, no ve cambiar nada donde está mirando y
   * no sabe si funcionó (Carlos, 2026-08-31).
   *
   * Va como EFECTO y no dentro del `onSuccess`: así React lo limpia con el
   * desmontaje en vez de dispararse fuera del ciclo de vida. Y
   * `scrollIntoView` se llama con `?.` porque jsdom no lo implementa — en un
   * test no debe reventar por un adorno visual.
   */
  useEffect(() => {
    if (confirmado) {
      avisoRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  }, [confirmado]);
  // El error del confirm/anular. Sin esto el fallo era SILENCIOSO: el diálogo
  // se cerraba y el usuario veía "no pasa nada" — indebuggeable hasta para
  // quien lo reporta. El filtro del API ya manda el mensaje traducido.
  const [actionError, setActionError] = useState<string | null>(null);
  const [drifted, setDrifted] = useState(0);
  const [soloDiscrepancias, setSoloDiscrepancias] = useState(false);

  const confirmDocument = useConfirmDocument(documentId);
  const cancelDocument = useCancelDocument(documentId);

  if (isPending || document === undefined) {
    return <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>;
  }

  const esConteo = document.type === "physical_count";
  const editable = document.status === "draft" && has("inventory:movement");
  // Aprobar un conteo puede reescribir el saldo de todo un almacén: es el
  // único tipo que exige `inventory:manage`. Sin él el borrador se captura
  // igual y queda esperando a quien pueda firmarlo.
  const puedeConfirmar = editable && (!esConteo || has("inventory:manage"));
  const conErrores = document.summary.errors > 0;
  const sinLineas = document.rows.length === 0;

  // La cabecera se valida ANTES de mandar: descubrir que faltaba la nota por
  // un 400 sería enterarse de un requisito que la pantalla nunca mostró.
  // Un CONTEO no tiene motivo que elegir: se lo pone la aprobación
  // (`physical_count` no está en `SELECTABLE_*_REASONS`). Exigírselo dejaría el
  // confirmar trabado para siempre.
  const faltaCabecera =
    !esConteo &&
    (document.reasonCode === null || headerErrors(document.reasonCode, document).size > 0);

  const rules = document.reasonCode === null ? null : REASON_RULES[document.reasonCode];
  const conCosto = rules?.requiresUnitCost ?? false;
  // Columnas de lote solo si el documento es una entrada Y algún producto los
  // controla — en los demás documentos serían ancho muerto.
  /**
   * El CONTEO también captura lote, caducidad y ubicación.
   *
   * Antes solo la entrada mostraba estas columnas, y el resultado era una
   * trampa: al subir la plantilla, una línea sin lote fallaba con
   * `inventory.lot_required` —"falta indicar cuál"— y la pantalla no ofrecía
   * NINGÚN lugar donde indicarlo. El usuario quedaba pidiéndole al Excel algo
   * que ya había fallado (Carlos, 2026-08-30).
   *
   * La salida sigue fuera: ahí el lote lo elige FEFO, no la persona.
   */
  const conLote =
    (document.type === "entry" || document.type === "physical_count") &&
    document.products.some((p) => p.tracksLots === true);

  /**
   * La UBICACIÓN no depende de los lotes: la decide el NEGOCIO.
   *
   * Carlos (2026-08-31): «hay productos sin lote ni caducidad que sí deberían
   * poder tener ubicación». Tiene razón — atarla a `tracksLots` dejaba sin
   * dónde escribirla justo a los productos más comunes.
   *
   * Para los que llevan lote, la ubicación es parte de la identidad del saldo
   * (`stock_lots` es lote+almacén+ubicación). Para los que no, se guarda como
   * la ubicación de REFERENCIA del producto al confirmar: el conteo es el
   * momento en que se descubre dónde está de verdad cada cosa.
   */
  const conUbicacion =
    usaUbicaciones && (document.type === "entry" || document.type === "physical_count");
  const productosPorId = new Map(document.products.map((p) => [p.id, p]));

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-semibold text-2xl">{document.folio}</h1>
          <p className="text-muted-foreground text-sm">
            {t(`inventory.documentType.${document.type}`)} · {document.warehouse.name} ·{" "}
            {t(`inventory.status.${document.status}`)}
          </p>
          {!editable && document.reasonCode !== null && (
            <p className="text-muted-foreground text-sm">
              {t(`inventory.reason.${document.reasonCode}`)}
              {document.reference !== null && ` · ${document.reference}`}
            </p>
          )}
          {!editable && document.reasonNote !== null && (
            <p className="text-muted-foreground text-sm italic">{document.reasonNote}</p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <DownloadDocumentButton documentId={documentId} folio={document.folio} />
          {puedeConfirmar && (
            <>
              <button
                type="button"
                onClick={() => setDialog("cancel")}
                className="rounded-md border border-input px-3 py-2 text-sm"
              >
                {t("inventory.document.cancel")}
              </button>
              <button
                type="button"
                onClick={() => setDialog("confirm")}
                disabled={conErrores || sinLineas || faltaCabecera || confirmDocument.isPending}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {t("inventory.document.confirm")}
              </button>
            </>
          )}
        </div>
      </header>

      {confirmado && (
        <div
          ref={avisoRef}
          role="status"
          // Verde y no el morado de la marca: `bg-primary/10` decía "aquí hay
          // algo" pero no "salió bien", y este aviso aparece justo después de
          // mover stock — el momento donde más importa distinguir el éxito de
          // un simple mensaje (Carlos, 2026-08-30). El token `success` ya
          // existía en el tema, con su par para el modo oscuro; nadie lo
          // estaba usando.
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-success-soft px-4 py-3 text-sm"
        >
          <div className="flex flex-col">
            <span className="font-medium">{t("inventory.document.confirmedTitle")}</span>
            <span className="text-muted-foreground">
              {t("inventory.document.confirmedBody", { folio: document.folio })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {document.reasonCode === "transfer" && (
              <Link
                to="/movements/transfers"
                className="rounded-md border border-input px-3 py-2 text-sm"
              >
                {t("inventory.document.goToTransfers")}
              </Link>
            )}
            <DownloadDocumentButton documentId={documentId} folio={document.folio} />
          </div>
        </div>
      )}

      {actionError !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {actionError}
        </p>
      )}

      {editable && esConteo && <CountPanel document={document} />}
      {esConteo && <CountSummary document={document} />}
      {editable && !esConteo && <DocumentHeaderForm document={document} />}

      {!editable && document.status !== "draft" && (
        <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
          {t("inventory.document.readOnly")}
        </p>
      )}

      {esConteo && editable && !puedeConfirmar && (
        <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
          {t("inventory.count.needsManage")}
        </p>
      )}

      {drifted > 0 && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {t("inventory.count.drifted", { count: drifted })}
        </p>
      )}

      {conErrores && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {t("inventory.document.hasErrors")}
        </p>
      )}

      {editable && !esConteo && <AddLineForm documentId={documentId} onAdded={setFocusLineId} />}

      {esConteo && !sinLineas && (
        <label className="flex w-fit items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={soloDiscrepancias}
            onChange={(event) => setSoloDiscrepancias(event.target.checked)}
          />
          {t("inventory.count.onlyDiscrepancies")}
        </label>
      )}

      {sinLineas ? (
        <p className="text-muted-foreground text-sm">{t("inventory.document.emptyLines")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t("inventory.document.product")}</th>
                {/*
                  En un CONTEO no se elige presentación ni se captura una
                  "cantidad a mover": se cuenta lo que hay, en unidad base
                  (Carlos, 2026-08-31 — el SKU ya trae su presentación del
                  catálogo, y dejarla editable acá invita a cambiar el
                  significado de lo contado). Sus columnas son otras.
                */}
                {esConteo ? (
                  <>
                    <th className="px-2 py-2 font-medium">{t("inventory.count.theoretical")}</th>
                    <th className="px-2 py-2 font-medium">{t("inventory.count.counted")}</th>
                    <th className="px-2 py-2 font-medium">{t("inventory.count.difference")}</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-2 font-medium">
                      {t("inventory.document.presentation")}
                    </th>
                    <th className="px-2 py-2 font-medium">{t("inventory.document.quantity")}</th>
                  </>
                )}
                {conCosto && (
                  <th className="px-2 py-2 font-medium">{t("inventory.document.unitCost")}</th>
                )}
                {conLote && (
                  <>
                    <th className="px-2 py-2 font-medium">{t("inventory.document.lotCode")}</th>
                    <th className="px-2 py-2 font-medium">
                      {t("inventory.document.lotExpiresAt")}
                    </th>
                  </>
                )}
                {conUbicacion && (
                  <th className="px-2 py-2 font-medium">{t("inventory.document.location")}</th>
                )}
                <th className="px-2 py-2 font-medium">{t("inventory.document.stockChange")}</th>
                {editable && !esConteo && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {document.rows
                .filter(
                  (row) =>
                    !esConteo ||
                    !soloDiscrepancias ||
                    (row.difference !== null &&
                      row.difference !== undefined &&
                      row.difference !== "0"),
                )
                .map((row) => (
                  <LineRow
                    key={row.lineNo}
                    documentId={documentId}
                    row={row}
                    autoFocusQuantity={row.id === focusLineId}
                    product={productosPorId.get(row.productId)}
                    editable={editable}
                    conCosto={conCosto}
                    conLote={conLote}
                    conUbicacion={conUbicacion}
                    esSalida={document.type === "exit"}
                    esConteo={esConteo}
                  />
                ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {dialog === "confirm" && (
        <ConfirmDialog
          title={t("inventory.document.confirmTitle", {
            type: t(`inventory.documentType.${document.type}`),
          })}
          body={t("inventory.document.confirmBody", { lines: document.rows.length })}
          confirmLabel={`${t("inventory.document.confirm")} ${t(
            `inventory.documentType.${document.type}`,
          ).toLowerCase()}`}
          cancelLabel={t("common.form.cancel")}
          busy={confirmDocument.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setActionError(null);
            confirmDocument.mutate(undefined, {
              onSuccess: (res) => {
                setConfirmado(true);
                setDrifted((res as { drifted?: number }).drifted ?? 0);
              },
              onError: (apiError: ApiError) => setActionError(apiError.message),
              onSettled: () => setDialog(null),
            });
          }}
        />
      )}

      {dialog === "cancel" && (
        <ConfirmDialog
          title={t("inventory.document.cancelTitle", { folio: document.folio })}
          body={t("inventory.document.cancelBody", { folio: document.folio })}
          confirmLabel={t("inventory.document.cancel")}
          cancelLabel={t("common.form.cancel")}
          busy={cancelDocument.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setActionError(null);
            cancelDocument.mutate(undefined, {
              onError: (apiError: ApiError) => setActionError(apiError.message),
              onSettled: () => setDialog(null),
            });
          }}
        />
      )}
    </section>
  );
}

/**
 * Una fila del borrador, con AUTOGUARDADO: cada cambio se manda con debounce.
 *
 * El debounce no es cosmético — sin él, escribir "1500" haría cuatro requests y
 * la previa parpadearía con saldos intermedios que nunca existieron.
 */
function LineRow({
  documentId,
  row,
  product,
  editable,
  conCosto,
  conLote,
  conUbicacion,
  esSalida,
  esConteo,
  autoFocusQuantity,
}: {
  documentId: string;
  row: DocumentRow;
  product: DocumentProduct | undefined;
  editable: boolean;
  conCosto: boolean;
  conLote: boolean;
  conUbicacion: boolean;
  esSalida: boolean;
  esConteo: boolean;
  autoFocusQuantity: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(row.quantityInput ?? "");
  // Lo CONTADO: el dato que un inventario físico viene a capturar.
  const [counted, setCounted] = useState(row.counted ?? "");
  const [unitCost, setUnitCost] = useState(row.unitCost ?? "");
  const [lotCode, setLotCode] = useState(row.lotCode ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expiresAt?.slice(0, 10) ?? "");
  // La ubicación (pasillo, estante, rack). La línea NACE con la de la FICHA
  // del producto (Carlos, 2026-09-01): la ficha dice dónde suele estar, y
  // quien recibe solo corrige si esta vez quedó en otro lado. Al confirmar,
  // lo capturado vuelve a la ficha — el ciclo se cierra solo.
  const [location, setLocation] = useState(row.location ?? product?.location ?? "");
  const primeraCarga = useRef(true);
  const primeraCargaCosto = useRef(true);
  const primeraCargaLote = useRef(true);
  const primeraCargaCaducidad = useRef(true);
  const primeraCargaUbicacion = useRef(true);
  const primeraCargaContado = useRef(true);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  /**
   * El stock del producto se consulta PEREZOSO: recién cuando el usuario
   * enfoca el campo de lote. Un documento de 80 líneas no tiene por qué
   * disparar 80 consultas de stock al abrirse — y quien no toca el lote no
   * paga nada.
   */
  const [lotTocado, setLotTocado] = useState(false);
  const { data: stockProducto } = useStock(conLote && lotTocado ? row.productId : undefined);

  const invalidar = () => {
    // Recargar el documento es lo que refresca la PREVIA: el stock resultante
    // lo calcula el servidor, no la pantalla.
    void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, documentId] });
  };

  const guardar = useMutation({
    mutationFn: (value: number | null) =>
      updateDocumentLine(documentId, row.id, { quantity: value }),
    onSuccess: invalidar,
  });

  const guardarCosto = useMutation({
    mutationFn: (value: number | null) =>
      updateDocumentLine(documentId, row.id, { unitCost: value }),
    onSuccess: invalidar,
  });

  const quitar = useMutation({
    mutationFn: () => removeDocumentLine(documentId, row.id),
    onSuccess: invalidar,
  });

  const guardarLote = useMutation({
    mutationFn: (value: string | null) =>
      updateDocumentLine(documentId, row.id, { lotCode: value }),
    onSuccess: invalidar,
  });

  const guardarContado = useMutation({
    mutationFn: (value: number | null) =>
      updateDocumentLine(documentId, row.id, { counted: value }),
    onSuccess: invalidar,
  });

  const guardarUbicacion = useMutation({
    mutationFn: (value: string | null) =>
      updateDocumentLine(documentId, row.id, { location: value }),
    onSuccess: invalidar,
  });

  const guardarCaducidad = useMutation({
    mutationFn: (value: string | null) =>
      updateDocumentLine(documentId, row.id, { expiresAt: value }),
    onSuccess: invalidar,
  });

  const guardarPresentacion = useMutation({
    mutationFn: (presentationId: string | null) =>
      updateDocumentLine(documentId, row.id, { presentationId }),
    onSuccess: invalidar,
  });

  useEffect(() => {
    // No dispara en el primer render: montar la fila no es editarla.
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    if (quantity === (row.quantityInput ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      const parsed = quantity.trim() === "" ? null : Number(quantity);
      guardar.mutate(Number.isFinite(parsed) ? parsed : null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [quantity, row.quantityInput, guardar.mutate]);

  useEffect(() => {
    if (primeraCargaCosto.current) {
      primeraCargaCosto.current = false;
      return;
    }
    if (unitCost === (row.unitCost ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      const parsed = unitCost.trim() === "" ? null : Number(unitCost);
      guardarCosto.mutate(Number.isFinite(parsed) ? parsed : null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [unitCost, row.unitCost, guardarCosto.mutate]);

  useEffect(() => {
    if (primeraCargaLote.current) {
      primeraCargaLote.current = false;
      return;
    }
    if (lotCode === (row.lotCode ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      guardarLote.mutate(lotCode.trim() === "" ? null : lotCode.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [lotCode, row.lotCode, guardarLote.mutate]);

  useEffect(() => {
    if (primeraCargaContado.current) {
      primeraCargaContado.current = false;
      return;
    }
    if (counted === (row.counted ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      // Vacío es "no llegué a contar esta fila", que NO es contar cero: el
      // resumen las separa como omitidas y el asiento no las toca.
      const parsed = counted.trim() === "" ? null : Number(counted);
      guardarContado.mutate(parsed !== null && Number.isFinite(parsed) ? parsed : null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [counted, row.counted, guardarContado.mutate]);

  useEffect(() => {
    if (primeraCargaUbicacion.current) {
      primeraCargaUbicacion.current = false;
      return;
    }
    if (location === (row.location ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      guardarUbicacion.mutate(location.trim() === "" ? null : location.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [location, row.location, guardarUbicacion.mutate]);

  useEffect(() => {
    if (primeraCargaCaducidad.current) {
      primeraCargaCaducidad.current = false;
      return;
    }
    if (expiresAt === (row.expiresAt?.slice(0, 10) ?? "")) {
      return;
    }
    const timer = setTimeout(() => {
      guardarCaducidad.mutate(expiresAt === "" ? null : expiresAt);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [expiresAt, row.expiresAt, guardarCaducidad.mutate]);

  // El foco aterriza UNA vez, al montar la línea recién agregada.
  useEffect(() => {
    if (autoFocusQuantity) {
      quantityRef.current?.focus();
    }
  }, [autoFocusQuantity]);

  /**
   * ── La caducidad SIGUE al lote (Carlos, 2026-08-24 y 2026-09-01) ─────
   *
   * Si el lote tecleado YA existe, su caducidad es un dato conocido y se
   * pone SIEMPRE — la primera versión solo llenaba vacíos, y al cambiar de
   * lote la fecha del anterior se quedaba pegada (el bug exacto del
   * pantallazo: «ST2 ya existe con otra fecha»). Un lote desconocido LIMPIA
   * la fecha: es del lote, no de la línea. El ref evita re-procesar el mismo
   * código — así la fecha que el usuario corrija a mano no se le pelea.
   */
  const ultimoLoteProcesado = useRef((row.lotCode ?? "").trim());
  useEffect(() => {
    const codigo = lotCode.trim();
    if (codigo === "" || stockProducto === undefined || ultimoLoteProcesado.current === codigo) {
      return;
    }
    ultimoLoteProcesado.current = codigo;
    const conocido = stockProducto.rows
      .flatMap((r) => r.lots ?? [])
      .find((lot) => lot.lotCode === codigo);
    setExpiresAt(conocido?.expiresAt != null ? conocido.expiresAt.slice(0, 10) : "");
  }, [lotCode, stockProducto]);

  // La altura del input (py-1 + text-sm + borde): las celdas de texto centran
  // su primera línea a esta altura para alinear con los inputs de la fila.
  const LINE_CELL = "flex min-h-[30px] items-center";

  const conError = row.errors.length > 0;
  const presentacion = product?.presentations.find((p) => p.id === row.presentationId);

  return (
    // `align-top` + `LINE_CELL` (Carlos, 2026-08-26): la celda de cantidad
    // crece con sus ayudas (equivalencia, disponible, lotes) y con el
    // centrado por defecto el input quedaba a otra altura que el resto de la
    // fila. Ahora todo alinea al tope y cada celda de texto centra su
    // contenido a la altura del input — las ayudas caen debajo.
    <tr className={`border-b align-top last:border-0 ${conError ? "bg-destructive/5" : ""}`}>
      <td className="px-2 py-2">
        <div className={LINE_CELL}>{row.lineNo}</div>
      </td>
      <td className="px-2 py-2">
        <div className={`${LINE_CELL} flex-wrap gap-x-2`}>
          <span className="font-mono">{row.sku}</span>
          {product !== undefined && <span className="text-muted-foreground">{product.name}</span>}
        </div>
      </td>
      {esConteo ? (
        <>
          {/* Teórico: lo que el sistema creía tener al capturar la línea. */}
          <td className="px-2 py-2">
            <div className={LINE_CELL}>{row.theoretical ?? "—"}</div>
          </td>
          {/*
            CONTADO — el único campo editable de un conteo, y el que se
            asienta. Antes este input mandaba `quantity`, que en una línea de
            conteo guarda el TEÓRICO: corregir acá no corregía el conteo,
            pisaba la referencia y al aprobar se aplicaba lo del archivo
            (Carlos, 2026-08-31).
          */}
          <td className="px-2 py-2">
            {editable ? (
              <>
                <label htmlFor={`line-${row.lineNo}-counted`} className="sr-only">
                  {t("inventory.count.counted")}
                </label>
                <input
                  id={`line-${row.lineNo}-counted`}
                  ref={quantityRef}
                  type="number"
                  step="0.0001"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
                {guardarContado.isPending && (
                  <span className="ml-2 text-muted-foreground text-xs">
                    {t("inventory.document.saving")}
                  </span>
                )}
              </>
            ) : (
              (row.counted ?? "—")
            )}
            {row.newLot && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                {t("inventory.count.newLot")}
              </span>
            )}
          </td>
          <td
            className={`px-2 py-2 ${
              row.difference !== null && row.difference !== undefined && row.difference !== "0"
                ? "font-medium text-destructive"
                : ""
            }`}
          >
            {row.difference ?? "—"}
          </td>
        </>
      ) : (
        <>
          <td className="px-2 py-2">
            {editable && product !== undefined ? (
              <>
                <label htmlFor={`line-${row.lineNo}-presentation`} className="sr-only">
                  {t("inventory.document.presentation")}
                </label>
                <select
                  id={`line-${row.lineNo}-presentation`}
                  value={row.presentationId ?? ""}
                  onChange={(event) => guardarPresentacion.mutate(event.target.value || null)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                >
                  {/*
                La opción sintética "Unidad base" solo existe si ninguna
                presentación ya la representa (factor 1) — dos nombres para lo
                mismo confunden, y peor: la sintética no pasa por
                `allowFractionalInput`, así que era un bypass de "solo
                enteros". Se conserva únicamente mientras la línea siga
                guardada sin presentación, para no mentir sobre su estado.
              */}
                  {(!product.presentations.some((p) => Number(p.factor) === 1) ||
                    row.presentationId === null) && (
                    <option value="">{t("inventory.document.presentationBase")}</option>
                  )}
                  {product.presentations.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              (presentacion?.name ?? t("inventory.document.presentationBase"))
            )}
          </td>
          <td className="px-2 py-2">
            {editable ? (
              <>
                <label htmlFor={`line-${row.lineNo}-quantity`} className="sr-only">
                  {t("inventory.document.quantity")}
                </label>
                <input
                  id={`line-${row.lineNo}-quantity`}
                  ref={quantityRef}
                  type="number"
                  step="0.0001"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
                {guardar.isPending && (
                  <span className="ml-2 text-muted-foreground text-xs">
                    {t("inventory.document.saving")}
                  </span>
                )}
              </>
            ) : (
              (row.quantityInput ?? "—")
            )}
            <Equivalencia row={row} product={product} locale={resolveUiLocale(i18n)} />
            {esSalida && <Disponible row={row} product={product} locale={resolveUiLocale(i18n)} />}
            {esSalida && <RepartoFefo row={row} />}
            {esSalida && product?.isComposite === true && <Compuesto product={product} />}
          </td>
        </>
      )}
      {conCosto && (
        <td className="px-2 py-2">
          {editable ? (
            <>
              <label htmlFor={`line-${row.lineNo}-unit-cost`} className="sr-only">
                {t("inventory.document.unitCost")}
              </label>
              <input
                id={`line-${row.lineNo}-unit-cost`}
                type="number"
                step={MONEY_STEP}
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
            </>
          ) : (
            (row.unitCost ?? "—")
          )}
        </td>
      )}
      {/*
        F3-LOTS: la captura del lote vive en la ENTRADA — en la salida lo
        elige FEFO (RepartoFefo) y en el conteo viene por la planilla. Sin
        estos inputs, `inventory.lot_required` pedía algo que la pantalla no
        dejaba dar. Encabezado en la columna, label sr-only en el input.
      */}
      {conLote && (
        <>
          <td className="px-2 py-2">
            {product?.tracksLots === true ? (
              editable ? (
                <>
                  <label htmlFor={`line-${row.lineNo}-lot`} className="sr-only">
                    {t("inventory.document.lotCode")}
                  </label>
                  <input
                    id={`line-${row.lineNo}-lot`}
                    type="text"
                    value={lotCode}
                    onFocus={() => setLotTocado(true)}
                    onChange={(event) =>
                      // Se normaliza AL TECLEAR y no solo al guardar: el API
                      // también lo hace —esa es la garantía de los datos— pero
                      // si la pantalla no, el cajero escribe `stm01`, guarda, y
                      // al recargar ve `STM01`. Lo que se escribe tiene que ser
                      // lo que se guarda.
                      setLotCode(normalizeLotCode(event.target.value))
                    }
                    className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  />
                </>
              ) : (
                (row.lotCode ?? "—")
              )
            ) : (
              "—"
            )}
          </td>
          <td className="px-2 py-2">
            {product?.tracksLots === true ? (
              editable ? (
                <>
                  <label htmlFor={`line-${row.lineNo}-expires`} className="sr-only">
                    {t("inventory.document.lotExpiresAt")}
                  </label>
                  <input
                    id={`line-${row.lineNo}-expires`}
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  />
                </>
              ) : (
                (row.expiresAt?.slice(0, 10) ?? "—")
              )
            ) : (
              "—"
            )}
          </td>
        </>
      )}
      {/*
        La UBICACIÓN no se pregunta por el LOTE, se pregunta por el NEGOCIO.
        Para un producto con lote es parte de la identidad del saldo
        (`stock_lots` es lote+almacén+ubicación: contar el estante A-1 no dice
        nada del B-2). Para uno sin lote es su ubicación de REFERENCIA, que se
        actualiza al confirmar el conteo. En ambos casos se captura igual, y
        atarla a `tracksLots` dejaba sin dónde escribirla justo a los productos
        más comunes (Carlos, 2026-08-31).
      */}
      {conUbicacion && (
        <td className="px-2 py-2">
          {editable ? (
            <>
              <label htmlFor={`line-${row.lineNo}-location`} className="sr-only">
                {t("inventory.document.location")}
              </label>
              <input
                id={`line-${row.lineNo}-location`}
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder={t("inventory.document.locationPlaceholder")}
                className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
            </>
          ) : (
            (row.location ?? "—")
          )}
        </td>
      )}
      <td className="px-2 py-2">
        <div className={`${LINE_CELL} flex-wrap gap-x-2`}>
          <span>
            {/* Sin saldo que contar (anulados, conteos asentados): «—» antes
                que un número reconstruido a medias. El exacto vive en el kardex. */}
            {row.stockBefore === null || row.stockAfter === null
              ? "—"
              : `${formatQuantity(row.stockBefore, product?.baseUnit ?? "")} → ${formatQuantity(row.stockAfter, product?.baseUnit ?? "")}`}
          </span>
          {!esConteo && row.newLot && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {t("inventory.document.newLot")}
            </span>
          )}
        </div>
      </td>
      {/*
        Quitar una línea del BORRADOR no toca el ledger: la línea todavía no
        movió nada. Por eso no hay diálogo de confirmación — pedirla acá
        entrenaría a aceptar sin leer (mismo criterio que LotEditor).
      */}
      {editable && !esConteo && (
        <td className="px-2 py-2 text-right">
          <div className={`${LINE_CELL} justify-end`}>
            <button
              type="button"
              onClick={() => quitar.mutate()}
              disabled={quitar.isPending}
              className="text-muted-foreground text-xs underline-offset-2 hover:text-destructive hover:underline"
            >
              {t("inventory.document.removeLine")}
            </button>
          </div>
        </td>
      )}
      {conError && (
        <td className="px-2 py-2 text-destructive text-xs">
          <div className={LINE_CELL}>
            {row.errors.map((error) => t(error.code, error.args)).join(" · ")}
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * Lo que HAY, junto a lo que se pide. Solo en salidas: en una entrada el
 * disponible no restringe nada y sería ruido.
 *
 * `row.available` viene ENCADENADO por el servidor — la segunda línea de un
 * mismo producto ya parte del saldo que dejó la primera. Ese es justo el caso
 * que se escapa cuando cada fila se valida sola.
 *
 * Con presentación elegida se dice también en esa presentación, porque quien
 * saca en cajas necesita el número en cajas y no hacer la división de cabeza
 * sobre el mostrador. Y se REDONDEA HACIA ABAJO cuando la presentación no
 * admite fracciones: de 125 unidades salen 10 cajas, no 10.4167 — mostrar el
 * decimal invitaría a teclear una cantidad que el API rechaza.
 */
function Disponible({
  row,
  product,
  locale,
}: {
  row: DocumentRow;
  product: DocumentProduct | undefined;
  locale: Parameters<typeof unitName>[1];
}) {
  const { t } = useTranslation();

  // Sin `available` no hay nada que decir: el documento ya no es un borrador
  // y «disponible» es una pregunta de la previa (Carlos, 2026-09-01).
  if (product === undefined || row.available === null) {
    return null;
  }
  // El plural lo decide la CANTIDAD: «1 pieza», «2 piezas».
  const unidadDe = (cantidad: string | number) => unitLabelFor(cantidad, product.baseUnit, locale);
  const presentacion = product.presentations.find((p) => p.id === row.presentationId);

  if (presentacion === undefined) {
    return (
      <span className="block text-muted-foreground text-xs">
        {t("inventory.document.availableBase", {
          quantity: formatQuantity(row.available, product.baseUnit),
          unit: unidadDe(row.available),
        })}
      </span>
    );
  }

  const factor = Number(presentacion.factor);
  const enPresentacion = Number(row.available) / factor;
  const mostrado = presentacion.allowFractionalInput
    ? Number(enPresentacion.toFixed(4))
    : Math.floor(enPresentacion);

  return (
    <span className="block text-muted-foreground text-xs">
      {t("inventory.document.availableWithPresentation", {
        base: formatQuantity(row.available, product.baseUnit),
        unit: unidadDe(row.available),
        quantity: mostrado,
        presentation: presentacion.name,
      })}
    </span>
  );
}

/**
 * De qué lote va a salir la mercancía.
 *
 * Sale del MISMO `allocateFefo` que usa el confirm, así que esto no es una
 * estimación: es el reparto que se va a asentar. La CADUCIDAD se muestra
 * porque es el dato por el que alguien querría forzar otro lote — sin ella,
 * "saldrá de st10" no le dice nada a quien está mirando la caja.
 */
function RepartoFefo({ row }: { row: DocumentRow }) {
  const { t, i18n } = useTranslation();

  if (row.lotPlan === null || row.lotPlan.length === 0) {
    return null;
  }

  // `formatCalendarDate` y no un `DateTimeFormat` a secas: una caducidad es
  // una fecha de CALENDARIO, y el huso local la corría un día hacia atrás.
  const fecha = (iso: string | null) =>
    iso === null ? null : formatCalendarDate(iso, resolveUiLocale(i18n));

  return (
    <span className="mt-1 block text-muted-foreground text-xs">
      {t("inventory.document.lotPlan")}:{" "}
      {row.lotPlan.map((take, index) => {
        const vence = fecha(take.expiresAt);
        return (
          <span key={`${take.lotCode}-${take.location}`}>
            {index > 0 && " · "}
            {t("inventory.document.lotPlanTake", {
              quantity: take.quantity,
              lotCode: take.lotCode,
            })}
            {vence !== null && ` (${t("inventory.document.lotExpires", { date: vence })})`}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Un compuesto no tiene saldo propio: se arma al consumirlo. Lo que se
 * descuenta son sus COMPONENTES, y el techo son las unidades armables con lo
 * que hay EN ESTE almacén — no en todos, que es lo que diría la ficha del
 * producto y sería mentira acá.
 */
function Compuesto({ product }: { product: DocumentProduct }) {
  const { t } = useTranslation();

  return (
    <span className="mt-1 block text-muted-foreground text-xs">
      {t("inventory.document.compositeHint")}
      {product.availableUnits !== null &&
        ` ${t("inventory.document.compositeCeiling", { units: product.availableUnits })}`}
    </span>
  );
}

/**
 * "3 Caja = 36 unidades" — la traducción entre lo que la persona teclea y lo
 * que el stock va a mover.
 *
 * Solo aparece con presentación elegida: sin ella la cantidad YA está en
 * unidad base y repetirla sería ruido. El nombre en plural y minúscula lo
 * decide la frase, no la unidad — mismo criterio que `presentations-tab.tsx`.
 */
function Equivalencia({
  row,
  product,
  locale,
}: {
  row: DocumentRow;
  product: DocumentProduct | undefined;
  locale: Parameters<typeof unitName>[1];
}) {
  const { t } = useTranslation();

  if (product === undefined || row.presentationId === null || row.quantityBase === null) {
    return null;
  }
  const presentacion = product.presentations.find((p) => p.id === row.presentationId);
  if (presentacion === undefined || row.quantityInput === null) {
    return null;
  }

  return (
    <span className="ml-2 block text-muted-foreground text-xs">
      {t("inventory.document.equivalence", {
        quantity: row.quantityInput,
        presentation: presentacion.name,
        base: row.quantityBase,
        unit: unitName(product.baseUnit, locale, { plural: true }).toLowerCase(),
      })}
    </span>
  );
}
