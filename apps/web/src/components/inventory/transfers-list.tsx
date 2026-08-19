import { TRANSFER_STALE_DAYS } from "@sellpoint/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { usePermissions } from "@/lib/auth/permissions";
import type { TransferRow } from "@/lib/inventory/transfers-api";
import {
  useCancelTransfer,
  useCreateReceiptDraft,
  useTransfers,
} from "@/lib/inventory/transfers-hooks";
import { WarehouseSelect } from "./warehouse-select";

type Tab = "incoming" | "outgoing";

/**
 * F3-TRANSFER-05/06/07 — traspasos en tránsito.
 *
 * **Esta pantalla no captura nada.** El despacho es una Salida y la recepción
 * una Entrada; acá se ve el ESTADO del viaje —qué salió y no llegó, y hace
 * cuánto— y se lanzan las dos únicas acciones que no viven en otra pantalla:
 * recibir y cancelar.
 *
 * Los contadores de los tabs salen de `meta` y NO de contar las filas
 * visibles: con paginación, contar la página diría "1" cuando hay siete.
 */
export function TransfersList() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const [tab, setTab] = useState<Tab>("incoming");
  const [destinationWarehouseId, setDestination] = useState<string | null>(null);
  const [soloDemorados, setSoloDemorados] = useState(false);
  const [recibiendo, setRecibiendo] = useState<TransferRow | null>(null);
  const [cancelando, setCancelando] = useState<TransferRow | null>(null);

  const { data, isPending } = useTransfers({
    direction: tab,
    ...(destinationWarehouseId !== null ? { destinationWarehouseId } : {}),
    ...(soloDemorados ? { olderThanDays: TRANSFER_STALE_DAYS } : {}),
  });

  const meta = data?.meta ?? { incomingCount: 0, outgoingCount: 0 };
  const filas = data?.rows ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("inventory.transfers.title")}</h1>

      <div role="tablist" className="flex gap-2">
        <TabBoton activo={tab === "incoming"} onClick={() => setTab("incoming")}>
          {t("inventory.transfers.incoming")} ({meta.incomingCount})
        </TabBoton>
        <TabBoton activo={tab === "outgoing"} onClick={() => setTab("outgoing")}>
          {t("inventory.transfers.outgoing")} ({meta.outgoingCount})
        </TabBoton>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-52 flex-col gap-1">
          <label htmlFor="transfers-destination" className="font-medium text-sm">
            {t("inventory.transfers.destination")}
          </label>
          <WarehouseSelect
            id="transfers-destination"
            value={destinationWarehouseId}
            onChange={setDestination}
            scoped={false}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={soloDemorados}
            onChange={(event) => setSoloDemorados(event.target.checked)}
          />
          {t("inventory.transfers.olderThanStale")}
        </label>
      </div>

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("inventory.transfers.empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">{t("inventory.list.folio")}</th>
              <th className="py-2 font-medium">{t("inventory.transfers.origin")}</th>
              <th className="py-2 font-medium">{t("inventory.transfers.destination")}</th>
              <th className="py-2 font-medium">{t("inventory.transfers.sentBy")}</th>
              <th className="py-2 font-medium">{t("inventory.transfers.lines")}</th>
              <th className="py-2 font-medium">{t("inventory.transfers.days")}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filas.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-2 font-mono">
                  {row.documentId !== null && row.folio !== null ? (
                    <Link
                      to="/movements/documents/$documentId"
                      params={{ documentId: row.documentId }}
                      className="underline"
                    >
                      {row.folio}
                    </Link>
                  ) : (
                    row.folio
                  )}
                </td>
                <td className="py-2">{row.origin.name}</td>
                <td className="py-2">{row.destination.name}</td>
                <td className="py-2">{row.createdBy.name}</td>
                <td className="py-2">{row.lineCount}</td>
                <td className="py-2">
                  {row.daysInTransit}
                  {/* El badge sale del DATO `isStale`, no de comparar días acá:
                      el umbral vive en el servidor y una segunda copia se
                      desincronizaría. */}
                  {row.isStale && (
                    <Badge
                      variant="warning"
                      data-testid="stale-badge"
                      title={t("inventory.transfers.staleTitle")}
                      className="ml-2"
                    >
                      !
                    </Badge>
                  )}
                </td>
                <td className="flex justify-end gap-2 py-2">
                  {tab === "incoming" && has("inventory:movement") && (
                    <button
                      type="button"
                      onClick={() => setRecibiendo(row)}
                      className="rounded-md border border-input px-3 py-1.5 text-sm"
                    >
                      {t("inventory.transfers.receive")}
                    </button>
                  )}
                  {has("inventory:manage") && (
                    <button
                      type="button"
                      onClick={() => setCancelando(row)}
                      className="rounded-md border border-input px-3 py-1.5 text-sm"
                    >
                      {t("inventory.transfers.cancel")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {recibiendo !== null && (
        <DialogoRecepcion row={recibiendo} onClose={() => setRecibiendo(null)} />
      )}
      {cancelando !== null && (
        <DialogoCancelar row={cancelando} onClose={() => setCancelando(null)} />
      )}
    </section>
  );
}

function TabBoton({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activo}
      onClick={onClick}
      className={`rounded-md border border-input px-3 py-2 text-sm ${
        activo ? "bg-primary text-primary-foreground" : ""
      }`}
    >
      {children}
    </button>
  );
}

/**
 * El diálogo de recepción **no captura cantidades**: crea el borrador y navega.
 *
 * Una tabla acá sería una segunda copia de la tabla de líneas del documento, y
 * las dos divergirían en cuanto una gane una columna (lote, ubicación). Además
 * el borrador nace con folio, así que la recepción se retoma si se cierra el
 * sistema a mitad de la descarga del camión — un diálogo no sobrevive a un F5.
 */
function DialogoRecepcion({ row, onClose }: { row: TransferRow; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const crear = useCreateReceiptDraft();
  const [error, setError] = useState<string | null>(null);

  return (
    <ConfirmDialog
      title={t("inventory.transfers.receiveTitle", { folio: row.folio })}
      // El folio va en el CUERPO y no solo en el título: `ConfirmDialog` pone
      // el título en `aria-label`, así que quien MIRA la pantalla no lo vería.
      body={`${t("inventory.transfers.receiveSummary", {
        folio: row.folio,
        origin: row.origin.name,
        destination: row.destination.name,
        lines: row.lineCount,
        who: row.createdBy.name,
      })} — ${t("inventory.transfers.receiveBody")}`}
      confirmLabel={t("inventory.transfers.receiveConfirm")}
      cancelLabel={t("common.form.cancel")}
      busy={crear.isPending}
      error={error ?? undefined}
      onCancel={onClose}
      onConfirm={() => {
        setError(null);
        crear.mutate(row.id, {
          onSuccess: (draft) => {
            void navigate({
              to: "/movements/documents/$documentId",
              params: { documentId: draft.id },
            });
          },
          // 409: alguien lo recibió o lo canceló mientras tanto. Se explica en
          // vez de dejar un error mudo.
          onError: () => setError(t("inventory.transfers.receiveFailed")),
        });
      }}
    />
  );
}

/**
 * Cancelar exige justificación **y** avisa que el stock no vuelve.
 *
 * La leyenda no es un adorno: es lo único que le dice a quien cancela que el
 * saldo no se repone solo y qué hacer si la mercancía reaparece.
 */
function DialogoCancelar({ row, onClose }: { row: TransferRow; onClose: () => void }) {
  const { t } = useTranslation();
  const cancelar = useCancelTransfer();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <ConfirmDialog
      title={t("inventory.transfers.cancelTitle", { folio: row.folio })}
      body={t("inventory.transfers.cancelWarning")}
      confirmLabel={t("inventory.transfers.cancel")}
      cancelLabel={t("common.form.cancel")}
      busy={cancelar.isPending}
      error={error ?? undefined}
      // El API pide 5 caracteres mínimo: la pantalla lo dice ANTES en vez de
      // dejar chocar con el 400.
      confirmDisabled={reason.trim().length < 5}
      onCancel={onClose}
      onConfirm={() => {
        setError(null);
        cancelar.mutate(
          { id: row.id, reason: reason.trim() },
          {
            onSuccess: onClose,
            onError: () => setError(t("inventory.transfers.cancelFailed")),
          },
        );
      }}
    >
      <label htmlFor="cancel-reason" className="font-medium text-sm">
        {t("inventory.transfers.cancelReason")}
      </label>
      <textarea
        id="cancel-reason"
        value={reason}
        rows={3}
        placeholder={t("inventory.transfers.cancelReasonPlaceholder")}
        onChange={(event) => setReason(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </ConfirmDialog>
  );
}
