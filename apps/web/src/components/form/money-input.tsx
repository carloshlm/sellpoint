import { currencySymbol, formatMoneyInput } from "@sellpoint/shared";
import type * as React from "react";
import { useId } from "react";

import { useScopedCurrency } from "@/lib/admin/scope";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

interface MoneyInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "type" | "inputMode" | "value" | "onChange" | "onBlur"
  > {
  /** El texto crudo del campo, tal como el padre lo guarda en su estado. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * El control de un importe (Carlos, 2026-09-07): el símbolo de la moneda del
 * negocio como prefijo, su código ISO como sufijo, y el número entre los dos.
 *
 * ── Por qué la moneda va DENTRO del campo y no en la etiqueta ───────────
 *
 * Es el patrón de Shopify, Stripe y el GOV.UK Design System: la etiqueta dice
 * QUÉ es el número («Precio de venta») y el campo dice EN QUÉ se escribe. El
 * símbolo solo no alcanza —«$» es el mismo para pesos, dólares canadienses y
 * estadounidenses—, por eso el código ISO siempre acompaña, también donde
 * sería redundante (€ EUR): el usuario aprende un solo patrón.
 *
 * ── Texto con teclado decimal, no `type="number"` ───────────────────────
 *
 * `type="number"` trae flechitas que cambian el valor con la rueda del mouse,
 * acepta «e», y en iOS abre un teclado sin punto. `inputMode="decimal"` abre
 * el teclado numérico CON punto y deja el valor como texto, que es lo que hay
 * que formatear.
 *
 * ── Se formatea al SALIR, no al escribir ────────────────────────────────
 *
 * Al perder el foco, lo que se escribió a medias se completa a dos decimales
 * («6» → «6.00»). Lo que no es un importe válido —coma, texto, un tercer
 * decimal— se deja tal cual para que el error del formulario lo señale: el
 * campo no disfraza lo que Postgres redondearía en silencio.
 */
function MoneyInput({
  value,
  onChange,
  className,
  disabled,
  "aria-describedby": describedBy,
  ...inputProps
}: MoneyInputProps) {
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const suffixId = useId();

  return (
    <div
      className={cn(
        // Las mismas clases de `Input`, en el contenedor: el borde y el anillo
        // de foco abrazan prefijo, número y sufijo como una sola pieza.
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-base transition-[color,box-shadow] md:text-sm",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        "has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:has-[[aria-invalid=true]]:ring-destructive/40",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {/* Decorativo para el lector de pantalla: el sufijo, que sí se anuncia,
          ya dice la moneda sin la ambigüedad del símbolo. */}
      <span aria-hidden="true" className="select-none text-muted-foreground">
        {currencySymbol(currency, locale)}
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const formateado = formatMoneyInput(value);
          if (formateado !== null && formateado !== value) {
            onChange(formateado);
          }
        }}
        aria-describedby={[describedBy, suffixId].filter(Boolean).join(" ")}
        {...inputProps}
      />
      <span id={suffixId} className="select-none font-medium text-muted-foreground text-xs">
        {currency}
      </span>
    </div>
  );
}

export { MoneyInput, type MoneyInputProps };
