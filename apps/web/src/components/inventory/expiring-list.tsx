import { formatMoney, MONEY_DECIMALS, scaledInteger } from "@sellpoint/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROW_ACTIONS_CELL, RowActionsTh } from "@/components/ui/row-action";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { resolveUiLocale } from "@/lib/accept-language";
import { useScopedCurrency } from "@/lib/admin/scope";
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
import { useAuthStore } from "@/stores/auth.store";

/**
 * F10-KPI-10 — cuánto vale lo que vence, sumado para la pantalla y para el
 * recuadro del panel (que lo importa de aquí: los dos tienen que dar el MISMO
 * número).
 *
 * Devuelve `null` si el valor no viajó en ninguna fila: sin `reports:read`
 * el API no lo manda, y un API anterior tampoco. En ese caso no hay nada que
 * enseñar, ni siquiera un «—».
 *
 * La suma va en centavos ENTEROS (`scaledInteger`, el mismo de los totales
 * del punto de venta): con flotantes, 0.10 + 0.20 ya no da 0.30. Una fila
 * sin costo (`value: null`) NO suma —no es un cero, es un «no sé»— y cuenta
 * en `uncostedProducts` una vez por producto, aunque salga en varios lotes.
 * `totalCents` es `null` si ninguna fila tiene costo: un total de $0.00
 * fingiría que lo que vence no vale nada.
 */
export function summarizeExpiringValue(
  rows: readonly ExpiringRow[],
): { totalCents: number | null; uncostedProducts: number } | null {
  if (!rows.some((row) => row.value !== undefined)) {
    return null;
  }
  let totalCents: number | null = null;
  const sinCosto = new Set<string>();
  for (const row of rows) {
    if (row.value === null || row.value === undefined) {
      sinCosto.add(row.productId);
    } else {
      totalCents = (totalCents ?? 0) + scaledInteger(row.value, MONEY_DECIMALS);
    }
  }
  return { totalCents, uncostedProducts: sinCosto.size };
}

/** Los plazos que la pantalla ofrece. Días y no fechas: nadie calcula nada. */
const PLAZOS = [7, 30, 90] as const;

/**
 * Lo YA vencido es su propio filtro y va PRIMERO (Carlos, 2026-09-15): no es
 * un plazo más corto, es la otra pregunta — «¿qué tengo que sacar hoy del
 * estante?». Se dice «Vencido» y no «Expirado»: en español «expirar» es de
 * plazos y contratos, la norma sanitaria habla de caducidad, y la tabla ya
 * marca «Vencido» en su etiqueta. En inglés sí es «Expired».
 */
type Filtro = "expired" | (typeof PLAZOS)[number];

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
  // 30 días al entrar: el plazo con el que se planea la semana. Lo vencido se
  // pide a propósito, no se impone al abrir.
  const [filtro, setFiltro] = useState<Filtro>(30);
  const soloVencidos = filtro === "expired";
  const consulta = soloVencidos ? { days: 0, onlyExpired: true } : { days: filtro };
  const [exportando, setExportando] = useState(false);
  const [errorExport, setErrorExport] = useState<string | null>(null);
  const { data, isPending } = useExpiring(consulta);
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  // El locale de la CUENTA, como en los reportes.
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  // F10-KPI-10 — el dinero es de `reports:read`. El API ya no lo manda sin el
  // permiso; la pantalla tampoco lo enseña si llegara.
  const resumen = has("reports:read") ? summarizeExpiringValue(data ?? []) : null;
  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  // Dividir entre 100 solo para ESCRIBIR el total: la suma ya se hizo en enteros.
  const total =
    resumen?.totalCents == null ? null : formatMoney(resumen.totalCents / 100, currency, locale);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-xl">{t("inventory.expiring.title")}</h1>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFiltro("expired")}
            aria-pressed={soloVencidos}
            className={`rounded-md border border-input px-3 py-1.5 text-sm ${
              soloVencidos ? "bg-primary text-primary-foreground" : ""
            }`}
          >
            {t("inventory.expiring.expiredOnly")}
          </button>
          {PLAZOS.map((plazo) => (
            <button
              key={plazo}
              type="button"
              onClick={() => setFiltro(plazo)}
              aria-pressed={filtro === plazo}
              className={`rounded-md border border-input px-3 py-1.5 text-sm ${
                filtro === plazo ? "bg-primary text-primary-foreground" : ""
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
                await downloadExpiring(consulta);
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
        <p className="text-muted-foreground text-sm">
          {t(soloVencidos ? "inventory.expiring.emptyExpired" : "inventory.expiring.empty")}
        </p>
      ) : (
        <>
          {resumen !== null && total !== null && (
            <p className="text-sm">
              <span className="font-semibold tabular-nums">
                {soloVencidos
                  ? t("inventory.expiring.valueTotalExpired", { amount: total })
                  : t("inventory.expiring.valueTotal", { amount: total, days: filtro })}
              </span>
              {resumen.uncostedProducts > 0 && (
                <span className="text-muted-foreground">
                  {" · "}
                  {t("inventory.expiring.valueUncosted", { count: resumen.uncostedProducts })}
                </span>
              )}
            </p>
          )}
          <ScrollableTable>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                  <th className="px-2 py-2 font-medium">{t("inventory.expiring.product")}</th>
                  <th className="px-2 py-2 font-medium">{t("inventory.expiring.lot")}</th>
                  <th className="px-2 py-2 font-medium">{t("inventory.expiring.expiresAt")}</th>
                  <th className="px-2 py-2 font-medium">{t("inventory.expiring.warehouse")}</th>
                  <th className="px-2 py-2 font-medium">{t("inventory.expiring.quantity")}</th>
                  {resumen !== null && (
                    <th className="px-2 py-2 text-right font-medium">
                      {t("inventory.expiring.value")}
                    </th>
                  )}
                  <RowActionsTh className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((row) => (
                  <Fila
                    key={`${row.lot.id}-${row.warehouse.id}-${row.location}`}
                    row={row}
                    valor={
                      resumen === null ? undefined : row.value == null ? "—" : dinero(row.value)
                    }
                  />
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </>
      )}
    </section>
  );
}

/**
 * `valor` llega ya escrito: `undefined` es «esta pantalla no tiene columna de
 * valor» (sin `reports:read` o con un API anterior), y «—» es una fila sin
 * costo. Una fila sin costo no es un $0.00.
 */
function Fila({ row, valor }: { row: ExpiringRow; valor?: string }) {
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
      {valor !== undefined && <td className="px-2 py-2 text-right tabular-nums">{valor}</td>}
      <td className={`px-2 py-2 ${ROW_ACTIONS_CELL}`}>
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
        {/* El botón va en una línea; el error, en cambio, sí se parte: sin
            `whitespace-normal` estiraría la columna a lo ancho del mensaje. */}
        {error !== null && <p className="whitespace-normal text-destructive text-xs">{error}</p>}
      </td>
    </tr>
  );
}
