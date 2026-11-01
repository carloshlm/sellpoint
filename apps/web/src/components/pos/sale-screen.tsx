import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CartPanel } from "@/components/pos/cart-panel";
import { CartSearch } from "@/components/pos/cart-search";
import { CheckoutPanel, type ClosedSale } from "@/components/pos/checkout-panel";
import { PrintTicketButton } from "@/components/pos/print-ticket-button";
import { SessionBar } from "@/components/pos/session-bar";
import { Button } from "@/components/ui/button";
import type { CashboxSession } from "@/lib/pos/api";
import { useCartStore, useClaimCart } from "@/stores/cart.store";

/**
 * F4-UI-01 — la pantalla de venta.
 *
 * ── Dos columnas, y cuál va a cada lado ─────────────────────────────────
 *
 * Esto se usa en una tablet, de pie, con una mano. A la IZQUIERDA lo que se
 * busca —el input, el escáner, los resultados—; a la DERECHA el carrito con su
 * total y el botón de cobrar. Es el orden en que ocurre la operación, y en una
 * pantalla ancha deja las dos cosas a la vista a la vez: el cajero no puede
 * perder el total de vista cada vez que agrega un artículo.
 *
 * En pantalla angosta se apilan en ese mismo orden. No hay pestañas: esconder
 * el carrito detrás de una pestaña es esconder el número que el cliente está
 * esperando oír.
 *
 * ── El cobro REEMPLAZA la búsqueda, no se superpone ─────────────────────
 *
 * Cuando el panel de cobro se abre, ocupa la columna izquierda y el carrito
 * sigue a la vista a la derecha. Un modal encima taparía justamente lo que hay
 * que verificar antes de cobrar. Y si el servidor rechaza una línea, el
 * renglón culpable ya está en pantalla — no hay que cerrar nada para verlo.
 */

interface SaleScreenProps {
  session: CashboxSession;
}

export function SaleScreen({ session }: SaleScreenProps) {
  const { t } = useTranslation();
  // El carrito guardado es de este turno: el de otro turno o de otra cuenta
  // se descarta al entrar (Carlos, 2026-11-01).
  useClaimCart(session.id);
  const lines = useCartStore((s) => s.lines);
  const [cobrando, setCobrando] = useState(false);
  const [ultima, setUltima] = useState<ClosedSale | null>(null);
  const enfaticas = ultima?.annotations.filter((a) => a.emphasis) ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="sale-screen">
      <SessionBar session={session} />

      {ultima !== null && (
        <div
          // VERDE y no el azul de información (Carlos, 2026-08-24): un cobro
          // exitoso es la confirmación que el cajero busca de reojo con el
          // cliente enfrente, y el verde se reconoce sin leer. Token
          // `--success`, no un color crudo: la barrera de theming lo exige.
          className="flex flex-wrap items-center gap-3 rounded-md bg-success-soft px-3 py-2 text-success"
          data-testid="sale-done"
        >
          <p role="status" className="font-medium text-sm">
            {t("pos.checkout.done", { folio: ultima.folio })}
          </p>
          {/* F9-RECEP-29 — lo que un módulo activo pidió decir EN GRANDE (ley
              31): el turno del paciente, para dictárselo sin esperar el papel.
              La caja no sabe qué es; traduce la clave que el módulo mandó. Las
              no enfáticas van solo en el ticket. Juntas en su propia fila: en
              un teléfono bajan las dos, no una arriba y otra abajo. */}
          {enfaticas.length > 0 && (
            <div className="flex flex-wrap gap-x-3">
              {enfaticas.map((a) => (
                <p
                  key={`${a.sourceModule}-${a.labelKey}-${a.value}`}
                  data-testid="sale-annotation"
                  className="font-bold text-2xl tabular-nums"
                >
                  {`${t(a.labelKey)} ${a.value}`}
                </p>
              ))}
            </div>
          )}
          {/* El ticket SALE SOLO acá, con la venta recién cerrada, porque es el
              momento en que el cliente lo está esperando (Carlos, 2026-09-02);
              el botón queda para repetirlo. `key` por venta: cada cobro es un
              papel nuevo. Y si falla, no se pierde nada: se reimprime del
              historial. */}
          <PrintTicketButton
            key={ultima.id}
            kind="sale"
            id={ultima.id}
            folio={ultima.folio}
            autoPrint
          />
        </div>
      )}

      {/* `grid-cols-1` y `min-w-0`: una columna de grid crece hasta lo que mide
          su contenido, y un renglón largo del buscador sacaba la venta entera
          de la pantalla del celular (Carlos, 2026-11-01). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {cobrando ? (
            <CheckoutPanel
              onDone={(venta) => {
                setUltima(venta);
                setCobrando(false);
              }}
              onCancel={() => setCobrando(false)}
            />
          ) : (
            <CartSearch />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <CartPanel />

          {!cobrando && (
            <Button
              // `data-skin="charge"`: el tema de la marca pinta «Cobrar» de
              // amarillo (F10-THEME-05). En los demás es un primario más.
              data-skin="charge"
              className="h-14 text-lg"
              // Sin líneas no hay nada que cobrar. Es lo único que bloquea el
              // botón acá: el resto de las condiciones —cuánto se recibió, qué
              // método— viven en el panel de cobro, que es donde se deciden.
              disabled={lines.length === 0}
              onClick={() => {
                setUltima(null);
                setCobrando(true);
              }}
            >
              {t("pos.checkout.charge")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
