import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { usePermissions } from "@/lib/auth/permissions";
import { updateDocumentLine } from "@/lib/inventory/api";
import {
  DOCUMENTS_QUERY_KEY,
  useCancelDocument,
  useConfirmDocument,
  useDocument,
} from "@/lib/inventory/hooks";
import type { DocumentRow } from "@/lib/inventory/types";
import { DownloadDocumentButton } from "./download-document-button";

const DEBOUNCE_MS = 400;

interface DocumentDetailProps {
  documentId: string;
}

/**
 * F3-DOC-09 — la pantalla del documento.
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
 */
export function DocumentDetail({ documentId }: DocumentDetailProps) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { data: document, isPending } = useDocument(documentId);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);

  const confirmDocument = useConfirmDocument(documentId);
  const cancelDocument = useCancelDocument(documentId);

  if (isPending || document === undefined) {
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  }

  const editable = document.status === "draft" && has("inventory:movement");
  const conErrores = document.summary.errors > 0;
  const sinLineas = document.rows.length === 0;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono font-semibold text-2xl">{document.folio}</h1>
          <p className="text-muted-foreground text-sm">
            {t(`inventory.documentType.${document.type}`)} · {document.warehouse.name} ·{" "}
            {t(`inventory.status.${document.status}`)}
          </p>
          {document.reasonCode !== null && (
            <p className="text-muted-foreground text-sm">
              {t(`inventory.reason.${document.reasonCode}`)}
              {document.reference !== null && ` · ${document.reference}`}
            </p>
          )}
          {document.reasonNote !== null && (
            <p className="text-muted-foreground text-sm italic">{document.reasonNote}</p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <DownloadDocumentButton documentId={documentId} folio={document.folio} />
          {editable && (
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
                disabled={conErrores || sinLineas || confirmDocument.isPending}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                {t("inventory.document.confirm")}
              </button>
            </>
          )}
        </div>
      </header>

      {!editable && document.status !== "draft" && (
        <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
          {t("inventory.document.readOnly")}
        </p>
      )}

      {conErrores && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {t("inventory.document.hasErrors")}
        </p>
      )}

      {sinLineas ? (
        <p className="text-muted-foreground text-sm">{t("inventory.document.emptyLines")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">#</th>
              <th className="py-2 font-medium">{t("inventory.list.folio")}</th>
              <th className="py-2 font-medium">{t("inventory.document.quantity")}</th>
              <th className="py-2 font-medium">{t("inventory.document.stockChange")}</th>
            </tr>
          </thead>
          <tbody>
            {document.rows.map((row) => (
              <LineRow key={row.lineNo} documentId={documentId} row={row} editable={editable} />
            ))}
          </tbody>
        </table>
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
            confirmDocument.mutate(undefined, { onSettled: () => setDialog(null) });
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
  editable,
}: {
  documentId: string;
  row: DocumentRow;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(row.quantityInput ?? "");
  const primeraCarga = useRef(true);

  const guardar = useMutation({
    mutationFn: (value: number | null) =>
      updateDocumentLine(documentId, String(row.lineNo), { quantity: value }),
    onSuccess: () => {
      // Recargar el documento es lo que refresca la PREVIA: el stock resultante
      // lo calcula el servidor, no la pantalla.
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, documentId] });
    },
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

  const conError = row.errors.length > 0;

  return (
    <tr className={`border-b last:border-0 ${conError ? "bg-destructive/5" : ""}`}>
      <td className="py-2">{row.lineNo}</td>
      <td className="py-2">{row.sku}</td>
      <td className="py-2">
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
      </td>
      <td className="py-2">
        {row.stockBefore} → {row.stockAfter}
        {row.newLot && (
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
            {t("inventory.document.newLot")}
          </span>
        )}
      </td>
      {conError && (
        <td className="py-2 text-destructive text-xs">
          {row.errors.map((error) => t(error.code, error.args)).join(" · ")}
        </td>
      )}
    </tr>
  );
}
