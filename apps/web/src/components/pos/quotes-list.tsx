import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { PrintTicketButton } from "@/components/pos/print-ticket-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paginator } from "@/components/ui/paginator";
import { RowAction } from "@/components/ui/row-action";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import type { QuoteRow } from "@/lib/pos/api";
import { useCancelQuote, useQuotes } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F4-QUOTE-03 — el listado de cotizaciones.
 *
 * La búsqueda por folio es **parcial y server-side**: el cliente llama y dicta
 * "cero cero uno", no el prefijo completo. Filtrar en el cliente solo acotaría
 * la página que ya llegó, que es justo la que no contiene lo que se busca.
 */
export function QuotesList() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  const [folio, setFolio] = useState("");
  const [estado, setEstado] = useState<"todas" | "open" | "loaded" | "canceled">("todas");
  /**
   * Sin rango al abrir, a diferencia del Kardex: acá se entra a buscar «la
   * cotización de la semana pasada», y un rango
   * por defecto escondería justo lo que se busca.
   */
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });

  const [pagina, setPagina] = useState(1);

  // Cualquier filtro vuelve a la página 1: quedarse en la 3 de un filtro que
  // ahora tiene una sola página muestra una tabla vacía que parece un bug.
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [folio, estado, rango.from, rango.to]);

  const { data, isPending, error } = useQuotes({
    ...(folio.trim() !== "" && { folio: folio.trim() }),
    ...(estado !== "todas" && { status: estado }),
    // Solo viajan si tienen valor: mandar `from: ""` haría que el API
    // rechace la consulta por formato.
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page: pagina,
  });

  return (
    <section className="flex flex-col gap-4" data-testid="quotes-list">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("pos.quote.listTitle")}</h1>
        <Button asChild>
          <Link to="/pos/quotes/new">{t("pos.quote.new")}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t("pos.quote.folio")}
          <input
            className="h-9 rounded-md border bg-background px-2"
            value={folio}
            placeholder="COT-000001"
            onChange={(e) => setFolio(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("pos.history.status")}
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={estado}
            onChange={(e) => setEstado(e.target.value as typeof estado)}
          >
            <option value="todas">{t("pos.history.all")}</option>
            <option value="open">{t("pos.quote.status.open")}</option>
            <option value="loaded">{t("pos.quote.status.loaded")}</option>
            <option value="canceled">{t("pos.quote.status.canceled")}</option>
          </select>
        </label>

        <DateRangeFilter id="quotes" from={rango.from} to={rango.to} onChange={setRango} />
      </div>

      {isPending && <p role="status">{t("common.form.loading")}</p>}
      {error !== null && error !== undefined && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}

      {data !== undefined &&
        (data.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("pos.quote.empty")}</p>
        ) : (
          <ScrollableTable>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                  <th className="p-2">{t("pos.quote.folio")}</th>
                  <th className="p-2">{t("pos.history.date")}</th>
                  <th className="p-2">{t("pos.quote.author")}</th>
                  <th className="p-2 text-right">{t("pos.quote.reference")}</th>
                  <th className="p-2">{t("pos.history.status")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((q) => (
                  <QuoteRowView
                    key={q.id}
                    cotizacion={q}
                    locale={locale}
                    currency={currency}
                    uiLocale={i18n.language}
                  />
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        ))}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </section>
  );
}

function QuoteRowView({
  cotizacion,
  locale,
  currency,
  uiLocale,
}: {
  cotizacion: QuoteRow;
  locale: "es" | "en";
  currency: Currency;
  uiLocale: string;
}) {
  const { t } = useTranslation();
  const cancelar = useCancelQuote();
  const [error, setError] = useState<string | null>(null);

  return (
    <tr
      className={`border-b ${TABLE_ROW_HOVER} ${cotizacion.status !== "open" ? "text-muted-foreground" : ""}`}
    >
      <td className="p-2 font-medium tabular-nums">{cotizacion.folio}</td>
      <td className="p-2 tabular-nums">
        {new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(cotizacion.createdAt),
        )}
      </td>
      <td className="p-2">{cotizacion.author.name}</td>
      <td className="p-2 text-right tabular-nums">
        {/* De REFERENCIA, no lo que se va a cobrar: al cargarla en el POS los
            precios se releen del catálogo vigente. */}
        {formatMoney(Number(cotizacion.total), currency, locale)}
      </td>
      <td className="p-2">
        {/* El semáforo de estados de todos los listados (Carlos, 2026-08-25):
            ámbar lo pendiente, verde lo asentado, rojo lo cancelado. */}
        <Badge
          variant={
            cotizacion.status === "open"
              ? "warning"
              : cotizacion.status === "loaded"
                ? "success"
                : "destructive"
          }
        >
          {t(`pos.quote.status.${cotizacion.status}`)}
        </Badge>
        {error !== null && (
          <span role="alert" className="block text-destructive text-xs">
            {error}
          </span>
        )}
      </td>
      <td className="p-2">
        {/* items-center: Reimprimir y Cancelar conviven en la celda y sin el
            flex quedaban a alturas distintas (captura de Carlos). */}
        <div className="flex items-center justify-end gap-1">
          {/* El cliente perdió el papel: se reimprime en cualquier estado. */}
          <PrintTicketButton
            kind="quote"
            id={cotizacion.id}
            folio={cotizacion.folio}
            label={t("pos.ticket.reprint")}
          />
          {/* Solo una `open` se cancela. Una `loaded` ya se convirtió en venta,
              y lo que hay que deshacer es esa venta, no el papel que la
              originó. */}
          {cotizacion.status === "open" ? (
            <RowAction
              intent="delete"
              disabled={cancelar.isPending}
              onClick={() => {
                setError(null);
                cancelar.mutate(
                  { id: cotizacion.id },
                  { onError: (e) => setError(e.message || t("pos.quote.cancelFailed")) },
                );
              }}
            >
              {t("pos.quote.cancel")}
            </RowAction>
          ) : (
            // Hueco del MISMO ancho que «Cancelar»: sin él, Reimprimir
            // zigzagueaba verticalmente entre filas con y sin la acción
            // (captura de Carlos, 2026-08-25).
            <span aria-hidden="true" className="invisible">
              <RowAction intent="delete" disabled tabIndex={-1}>
                {t("pos.quote.cancel")}
              </RowAction>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
