import { type Currency, formatMoney, formatQuantity, unitName } from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import { Button } from "@/components/ui/button";
import type { LookupItem } from "@/lib/pos/api";
import { useLookup } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";
import { useCartStore } from "@/stores/cart.store";

/**
 * F4-CART-01/04 — el input principal del carrito.
 *
 * **Uno solo para todo**: código de barras, SKU, media palabra, servicio o
 * folio `COT-`. Quién reconoce cada cosa lo decide el server
 * (`lookup.strategies`), no esta pantalla — así que agregar una forma de buscar
 * no toca este archivo.
 *
 * Un acierto EXACTO va derecho al carrito sin abrir una lista de un solo
 * renglón: es lo que hace que escanear se sienta instantáneo. Lo difuso se
 * muestra para que una persona elija.
 */
export function CartSearch() {
  const { t } = useTranslation();
  const [texto, setTexto] = useState("");
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const agregar = useCartStore((s) => s.add);

  const { data, isFetching } = useLookup(texto, true);

  const agregarYLimpiar = (item: LookupItem) => {
    agregar(item);
    // El input se vacía para el siguiente artículo: en un mostrador nadie
    // borra a mano entre uno y otro.
    setTexto("");
  };

  // Un acierto EXACTO no necesita que nadie elija: entra solo. Va en un
  // efecto y no en el cuerpo del render porque agrega al store — mutar
  // durante el render es lo que hace que React repinte en bucle.
  //
  // La cotización queda AFUERA: no es una línea, es un carrito entero que se
  // vuelca con confirmación (F4-QUOTE-04). Meterla sola sería volcar precios
  // viejos sin que nadie los vea.
  const aciertoExacto =
    data?.exact === true && data.items.length === 1 && data.items[0]?.type !== "quote"
      ? (data.items[0] ?? null)
      : null;

  useEffect(() => {
    if (aciertoExacto === null) {
      return;
    }
    agregar(aciertoExacto);
    // El input se vacía para el siguiente artículo: en un mostrador nadie borra
    // a mano entre uno y otro.
    setTexto("");
  }, [aciertoExacto, agregar]);

  return (
    <section className="flex flex-col gap-3" data-testid="cart-search">
      <input
        className="h-12 w-full rounded-md border bg-background px-3 text-lg"
        value={texto}
        placeholder={t("pos.cart.searchPlaceholder")}
        aria-label={t("pos.cart.search")}
        onChange={(e) => setTexto(e.target.value)}
      />

      {/* El escáner produce texto y lo mete por el MISMO input. */}
      <BarcodeScanner onScan={setTexto} />

      {isFetching && <p role="status">{t("common.form.loading")}</p>}

      {data !== undefined && data.items.length === 0 && texto.trim() !== "" && !isFetching && (
        <p className="text-muted-foreground text-sm">{t("pos.cart.noResults")}</p>
      )}

      <ul className="flex flex-col gap-1">
        {(data?.items ?? []).map((item) => (
          <li key={`${item.type}:${item.id}`}>
            <Button
              variant="outline"
              className="h-auto w-full justify-between py-2 text-left"
              onClick={() => agregarYLimpiar(item)}
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {item.type === "quote" ? item.folio : item.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {item.type === "product" && (
                    <>
                      {item.sku} ·{" "}
                      {t("pos.cart.available", {
                        quantity: formatQuantity(item.available, item.baseUnit),
                        unit: unitName(item.baseUnit, locale),
                      })}
                      {Number(item.expired) > 0 && (
                        // El dato de vencido evita que "no hay" mienta frente a
                        // un anaquel con mercancía a la vista.
                        <>
                          {" · "}
                          {t("pos.cart.expiredAside", {
                            quantity: formatQuantity(item.expired, item.baseUnit),
                          })}
                        </>
                      )}
                    </>
                  )}
                  {item.type === "service" && item.code}
                  {item.type === "quote" && t(`pos.quote.status.${item.status}`)}
                </span>
              </span>
              <span className="tabular-nums">
                {item.type === "product" &&
                  formatMoney(
                    Number(item.presentations.find((p) => p.isDefaultSale)?.price ?? 0),
                    currency,
                    locale,
                  )}
                {item.type === "service" && formatMoney(Number(item.price ?? 0), currency, locale)}
                {item.type === "quote" && formatMoney(Number(item.total), currency, locale)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
