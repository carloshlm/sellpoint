import { type Currency, formatMoney, formatQuantity } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useQuoteForSale } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";
import { useCartStore } from "@/stores/cart.store";

/**
 * F4-QUOTE-04 — cargar una cotización en la venta.
 *
 * ── Por qué hay una confirmación y no un volcado directo ────────────────
 *
 * Es el único punto del POS donde lo que el cliente TIENE EN LA MANO y lo que
 * el sistema va a cobrar pueden no coincidir. Dos cosas cambian entre cotizar
 * y cobrar:
 *
 *  · **los precios**, que se releen del catálogo vigente porque la cotización
 *    no los congela (decisión de Carlos);
 *  · **la disponibilidad**, que se resuelve contra el almacén del TURNO — se
 *    cotiza en la sucursal y se cobra en la central.
 *
 * Volcarlo al carrito sin mostrar nada haría que el cajero descubriera las dos
 * cosas en el total, con el cliente enfrente y el papel viejo en la mano. Acá
 * se ven ANTES, línea por línea, y quien atiende puede explicarlas.
 */
export function QuoteLoadPanel({ folio, onClose }: { folio: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const agregar = useCartStore((s) => s.add);
  const setQuoteId = useCartStore((s) => s.setQuoteId);

  const { data, isPending, error } = useQuoteForSale(folio);

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }
  if (error !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
        {/* Un folio ya cargado o cancelado NO es un "no existe": quien tiene el
            papel en la mano necesita saber cuál de las dos cosas pasó. */}
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
        <Button variant="outline" size="sm" onClick={onClose}>
          {t("common.form.cancel")}
        </Button>
      </div>
    );
  }

  const cargables = data.lines.filter((l) => !l.unavailable && l.item !== null);

  return (
    <section
      role="dialog"
      aria-label={t("pos.quote.loadTitle", { folio: data.folio })}
      data-testid="quote-load-panel"
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
    >
      <h2 className="font-semibold">{t("pos.quote.loadTitle", { folio: data.folio })}</h2>

      <ul className="flex flex-col gap-2">
        {data.lines.map((linea) => {
          const cambio = linea.unitPrice !== null && linea.unitPrice !== linea.quotedUnitPrice;
          return (
            <li
              key={linea.lineNo}
              className={`flex flex-col rounded-md border p-2 text-sm ${
                linea.unavailable ? "border-destructive bg-destructive/5" : ""
              }`}
              data-testid={`quote-line-${linea.lineNo}`}
            >
              <span className="font-medium">{linea.description}</span>
              <span className="text-muted-foreground text-xs">
                {formatQuantity(linea.quantity, "unit")} ×{" "}
                {linea.unitPrice === null
                  ? "—"
                  : formatMoney(Number(linea.unitPrice), currency, locale)}
                {cambio && (
                  // El precio del PAPEL se muestra tachado, no se esconde: es
                  // lo que deja explicar la diferencia en vez de discutirla.
                  <>
                    {" "}
                    <span className="line-through" data-testid={`quote-old-${linea.lineNo}`}>
                      {formatMoney(Number(linea.quotedUnitPrice), currency, locale)}
                    </span>{" "}
                    <span className="text-primary">{t("pos.quote.priceChanged")}</span>
                  </>
                )}
              </span>

              {linea.unavailable && (
                <span role="alert" className="text-destructive text-xs">
                  {t("pos.quote.unavailable")}
                </span>
              )}
              {linea.shortfall !== null && !linea.unavailable && (
                <span role="alert" className="text-destructive text-xs">
                  {t("pos.quote.shortfall", { quantity: linea.shortfall })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          // Sin una sola línea cargable no hay nada que volcar. Es el caso de
          // una cotización vieja cuyo catálogo entero cambió.
          disabled={cargables.length === 0}
          onClick={() => {
            for (const linea of cargables) {
              if (linea.item === null) {
                continue;
              }
              agregar(linea.item, {
                ...(linea.presentationId !== null && { presentationId: linea.presentationId }),
                quantity: linea.quantity,
              });
            }
            // El vínculo con el folio viaja al cobro: es lo que marca la
            // cotización como `loaded` y deja rastro de dónde salió la venta.
            setQuoteId(data.id);
            onClose();
          }}
        >
          {t("pos.quote.load")}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </section>
  );
}
