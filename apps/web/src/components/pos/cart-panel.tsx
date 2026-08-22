import { type Currency, formatMoney, formatQuantityWithUnit } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Numpad } from "@/components/pos/numpad";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth.store";
import {
  type CartLine,
  excedeElStock,
  precioDeLinea,
  subtotalDelCarrito,
  totalDeLinea,
  useCartStore,
} from "@/stores/cart.store";

/**
 * F4-CART-02/03 — el carrito en pantalla.
 *
 * Cada renglón trae **su selector de presentación inline**: cambiar de "Pieza"
 * a "Caja ×12" es una operación de mostrador, no un motivo para borrar la línea
 * y volver a buscar el producto.
 *
 * El numpad aparece sobre la línea SELECCIONADA y obedece a la presentación de
 * esa línea: en una entera, el punto no existe.
 */
export function CartPanel() {
  const { t } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="cart-empty">
        {t("pos.cart.empty")}
      </p>
    );
  }

  const activa = lines.find((l) => l.key === seleccionada) ?? null;

  return (
    <section className="flex flex-col gap-3" data-testid="cart-panel">
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <CartLineRow
            key={line.key}
            line={line}
            selected={line.key === seleccionada}
            onSelect={() => {
              setAviso(null);
              setSeleccionada(line.key);
            }}
          />
        ))}
      </ul>

      <Totals lines={lines} />

      {activa !== null && (
        <Numpad
          value={activa.quantity}
          allowFractional={admiteDecimales(activa)}
          hint={aviso}
          onHint={setAviso}
          onChange={(v) => useCartStore.getState().setQuantity(activa.key, v)}
        />
      )}
    </section>
  );
}

/**
 * ¿La línea admite decimales?
 *
 * Lo decide la PRESENTACIÓN, no el producto: un producto que se vende a granel
 * puede tener también una presentación "Bolsa ×1" que solo se lleva entera. El
 * server ya derivó `allowFractionalInput` de la categoría de la unidad; acá
 * solo se lee.
 *
 * Un servicio admite decimales: media hora de consulta es media hora.
 */
function admiteDecimales(line: CartLine): boolean {
  if (line.type === "service") {
    return true;
  }
  return (
    line.presentations.find((p) => p.id === line.presentationId)?.allowFractionalInput ?? false
  );
}

function CartLineRow({
  line,
  selected,
  onSelect,
}: {
  line: CartLine;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const setPresentation = useCartStore((s) => s.setPresentation);
  const remove = useCartStore((s) => s.remove);
  const errorSku = useCartStore((s) => s.errorSku);

  const falta = excedeElStock(line);
  // El rechazo del servidor cae SOBRE su renglón (F4-UI-02). En un carrito de
  // ocho líneas, un «no hay suficiente existencia» que no señala cuál obliga a
  // revisarlas una por una con el cliente enfrente.
  const rechazada =
    errorSku !== null && errorSku === (line.type === "product" ? line.sku : line.code);

  return (
    <li
      className={`flex flex-col gap-1 rounded-md border p-2 ${
        rechazada ? "border-destructive bg-destructive/5" : selected ? "border-primary" : ""
      }`}
      data-testid={`cart-line-${line.key}`}
      {...(rechazada && { "data-rejected": "true" })}
    >
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex-1 text-left" onClick={onSelect}>
          <span className="font-medium">{line.name}</span>
          <span className="block text-muted-foreground text-xs">
            {line.type === "product" ? line.sku : line.code}
            {" · "}
            {formatMoney(Number(precioDeLinea(line) ?? 0), currency, locale)}
          </span>
        </button>

        <span className="tabular-nums" data-testid={`cart-qty-${line.key}`}>
          {/* La cantidad se pinta según la unidad: piezas sin decimales, kilos
              con tres. La regla vive en la unidad, no en esta pantalla. */}
          {line.type === "product"
            ? formatQuantityWithUnit(line.quantity, line.baseUnit, locale)
            : line.quantity}
        </span>

        <span className="w-24 text-right tabular-nums">
          {formatMoney(totalDeLinea(line), currency, locale)}
        </span>

        <Button variant="ghost" aria-label={t("pos.cart.remove")} onClick={() => remove(line.key)}>
          ×
        </Button>
      </div>

      {line.type === "product" && line.presentations.length > 1 && (
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          aria-label={t("pos.cart.presentation")}
          value={line.presentationId}
          onChange={(e) => setPresentation(line.key, e.target.value)}
        >
          {line.presentations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {rechazada && (
        <p role="alert" className="font-medium text-destructive text-xs">
          {t("pos.cart.rejectedLine")}
        </p>
      )}

      {falta && !rechazada && (
        // Se MARCA, no se bloquea: quien decide es el API al cobrar, que tiene
        // el saldo del instante y no el de cuando se armó el carrito. Cuando el
        // servidor YA rechazó, ese aviso preventivo sobra: el hecho consumado
        // manda sobre la advertencia.
        <p role="alert" className="text-destructive text-xs">
          {t("pos.cart.outOfStock")}
        </p>
      )}
    </li>
  );
}

function Totals({ lines }: { lines: CartLine[] }) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;

  return (
    <p className="flex justify-between border-t pt-2 font-semibold text-lg">
      <span>{t("pos.cart.subtotal")}</span>
      <span className="tabular-nums" data-testid="cart-subtotal">
        {formatMoney(subtotalDelCarrito(lines), currency, locale)}
      </span>
    </p>
  );
}
