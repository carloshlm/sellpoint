import type * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Una CANTIDAD dentro de una celda de tabla (Carlos, 2026-09-13).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * Órdenes de compra, recepciones y compras tenían cada una su `<Input>`
 * suelto con `inputMode="decimal"` y nada más: el teclado sugerido era
 * numérico, pero el campo aceptaba CUALQUIER texto. Carlos mandó capturas
 * con `sst2`, `91dsad` y `dsdd10` tecleados donde va una cantidad. Después
 * `Number("sst2")` da `NaN`, que al serializar el JSON viaja como `null`, y
 * el error que ve el usuario no habla de lo que hizo.
 *
 * Es el hermano de `MoneyInput` y hereda su criterio, que vale la pena
 * repetir: las LETRAS no entran —descartarlas no puede cambiar el número que
 * el usuario quiso escribir— pero el punto y la coma SÍ entran aunque la
 * presentación no admita fracciones, y es el error quien lo explica. Filtrar
 * el punto en silencio convertiría «2.5» en «25» mientras la persona mira la
 * pantalla: un producto que se vende por pieza terminaría pedido de a
 * veinticinco. Un error visible se corrige; un número cambiado a tus
 * espaldas, no.
 *
 * Por eso tampoco es `type="number"`: las flechitas, la rueda del mouse y la
 * tecla «e» de notación científica no tienen nada que hacer en una cantidad.
 */

/** Dígitos, punto y coma. Todo lo demás se descarta al teclear. */
const ADMITIDO = /^[\d.,]*$/;

interface QuantityInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "inputMode" | "value" | "onChange"> {
  /** El texto crudo del campo, tal como el padre lo guarda en su estado. */
  value: string;
  onChange: (value: string) => void;
  /**
   * La presentación elegida admite fracciones (`allowFractionalInput`). Con
   * `false` el teclado del móvil sale sin punto, pero el punto tecleado en un
   * teclado físico entra igual y lo señala el error: ver el docblock.
   */
  allowsDecimals: boolean;
  /** Presente → input inválido y anunciado. */
  invalid?: boolean;
}

function QuantityInput({
  value,
  onChange,
  allowsDecimals,
  invalid,
  className,
  ...inputProps
}: QuantityInputProps) {
  return (
    <Input
      type="text"
      inputMode={allowsDecimals ? "decimal" : "numeric"}
      autoComplete="off"
      className={cn("ml-auto w-24 text-right tabular-nums", className)}
      value={value}
      aria-invalid={invalid ? true : undefined}
      onChange={(event) => {
        const texto = event.target.value;
        if (ADMITIDO.test(texto)) onChange(texto);
      }}
      {...inputProps}
    />
  );
}

export { QuantityInput, type QuantityInputProps };
