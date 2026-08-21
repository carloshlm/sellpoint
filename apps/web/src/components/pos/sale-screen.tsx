import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CartPanel } from "@/components/pos/cart-panel";
import { CartSearch } from "@/components/pos/cart-search";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { SessionBar } from "@/components/pos/session-bar";
import { Button } from "@/components/ui/button";
import type { CashboxSession } from "@/lib/pos/api";
import { useCartStore } from "@/stores/cart.store";

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
  const lines = useCartStore((s) => s.lines);
  const [cobrando, setCobrando] = useState(false);
  const [ultimoFolio, setUltimoFolio] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4" data-testid="sale-screen">
      <SessionBar session={session} />

      {ultimoFolio !== null && (
        <p
          role="status"
          className="rounded-md bg-primary/10 px-3 py-2 font-medium text-sm"
          data-testid="sale-done"
        >
          {t("pos.checkout.done", { folio: ultimoFolio })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {cobrando ? (
            <CheckoutPanel
              onDone={(folio) => {
                setUltimoFolio(folio);
                setCobrando(false);
              }}
              onCancel={() => setCobrando(false)}
            />
          ) : (
            <CartSearch />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <CartPanel />

          {!cobrando && (
            <Button
              className="h-14 text-lg"
              // Sin líneas no hay nada que cobrar. Es lo único que bloquea el
              // botón acá: el resto de las condiciones —cuánto se recibió, qué
              // método— viven en el panel de cobro, que es donde se deciden.
              disabled={lines.length === 0}
              onClick={() => {
                setUltimoFolio(null);
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
