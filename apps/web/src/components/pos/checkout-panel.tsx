import {
  type Currency,
  formatMoney,
  multiplyMoney,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@sellpoint/shared";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useCreateSale } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";
import { aLineasDeVenta, subtotalDelCarrito, useCartStore } from "@/stores/cart.store";

/**
 * F4-UI-02 — el cobro.
 *
 * ── La clave de idempotencia nace al ABRIR, no al hacer clic ────────────
 *
 * Es la decisión entera de este componente. `Idempotency-Key` se genera una vez
 * cuando el panel se monta y se conserva para todos los intentos de ESA venta.
 * Generarla en el clic sería lo natural de escribir y no serviría para nada:
 * cada toque traería una clave distinta y el servidor cobraría dos veces, que
 * es exactamente lo que la cabecera vino a evitar.
 *
 * Con la clave estable, un doble tap devuelve la MISMA venta (200) y el cliente
 * paga una sola vez. La protección la garantiza un UNIQUE parcial en la base,
 * no este archivo — acá solo se le da a esa garantía la clave que necesita.
 *
 * ── El error del server NUNCA se traga ──────────────────────────────────
 *
 * Lección del confirm mudo de F3. Un rechazo por stock trae el `sku` culpable
 * en el cuerpo, así que se pinta SOBRE su renglón: en un carrito de ocho
 * líneas, «no hay suficiente existencia» sin decir cuál obliga al cajero a
 * revisarlas una por una con el cliente enfrente.
 */

interface CheckoutPanelProps {
  onDone: (folio: string) => void;
  onCancel: () => void;
}

export function CheckoutPanel({ onDone, onCancel }: CheckoutPanelProps) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  const lines = useCartStore((s) => s.lines);
  const quoteId = useCartStore((s) => s.quoteId);
  const clear = useCartStore((s) => s.clear);
  const marcarCulpable = useCartStore((s) => s.setErrorSku);

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [recibido, setRecibido] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cobrar = useCreateSale();

  /**
   * Una sola vez por montaje del panel. `useMemo` con dependencias vacías y no
   * `useState(() => …)` da lo mismo acá; lo que importa es que NO se recalcule
   * en cada render ni en cada clic.
   */
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const total = subtotalDelCarrito(lines);
  // El cambio se calcula con la misma aritmética entera que los totales: un
  // vuelto con `0.30000000000000004` es dinero que alguien tiene que contar.
  const recibidoNum = multiplyMoney("1.00", recibido.replace(/[^\d.]/g, ""));
  const vuelto = recibidoNum - total;

  // El efectivo es el único método que exige cubrir el total: tarjeta y
  // transferencia se autorizan por su monto exacto fuera del sistema.
  const faltaEfectivo = method === "cash" && recibidoNum + 0.0001 < total;

  const ejecutar = () => {
    setError(null);
    marcarCulpable(null);
    cobrar.mutate(
      {
        input: {
          paymentMethod: method,
          lines: aLineasDeVenta(lines),
          ...(quoteId !== null && { quoteId }),
        },
        idempotencyKey,
      },
      {
        onSuccess: (venta) => {
          clear();
          onDone(venta.folio);
        },
        onError: (e: ApiError) => {
          setError(e.message || t("pos.checkout.failed"));
          // El renglón culpable. El server lo manda como DATO (`sku`) junto al
          // mensaje traducido, así que el carrito puede señalarlo sin parsear
          // texto — ver `stock-ledger.service.ts`.
          marcarCulpable((e as ApiError & { sku?: string }).sku ?? null);
        },
      },
    );
  };

  return (
    <section
      role="dialog"
      aria-label={t("pos.checkout.title")}
      data-testid="checkout-panel"
      className="flex flex-col gap-4 rounded-md border border-border bg-muted/40 p-4"
    >
      <h2 className="font-semibold text-lg">{t("pos.checkout.title")}</h2>

      <p className="flex justify-between font-semibold text-xl">
        <span>{t("pos.checkout.total")}</span>
        <span className="tabular-nums" data-testid="checkout-total">
          {formatMoney(total, currency, locale)}
        </span>
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-sm">{t("pos.checkout.method")}</legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <Button
              key={m}
              type="button"
              variant={m === method ? "default" : "outline"}
              aria-pressed={m === method}
              className="h-12 flex-1"
              onClick={() => {
                setMethod(m);
                setError(null);
              }}
            >
              {t(`pos.payment.${m}`)}
            </Button>
          ))}
        </div>
      </fieldset>

      {method === "cash" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="checkout-received" className="font-medium text-sm">
            {t("pos.checkout.received")}
          </label>
          <input
            id="checkout-received"
            inputMode="decimal"
            className="h-12 rounded-md border bg-background px-3 text-right text-xl tabular-nums"
            value={recibido}
            onChange={(e) => setRecibido(e.target.value)}
          />
          <p className="flex justify-between text-lg">
            <span>{t("pos.checkout.change")}</span>
            <span className="tabular-nums" data-testid="checkout-change">
              {/* Un vuelto negativo no se muestra como deuda: mientras no
                  alcance, lo que hay que ver es cuánto falta. */}
              {formatMoney(Math.max(0, vuelto), currency, locale)}
            </span>
          </p>
          {faltaEfectivo && (
            <p className="text-muted-foreground text-sm" data-testid="checkout-missing">
              {t("pos.checkout.missing", {
                amount: formatMoney(total - recibidoNum, currency, locale),
              })}
            </p>
          )}
        </div>
      )}

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          className="h-12 flex-1"
          // `isPending` bloquea el segundo clic. Es la primera red, no la
          // única: la que de verdad impide el doble cobro es la clave de
          // idempotencia, porque un botón deshabilitado no sobrevive a un
          // recargar-y-reintentar.
          disabled={cobrar.isPending || lines.length === 0 || faltaEfectivo}
          onClick={ejecutar}
        >
          {cobrar.isPending ? t("common.form.submitting") : t("pos.checkout.charge")}
        </Button>
        <Button type="button" variant="outline" className="h-12" onClick={onCancel}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </section>
  );
}
