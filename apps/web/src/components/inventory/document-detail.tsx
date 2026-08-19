import { REASON_RULES, unitName } from "@sellpoint/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { resolveUiLocale } from "@/lib/accept-language";
import { usePermissions } from "@/lib/auth/permissions";
import { updateDocumentLine } from "@/lib/inventory/api";
import { headerErrors } from "@/lib/inventory/entry-schema";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import {
  DOCUMENTS_QUERY_KEY,
  useCancelDocument,
  useConfirmDocument,
  useDocument,
} from "@/lib/inventory/hooks";
import type { DocumentProduct, DocumentRow } from "@/lib/inventory/types";
import { MONEY_STEP } from "@/lib/products/money";
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
  const { data: document, isPending } = useDocument(documentId);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [drifted, setDrifted] = useState(0);
  const [soloDiscrepancias, setSoloDiscrepancias] = useState(false);

  const confirmDocument = useConfirmDocument(documentId);
  const cancelDocument = useCancelDocument(documentId);

  if (isPending || document === undefined) {
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
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
  const conLote = document.type === "entry" && document.products.some((p) => p.tracksLots === true);
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
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-primary/10 px-4 py-3 text-sm"
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

      {editable && !esConteo && <AddLineForm documentId={documentId} />}

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
        // El scroll vive acá: la PÁGINA nunca se desborda, la tabla sí.
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">{t("inventory.document.product")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.document.presentation")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.document.quantity")}</th>
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
                <th className="px-2 py-2 font-medium">{t("inventory.document.stockChange")}</th>
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
                    product={productosPorId.get(row.productId)}
                    editable={editable}
                    conCosto={conCosto}
                    conLote={conLote}
                    esSalida={document.type === "exit"}
                    esConteo={esConteo}
                  />
                ))}
            </tbody>
          </table>
        </div>
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
          cancelLabel={t("common.actions.cancel")}
          busy={confirmDocument.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            confirmDocument.mutate(undefined, {
              onSuccess: (res) => {
                setConfirmado(true);
                setDrifted((res as { drifted?: number }).drifted ?? 0);
              },
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
          cancelLabel={t("common.actions.cancel")}
          busy={cancelDocument.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            cancelDocument.mutate(undefined, { onSettled: () => setDialog(null) });
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
  esSalida,
  esConteo,
}: {
  documentId: string;
  row: DocumentRow;
  product: DocumentProduct | undefined;
  editable: boolean;
  conCosto: boolean;
  conLote: boolean;
  esSalida: boolean;
  esConteo: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(row.quantityInput ?? "");
  const [unitCost, setUnitCost] = useState(row.unitCost ?? "");
  const [lotCode, setLotCode] = useState(row.lotCode ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expiresAt?.slice(0, 10) ?? "");
  const primeraCarga = useRef(true);
  const primeraCargaCosto = useRef(true);
  const primeraCargaLote = useRef(true);
  const primeraCargaCaducidad = useRef(true);

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

  const guardarLote = useMutation({
    mutationFn: (value: string | null) =>
      updateDocumentLine(documentId, row.id, { lotCode: value }),
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

  const conError = row.errors.length > 0;
  const presentacion = product?.presentations.find((p) => p.id === row.presentationId);

  return (
    <tr className={`border-b last:border-0 ${conError ? "bg-destructive/5" : ""}`}>
      <td className="px-2 py-2">{row.lineNo}</td>
      <td className="px-2 py-2">
        <span className="font-mono">{row.sku}</span>
        {product !== undefined && (
          <span className="ml-2 text-muted-foreground">{product.name}</span>
        )}
      </td>
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
      {esConteo && (
        <>
          <td className="px-2 py-2">{row.theoretical}</td>
          <td className="px-2 py-2">
            {row.counted ?? "—"}
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
                    onChange={(event) => setLotCode(event.target.value)}
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
      <td className="px-2 py-2">
        {row.stockBefore} → {row.stockAfter}
        {!esConteo && row.newLot && (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
            {t("inventory.document.newLot")}
          </span>
        )}
      </td>
      {conError && (
        <td className="px-2 py-2 text-destructive text-xs">
          {row.errors.map((error) => t(error.code, error.args)).join(" · ")}
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

  if (product === undefined) {
    return null;
  }
  const unidad = unitName(product.baseUnit, locale, { plural: true }).toLowerCase();
  const presentacion = product.presentations.find((p) => p.id === row.presentationId);

  if (presentacion === undefined) {
    return (
      <span className="block text-muted-foreground text-xs">
        {t("inventory.document.availableBase", { quantity: row.available, unit: unidad })}
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
        base: row.available,
        unit: unidad,
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
