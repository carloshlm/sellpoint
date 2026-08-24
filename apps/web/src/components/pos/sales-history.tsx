import { type Currency, formatMoney } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { PrintTicketButton } from "@/components/pos/print-ticket-button";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { usePermissions } from "@/lib/auth/permissions";
import type { SaleRow } from "@/lib/pos/api";
import { useCancelSale, useSales } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F4-UI-03 — el historial de ventas.
 *
 * ── Las anuladas se VEN, marcadas ───────────────────────────────────────
 *
 * Esconderlas por defecto sería tentador —«ruido»— y sería exactamente lo
 * contrario de lo que necesita quien busca una venta que no cuadra:
 * encontrarla justo cuando está anulada. El filtro por estado existe para
 * quien quiera acotar, no para tapar.
 *
 * ── Por qué esta pantalla no es opcional ────────────────────────────────
 *
 * El API sabía anular desde F4-SALE-03 y ninguna persona podía llegar a eso:
 * una venta cobrada mal solo se arreglaba con `curl`. Un permiso que existe y
 * no tiene puerta es un permiso que nadie puede ejercer.
 */
export function SalesHistory() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const { has } = usePermissions();

  const [estado, setEstado] = useState<"todas" | "completed" | "canceled">("todas");
  // El buscador del código de barras del ticket (2026-08-24): se escanea el
  // papel con la cámara o una pistola USB sobre este campo y aparece la venta
  // para reimprimir o anular. Parcial: también sirve dictado por teléfono.
  const [folio, setFolio] = useState("");
  const [pagina, setPagina] = useState(1);
  /**
   * Sin rango al abrir, a diferencia del Kardex: acá se entra a buscar «la
   * venta que no cuadra» o «la cotización de la semana pasada», y un rango
   * por defecto escondería justo lo que se busca.
   */
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });

  const { data, isPending, error } = useSales({
    ...(estado !== "todas" && { status: estado }),
    ...(folio.trim() !== "" && { folio: folio.trim() }),
    // Solo viajan si tienen valor: mandar `from: ""` haría que el API
    // rechace la consulta por formato.
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page: pagina,
    pageSize: 20,
  });

  const puedeAnular = has("pos:cancel");

  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / (data?.pageSize ?? 20)));

  return (
    <section className="flex flex-col gap-4" data-testid="sales-history">
      <h1 className="font-semibold text-xl">{t("pos.history.title")}</h1>

      {/* `items-end` y etiqueta ENCIMA: el filtro de fechas trae su etiqueta
          arriba, así que un «Estado» con la etiqueta al costado dejaba los
          controles a distinto nivel (Carlos, 2026-08-24). Un solo molde. */}
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="sales-folio" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("pos.history.folio")}</span>
          <input
            id="sales-folio"
            type="search"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={folio}
            placeholder="VTA-000001"
            onChange={(e) => {
              setFolio(e.target.value);
              setPagina(1);
            }}
          />
        </label>

        <label htmlFor="sales-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("pos.history.status")}</span>
          <select
            id="sales-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value as typeof estado);
              // Volver a la página 1: quedarse en la 3 de un filtro que ahora
              // tiene una sola página muestra una tabla vacía que parece un bug.
              setPagina(1);
            }}
          >
            <option value="todas">{t("pos.history.all")}</option>
            <option value="completed">{t("pos.history.completed")}</option>
            <option value="canceled">{t("pos.history.canceled")}</option>
          </select>
        </label>

        <DateRangeFilter
          id="sales"
          from={rango.from}
          to={rango.to}
          onChange={(nuevo) => {
            setRango(nuevo);
            // Volver a la página 1: quedarse en la 3 de un filtro que ahora
            // tiene una sola página muestra una tabla vacía que parece un bug.
            setPagina(1);
          }}
        />
      </div>

      {/* El cargando y el error van ACÁ y no en un `return` temprano: cambiar
          un filtro estrena una consulta sin caché, así que el early return
          reemplazaba la pantalla ENTERA —incluida la barra de filtros que el
          usuario estaba tocando— por «Cargando…». Lo destapó el test del
          rango de fechas, que no encontraba el campo «Hasta» tras cambiar el
          «Desde». */}
      {isPending ? (
        <p role="status">{t("common.form.loading")}</p>
      ) : error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : data?.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("pos.history.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">{t("pos.history.folio")}</th>
                <th className="p-2">{t("pos.history.date")}</th>
                <th className="p-2">{t("pos.history.seller")}</th>
                <th className="p-2">{t("pos.history.method")}</th>
                <th className="p-2 text-right">{t("pos.history.total")}</th>
                <th className="p-2">{t("pos.history.state")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((venta) => (
                <SaleRowView
                  key={venta.id}
                  venta={venta}
                  locale={locale}
                  currency={currency}
                  uiLocale={i18n.language}
                  puedeAnular={puedeAnular}
                />
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {paginas > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            {t("pos.history.previous")}
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("pos.history.page", { page: pagina, pages: paginas })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            {t("pos.history.next")}
          </Button>
        </div>
      )}
    </section>
  );
}

function SaleRowView({
  venta,
  locale,
  currency,
  uiLocale,
  puedeAnular,
}: {
  venta: SaleRow;
  locale: "es" | "en";
  currency: Currency;
  uiLocale: string;
  puedeAnular: boolean;
}) {
  const { t } = useTranslation();
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const anular = useCancelSale();

  const anulada = venta.status === "canceled";

  return (
    <>
      <tr className={`border-b ${anulada ? "text-muted-foreground" : ""}`}>
        <td className="p-2 font-medium tabular-nums">{venta.folio}</td>
        <td className="p-2 tabular-nums">
          {/* `createdAt` es un INSTANTE, no una fecha de calendario: se muestra
              en la hora local de quien mira. La distinción está documentada en
              `format-date.ts` y acá aplica el otro lado de la regla. */}
          {new Intl.DateTimeFormat(uiLocale, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(venta.createdAt))}
        </td>
        <td className="p-2">{venta.seller.name}</td>
        <td className="p-2">{t(`pos.payment.${venta.paymentMethod}`)}</td>
        <td className="p-2 text-right tabular-nums">
          {formatMoney(Number(venta.total), currency, locale)}
        </td>
        <td className="p-2">
          {anulada ? (
            <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive text-xs">
              {t("pos.history.canceled")}
            </span>
          ) : (
            <span className="text-xs">{t("pos.history.completed")}</span>
          )}
        </td>
        <td className="p-2 text-right">
          {/* Reimprimir es LEER: se ofrece aunque la venta esté anulada, porque
              quien reclama trae en la mano el ticket de la que se anuló. */}
          <PrintTicketButton
            kind="sale"
            id={venta.id}
            folio={venta.folio}
            label={t("pos.ticket.reprint")}
          />
          {/* Anular una venta ya anulada no existe: el API contesta 409 y el
              botón mentiría. Y sin `pos:cancel` no se pinta — deshacer una
              operación asentada es decisión de gestión, no de mostrador. */}
          {!anulada && puedeAnular && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setMotivo("");
                setAnulando(true);
              }}
            >
              {t("pos.history.cancel")}
            </Button>
          )}
        </td>
      </tr>

      {anulando && (
        <tr>
          <td colSpan={7} className="p-2">
            <ConfirmDialog
              data-testid={`cancel-${venta.folio}`}
              title={t("pos.history.cancelTitle", { folio: venta.folio })}
              body={t("pos.history.cancelBody", { folio: venta.folio })}
              confirmLabel={t("pos.history.cancel")}
              cancelLabel={t("common.form.cancel")}
              busy={anular.isPending}
              // El motivo es obligatorio en el API (mínimo 3). Decirlo ANTES
              // del clic es mejor que dejar chocar con el 422.
              confirmDisabled={motivo.trim().length < 3}
              {...(error !== null && { error })}
              onCancel={() => setAnulando(false)}
              onConfirm={() => {
                setError(null);
                anular.mutate(
                  { id: venta.id, reason: motivo.trim() },
                  {
                    onSuccess: () => setAnulando(false),
                    onError: (e) => setError(e.message || t("pos.history.cancelFailed")),
                  },
                );
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                {t("pos.history.reason")}
                <input
                  className="h-9 rounded-md border bg-background px-2"
                  value={motivo}
                  placeholder={t("pos.history.reasonPlaceholder")}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
            </ConfirmDialog>
          </td>
        </tr>
      )}
    </>
  );
}
