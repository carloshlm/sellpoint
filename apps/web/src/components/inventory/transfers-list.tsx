import { localeToBcp47, TRANSFER_STALE_DAYS } from "@sellpoint/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paginator } from "@/components/ui/paginator";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { resolveUiLocale } from "@/lib/accept-language";
import { usePermissions } from "@/lib/auth/permissions";
import { downloadInTransit } from "@/lib/inventory/api";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import type { TransferRow } from "@/lib/inventory/transfers-api";
import {
  useCancelTransfer,
  useCreateReceiptDraft,
  useTransfers,
} from "@/lib/inventory/transfers-hooks";
import { useAuthStore } from "@/stores/auth.store";
import { WarehouseSelect } from "./warehouse-select";

type Tab = "incoming" | "outgoing" | "canceled";

/** Cuánto esperar antes de buscar por folio: suficiente para tipear seis dígitos. */
const FOLIO_DEBOUNCE_MS = 300;

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
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const [tab, setTab] = useState<Tab>("incoming");
  const timeZone = useAuthStore((s) => s.user?.tenant?.timezone);
  const localeTag = localeToBcp47(resolveUiLocale(i18n));
  const [exportando, setExportando] = useState(false);
  const [errorExport, setErrorExport] = useState<string | null>(null);
  const [destinationWarehouseId, setDestination] = useState<string | null>(null);
  const [soloDemorados, setSoloDemorados] = useState(false);
  // Los filtros de la pestaña Cancelados (Carlos, 2026-09-01): los mismos que
  // Entradas/Salidas/Inventario. Viven aparte de «Destino», que es el filtro
  // de lo pendiente y no se muestra en Cancelados.
  const [folioInput, setFolioInput] = useState("");
  const [folio, setFolio] = useState("");
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [recibiendo, setRecibiendo] = useState<TransferRow | null>(null);
  const [cancelando, setCancelando] = useState<TransferRow | null>(null);

  const [pagina, setPagina] = useState(1);

  // Cualquier filtro —el tab incluido— vuelve a la página 1.
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [tab, destinationWarehouseId, soloDemorados, folio, warehouseId, rango.from, rango.to]);

  // Debounce del folio, igual que en el listado de documentos.
  useEffect(() => {
    const timer = setTimeout(() => setFolio(folioInput.trim()), FOLIO_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [folioInput]);

  // La pestaña «Cancelados» no lleva dirección: un cancelado le importa a
  // quien era origen y a quien esperaba recibirlo (Carlos, 2026-09-01).
  const enCancelados = tab === "canceled";
  const { data, isPending } = useTransfers({
    ...(enCancelados ? { status: "canceled" as const } : { direction: tab }),
    ...(!enCancelados && destinationWarehouseId !== null ? { destinationWarehouseId } : {}),
    ...(enCancelados && folio !== "" ? { folio } : {}),
    ...(enCancelados && warehouseId !== null ? { warehouseId } : {}),
    ...(enCancelados && rango.from !== "" ? { from: rango.from } : {}),
    ...(enCancelados && rango.to !== "" ? { to: rango.to } : {}),
    ...(soloDemorados && !enCancelados ? { olderThanDays: TRANSFER_STALE_DAYS } : {}),
    page: pagina,
  });

  const meta = data?.meta ?? { incomingCount: 0, outgoingCount: 0, canceledCount: 0 };
  const filas = data?.rows ?? [];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-xl">{t("inventory.transfers.title")}</h1>

        {/* F5-EXP-03 — lo que salió y no llegó, en Excel.
            El archivo baja el DETALLE (cada partida con su origen, destino y
            folio) y no el agregado por producto de la ficha: quien lo baja
            está rastreando mercancía, no mirando un total. */}
        <Button
          variant="outline"
          size="sm"
          disabled={exportando}
          onClick={async () => {
            // Ver la nota de `expiring-list`: `try/finally` y no
            // `.finally()` encadenado, y el fallo SE DICE.
            setErrorExport(null);
            setExportando(true);
            try {
              await downloadInTransit();
            } catch {
              setErrorExport(t("reports.hub.downloadFailed"));
            } finally {
              setExportando(false);
            }
          }}
        >
          <Download className="size-4" aria-hidden="true" />
          {t("reports.table.export")}
        </Button>
      </header>

      {errorExport !== null && (
        <p role="alert" className="text-destructive text-sm">
          {errorExport}
        </p>
      )}

      <div role="tablist" className="flex gap-2">
        <TabBoton activo={tab === "incoming"} onClick={() => setTab("incoming")}>
          {t("inventory.transfers.incoming")} ({meta.incomingCount})
        </TabBoton>
        <TabBoton activo={tab === "outgoing"} onClick={() => setTab("outgoing")}>
          {t("inventory.transfers.outgoing")} ({meta.outgoingCount})
        </TabBoton>
        <TabBoton activo={enCancelados} onClick={() => setTab("canceled")}>
          {t("inventory.transfers.canceledTab")} ({meta.canceledCount})
        </TabBoton>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {enCancelados ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("inventory.list.searchFolio")}</span>
              <input
                type="search"
                value={folioInput}
                onChange={(event) => setFolioInput(event.target.value)}
                placeholder={t("inventory.list.searchFolio")}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="flex min-w-48 flex-col gap-1 text-sm">
              <label htmlFor="transfers-warehouse" className="text-muted-foreground">
                {t("inventory.warehouse.label")}
              </label>
              <WarehouseSelect
                id="transfers-warehouse"
                value={warehouseId}
                onChange={setWarehouseId}
                scoped={false}
              />
            </div>
            <DateRangeFilter id="transfers" from={rango.from} to={rango.to} onChange={setRango} />
          </>
        ) : (
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
        )}
        {/* «Más de 7 días» habla de días EN TRÁNSITO: en cancelados no aplica. */}
        {!enCancelados && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soloDemorados}
              onChange={(event) => setSoloDemorados(event.target.checked)}
            />
            {t("inventory.transfers.olderThanStale")}
          </label>
        )}
      </div>

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("inventory.transfers.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">{t("inventory.list.folio")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.transfers.origin")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.transfers.destination")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.transfers.sentBy")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.transfers.lines")}</th>
                {enCancelados ? (
                  <>
                    <th className="px-2 py-2 font-medium">{t("inventory.transfers.canceledOn")}</th>
                    <th className="px-2 py-2 font-medium">
                      {t("inventory.transfers.cancelMotive")}
                    </th>
                  </>
                ) : (
                  <th className="px-2 py-2 font-medium">{t("inventory.transfers.days")}</th>
                )}
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filas.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-2 py-2 font-mono">
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
                  <td className="px-2 py-2">{row.origin.name}</td>
                  <td className="px-2 py-2">{row.destination.name}</td>
                  <td className="px-2 py-2">{row.createdBy.name}</td>
                  <td className="px-2 py-2">{row.lineCount}</td>
                  {enCancelados ? (
                    <>
                      <td className="px-2 py-2">
                        {/* En la zona del NEGOCIO, la misma con la que el API corta el
                            rango Desde/Hasta (Carlos, 2026-09-02). */}
                        {row.canceledAt === null
                          ? "—"
                          : formatBusinessDate(row.canceledAt, localeTag, timeZone)}
                      </td>
                      {/* El motivo Y quién lo decidió: es la fila que alguien
                          abre preguntando «¿qué pasó con esa mercancía?». */}
                      <td className="max-w-72 px-2 py-2">
                        <span className="block">{row.cancelReason ?? "—"}</span>
                        {row.canceledBy !== null && (
                          <span className="text-muted-foreground text-xs">
                            {row.canceledBy.name}
                          </span>
                        )}
                      </td>
                    </>
                  ) : (
                    <td className="px-2 py-2">
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
                  )}
                  <td className="flex justify-end gap-2 py-2">
                    {/* Recepción ya empezada: el diálogo no tiene nada que
                        anunciar —el borrador existe— y repetir "Recibir" hace
                        parecer que el clic anterior se perdió. Se va derecho
                        al documento, con su folio a la vista. */}
                    {tab === "incoming" &&
                      has("inventory:movement") &&
                      (row.receipt === null ? (
                        <button
                          type="button"
                          onClick={() => setRecibiendo(row)}
                          className="rounded-md border border-input px-3 py-1.5 text-sm"
                        >
                          {t("inventory.transfers.receive")}
                        </button>
                      ) : (
                        <Link
                          to="/movements/documents/$documentId"
                          params={{ documentId: row.receipt.id }}
                          data-testid="continue-receipt"
                          className="rounded-md border border-input px-3 py-1.5 text-sm"
                        >
                          {t("inventory.transfers.continueReceipt", {
                            folio: row.receipt.folio,
                          })}
                        </Link>
                      ))}
                    {/* Sobre un cancelado no hay nada que volver a cancelar. */}
                    {!enCancelados && has("inventory:manage") && (
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
        </ScrollableTable>
      )}

      {recibiendo !== null && (
        <DialogoRecepcion row={recibiendo} onClose={() => setRecibiendo(null)} />
      )}
      {cancelando !== null && (
        <DialogoCancelar row={cancelando} onClose={() => setCancelando(null)} />
      )}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
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
