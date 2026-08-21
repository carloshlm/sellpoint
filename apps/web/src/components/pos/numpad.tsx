import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { pulsarTecla, sanearCantidad } from "@/lib/pos/numpad";

/**
 * F4-CART-03 — el numpad del mostrador.
 *
 * Targets grandes porque esto se usa con el dedo sobre una tablet, de pie y con
 * gente esperando. Y **el punto desaparece** cuando la presentación no admite
 * decimales: esconder un botón que solo puede producir un 422 es mejor que
 * pintarlo y explicar después por qué no funcionó.
 *
 * La lógica no está acá — vive en `lib/pos/numpad.ts` y se testea sola. Este
 * componente es la cara.
 */

const DIGITOS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface NumpadProps {
  value: string;
  onChange: (value: string) => void;
  /** De la presentación seleccionada. Decide si el punto existe. */
  allowFractional: boolean;
  /** Se muestra cuando un pegado hubo que recortarlo. */
  hint?: string | null;
  onHint?: (hint: string | null) => void;
}

export function Numpad({ value, onChange, allowFractional, hint, onHint }: NumpadProps) {
  const { t } = useTranslation();

  const pulsar = (tecla: string) => {
    onHint?.(null);
    onChange(pulsarTecla(value, tecla, { allowFractional }));
  };

  return (
    <div className="flex flex-col gap-2" data-testid="numpad">
      <input
        inputMode="decimal"
        className="h-12 rounded-md border bg-background px-3 text-right text-2xl tabular-nums"
        value={value}
        aria-label={t("pos.cart.quantity")}
        onChange={(e) => {
          // El otro camino: teclado físico y `Ctrl+V`. El numpad puede esconder
          // el punto, no puede esconder el pegado.
          const saneada = sanearCantidad(e.target.value, { allowFractional });
          onChange(saneada.value);
          onHint?.(
            saneada.truncated
              ? allowFractional
                ? t("pos.cart.maxDecimals")
                : t("pos.cart.integersOnly")
              : null,
          );
        }}
      />

      {hint != null && (
        <p role="status" className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {DIGITOS.map((d) => (
          <Button key={d} variant="outline" className="h-14 text-xl" onClick={() => pulsar(d)}>
            {d}
          </Button>
        ))}

        {/* El punto solo existe si la unidad lo admite. Media pieza no existe. */}
        {allowFractional ? (
          <Button variant="outline" className="h-14 text-xl" onClick={() => pulsar(".")}>
            .
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-14 text-sm"
            onClick={() => pulsar("limpiar")}
            aria-label={t("pos.cart.clearQuantity")}
          >
            C
          </Button>
        )}

        <Button variant="outline" className="h-14 text-xl" onClick={() => pulsar("0")}>
          0
        </Button>

        <Button
          variant="outline"
          className="h-14 text-xl"
          onClick={() => pulsar("borrar")}
          aria-label={t("pos.cart.backspace")}
        >
          ⌫
        </Button>
      </div>
    </div>
  );
}
