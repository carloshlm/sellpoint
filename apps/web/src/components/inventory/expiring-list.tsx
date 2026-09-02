import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { resolveUiLocale } from "@/lib/accept-language";
import { usePermissions } from "@/lib/auth/permissions";
import {
  addDocumentLine,
  createDocument,
  downloadExpiring,
  updateDocumentHeader,
} from "@/lib/inventory/api";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { useExpiring } from "@/lib/inventory/hooks";
import type { ExpiringRow } from "@/lib/inventory/types";

/** Los plazos que la pantalla ofrece. Días y no fechas: nadie calcula nada. */
const PLAZOS = [7, 30, 90] as const;

/**
 * F3-LOTS-03 — qué está por vencerse, y qué hacer al respecto.
 *
 * **Lo ya vencido no se esconde.** Aparece junto a lo que está por vencer y se
 * marca, porque sigue en el estante: esconderlo por "ya pasó" es justo el error
 * que esta pantalla viene a evitar.
 *
 * El botón de dar salida no abre un formulario vacío: crea el borrador con el
 * motivo, el producto y el lote ya puestos, y en el almacén DONDE ESTÁ el lote.
 * Quien llegó hasta acá ya sabe qué va a sacar — volver a pedírselo sería
 * pedirle el mismo dato dos veces.
 */
export function ExpiringList() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [exportando, setExportando] = useState(false);
  const [errorExport, setErrorExport] = useState<string | null>(null);
  const { data, isPending } = useExpiring({ days });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-xl">{t("inventory.expiring.title")}</h1>
        <div className="flex gap-1">
          {PLAZOS.map((plazo) => (
            <button
              key={plazo}
              type="button"
              onClick={() => setDays(plazo)}
              aria-pressed={days === plazo}
              className={`rounded-md border border-input px-3 py-1.5 text-sm ${
                days === plazo ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              {t(`inventory.expiring.days${plazo}`)}
            </button>
          ))}

          {/* El archivo baja lo MISMO que la pantalla muestra: el plazo
              elegido viaja con él. Exportar siempre los 30 días por defecto
              le daría a quien filtró a 7 un Excel con cosas que no pidió, sin
              forma de saber por qué. */}
          <Button
            variant="outline"
            size="sm"
            disabled={exportando}
            onClick={async () => {
              // `try/finally` y no `.finally()` encadenado: si la promesa
              // rechaza, un `void promesa.finally()` deja un rechazo SIN
              // MANEJAR —CI lo cazó como «unhandled error»— y, peor, la
              // persona se queda esperando un archivo que nunca va a llegar.
              setErrorExport(null);
              setExportando(true);
              try {
                await downloadExpiring({ days });
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
        </div>
      </header>

      {errorExport !== null && (
        <p role="alert" className="text-destructive text-sm">
          {errorExport}
        </p>
      )}

      {isPending ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : (data?.length ?? 0) === 0 ? (
        <p className="text-muted-foreground text-sm">{t("inventory.expiring.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="px-2 py-2 font-medium">{t("inventory.expiring.product")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.expiring.lot")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.expiring.expiresAt")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.expiring.warehouse")}</th>
                <th className="px-2 py-2 font-medium">{t("inventory.expiring.quantity")}</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <Fila key={`${row.lot.id}-${row.warehouse.id}-${row.location}`} row={row} />
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </section>
  );
}

function Fila({ row }: { row: ExpiringRow }) {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  /**
   * Tres pasos porque el borrador nace vacío: se crea, se le pone el motivo y
   * se le carga la línea. Si algo falla a mitad, el folio queda anulable desde
   * la pantalla del documento — no se pierde nada silenciosamente.
   */
  const darSalida = useMutation({
    mutationFn: async () => {
      const draft = await createDocument({ type: "exit", warehouseId: row.warehouse.id });
      await updateDocumentHeader(draft.id, {
        reasonCode: "expired",
        reasonNote: `${row.lot.lotCode} · ${formatCalendarDate(row.lot.expiresAt, resolveUiLocale(i18n))}`,
      });
      await addDocumentLine(draft.id, {
        productId: row.productId,
        lotCode: row.lot.lotCode,
        location: row.location === "" ? null : row.location,
        quantity: Number(row.quantity),
      });
      return draft.id;
    },
    onSuccess: (documentId) => {
      void navigate({ to: "/movements/documents/$documentId", params: { documentId } });
    },
    onError: () => setError(t("inventory.expiring.discardFailed")),
  });

  return (
    <tr
      className={`border-b last:border-0 ${TABLE_ROW_HOVER} ${row.expired ? "bg-destructive/5" : ""}`}
    >
      <td className="px-2 py-2">
        <span className="font-mono">{row.sku}</span>
        <span className="ml-2 text-muted-foreground">{row.name}</span>
      </td>
      <td className="px-2 py-2">
        {row.lot.lotCode}
        {row.location !== "" && (
          <span className="ml-2 text-muted-foreground text-xs">{row.location}</span>
        )}
      </td>
      <td className="px-2 py-2">
        {formatCalendarDate(row.lot.expiresAt, resolveUiLocale(i18n))}
        <span
          className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
            row.expired ? "bg-destructive/15 text-destructive" : "bg-muted"
          }`}
        >
          {row.expired
            ? t("inventory.expiring.expired")
            : t("inventory.expiring.daysLeft", { count: row.daysLeft })}
        </span>
      </td>
      <td className="px-2 py-2">{row.warehouse.name}</td>
      <td className="px-2 py-2">{row.quantity}</td>
      <td className="px-2 py-2 text-right">
        {has("inventory:movement") && (
          <button
            type="button"
            disabled={darSalida.isPending}
            onClick={() => darSalida.mutate()}
            className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t("inventory.expiring.discard")}
          </button>
        )}
        {error !== null && <p className="text-destructive text-xs">{error}</p>}
      </td>
    </tr>
  );
}
