import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PrintTicketButton } from "@/components/pos/print-ticket-button";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
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

  const { data, isPending, error } = useQuotes({
    ...(folio.trim() !== "" && { folio: folio.trim() }),
    ...(estado !== "todas" && { status: estado }),
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
                <tr className="border-b text-left">
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
    <tr className={`border-b ${cotizacion.status !== "open" ? "text-muted-foreground" : ""}`}>
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
        <span className="text-xs">{t(`pos.quote.status.${cotizacion.status}`)}</span>
        {error !== null && (
          <span role="alert" className="block text-destructive text-xs">
            {error}
          </span>
        )}
      </td>
      <td className="p-2 text-right">
        {/* El cliente perdió el papel: se reimprime en cualquier estado. */}
        <PrintTicketButton
          kind="quote"
          id={cotizacion.id}
          folio={cotizacion.folio}
          label={t("pos.ticket.reprint")}
        />
        {/* Solo una `open` se cancela. Una `loaded` ya se convirtió en venta, y
            lo que hay que deshacer es esa venta, no el papel que la originó. */}
        {cotizacion.status === "open" && (
          <Button
            variant="ghost"
            size="sm"
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
          </Button>
        )}
      </td>
    </tr>
  );
}
