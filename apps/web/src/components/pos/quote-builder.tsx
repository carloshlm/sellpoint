import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WarehouseSelect } from "@/components/inventory/warehouse-select";
import { CartPanel } from "@/components/pos/cart-panel";
import { CartSearch } from "@/components/pos/cart-search";
import { Button } from "@/components/ui/button";
import { useCreateQuote } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";
import { aLineasDeVenta, useCartStore } from "@/stores/cart.store";

/**
 * F4-QUOTE-03 — armar una cotización.
 *
 * ── La MISMA maquinaria del carrito, sin cobro ──────────────────────────
 *
 * Buscar, cantidades, presentaciones: todo se reusa tal cual. Lo único que
 * cambia es el botón del final — «Generar cotización» en vez de «Cobrar». Que
 * sea el mismo carrito no es ahorro de código: es lo que hace que volcar una
 * cotización a una venta después (F4-QUOTE-04) sea un mapeo directo y no una
 * traducción entre dos estructuras que se parecen.
 *
 * ── Y por qué hay un selector de almacén acá ────────────────────────────
 *
 * La venta hereda el almacén del TURNO y no pregunta nada. Cotizar **no exige
 * caja**, así que no hay turno del cual heredar: el almacén sale del asignado
 * del cotizador, o se elige dentro de su alcance. Ese mismo almacén es contra
 * el que el buscador resuelve precios y disponibilidad — por eso se elige
 * ARRIBA, antes de buscar, y no al final junto al botón.
 */
export function QuoteBuilder({
  onDone,
}: {
  /** La cotización creada. El `id` hace falta para imprimir su papel. */
  onDone: (cotizacion: { id: string; folio: string }) => void;
}) {
  const { t } = useTranslation();
  const asignado = useAuthStore((s) => s.user?.defaultWarehouseId ?? null);
  const [warehouseId, setWarehouseId] = useState<string | null>(asignado);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lines = useCartStore((s) => s.lines);
  const clear = useCartStore((s) => s.clear);
  const generar = useCreateQuote();

  return (
    <section className="flex flex-col gap-4" data-testid="quote-builder">
      <div className="flex flex-col gap-1">
        <label htmlFor="quote-warehouse" className="font-medium text-sm">
          {t("pos.quote.warehouse")}
        </label>
        <WarehouseSelect
          id="quote-warehouse"
          value={warehouseId}
          onChange={setWarehouseId}
          scoped
        />
        <p className="text-muted-foreground text-xs">{t("pos.quote.warehouseHint")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* El buscador resuelve contra ESTE almacén: sin turno, el
              `warehouseId` explícito es la única forma de decir "desde acá". */}
          <CartSearch warehouseId={warehouseId} />
        </div>

        <div className="flex flex-col gap-4">
          <CartPanel />

          <label className="flex flex-col gap-1 text-sm">
            {t("pos.quote.note")}
            <input
              className="h-10 rounded-md border bg-background px-2"
              value={nota}
              placeholder={t("pos.quote.notePlaceholder")}
              onChange={(e) => setNota(e.target.value)}
            />
          </label>

          {error !== null && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {error}
            </p>
          )}

          <Button
            className="h-14 text-lg"
            disabled={generar.isPending || lines.length === 0 || warehouseId === null}
            onClick={() => {
              setError(null);
              generar.mutate(
                {
                  ...(warehouseId !== null && { warehouseId }),
                  lines: aLineasDeVenta(lines),
                  ...(nota.trim() !== "" && { note: nota.trim() }),
                },
                {
                  onSuccess: (cotizacion) => {
                    // El carrito se vacía igual que tras cobrar: un carrito que
                    // sobrevive a la cotización terminaría cobrado por segunda
                    // vez desde la pantalla de venta, ya sin vínculo al folio.
                    clear();
                    onDone({ id: cotizacion.id, folio: cotizacion.folio });
                  },
                  // El error del server NUNCA se traga — lección del confirm
                  // mudo de F3.
                  onError: (e) => setError(e.message || t("pos.quote.failed")),
                },
              );
            }}
          >
            {generar.isPending ? t("common.form.submitting") : t("pos.quote.generate")}
          </Button>
        </div>
      </div>
    </section>
  );
}
