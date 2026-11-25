import { minimumCaptureQuantity, parseQuantity, unitSymbol } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CaptureUnitToggle } from "@/components/ui/capture-unit-toggle";
import {
  type CaptureEntry,
  captureDecimals,
  fitsIntegerDigits,
  pressCaptureKey,
  pulsarTecla,
  type ReglasDeCantidad,
  sanearCantidad,
} from "@/lib/pos/numpad";
import { useCaptureUnit } from "@/lib/use-capture-unit";

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
 *
 * ── Escribir en gramos (F10-BULK-05) ────────────────────────────────────
 *
 * En la presentación base (`isBase`: la de factor 1 que nació con el
 * producto, no una «Bolsa 1 Kg») de un producto que admite decimales, junto a
 * la cantidad va el botón de unidad («kg | g»,
 * `CaptureUnitToggle`). En «g» se teclea 250 y el renglón recibe 0.25: el
 * carrito, el importe y el API siguen en kilos. Lo tecleado vive aquí, porque
 * «250.» no se puede reconstruir desde 0.25; la cantidad del renglón manda, y
 * si cambia por otro lado (otro escaneo) el campo vuelve a pintarla.
 *
 * Con «Solo enteros» no hay botón: los gramos casi nunca dan kilos enteros, y
 * el API rechazaría lo demás. En un empaque tampoco: ahí la cantidad son
 * bolsas. En la unidad base, el teclado es el de siempre.
 */

const DIGITOS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface NumpadProps {
  /** La cantidad del renglón, en la unidad de su presentación. */
  value: string;
  /** Recibe la cantidad en la unidad de la presentación, ya convertida. */
  onChange: (value: string) => void;
  /** De la presentación seleccionada. Decide si el punto existe. */
  allowFractional: boolean;
  /** La unidad base del producto (F10-BULK-05). Sin ella no hay botón de unidad. */
  baseUnit?: string;
  /** ¿El renglón está en la presentación base del producto (`isBase`)? */
  atBasePresentation?: boolean;
  /** Se muestra cuando un pegado hubo que recortarlo. */
  hint?: string | null;
  onHint?: (hint: string | null) => void;
}

export function Numpad({
  value,
  onChange,
  allowFractional,
  baseUnit = "unit",
  atBasePresentation = false,
  hint,
  onHint,
}: NumpadProps) {
  const { t } = useTranslation();
  const canToggle = atBasePresentation && allowFractional;
  const capture = useCaptureUnit(baseUnit, canToggle);
  const [entry, setEntry] = useState<(CaptureEntry & { unit: string }) | null>(null);

  // En la base no hay nada que guardar: el campo es la cantidad del renglón.
  const inSibling = capture.unit !== baseUnit;
  const minimum = inSibling ? minimumCaptureQuantity(capture.unit, baseUnit) : null;
  const siblingRules: ReglasDeCantidad = {
    allowFractional: true,
    maxDecimals: captureDecimals(minimum),
  };
  const minimumHint = t("common.captureUnit.minimum", {
    min: `${minimum ?? ""} ${unitSymbol(capture.unit)}`,
  });

  // Lo tecleado vale mientras siga siendo la cantidad del renglón. Si no (se
  // eligió la unidad, se abrió el teclado o la cantidad cambió por otro lado),
  // se pinta la conversión y la primera tecla empieza de cero.
  const converted = entry === null ? null : capture.toBase(entry.text).quantity;
  const shown: CaptureEntry | null = !inSibling
    ? null
    : entry !== null &&
        entry.unit === capture.unit &&
        converted !== null &&
        parseQuantity(converted) === parseQuantity(value)
      ? entry
      : { text: capture.fromBase(value) ?? "", fresh: true };

  /** Lo tecleado en la hermana → el renglón, si cabe. Si no, la tecla no entra. */
  const commit = (next: CaptureEntry, truncated = false) => {
    const result = capture.toBase(next.text);
    if (result.error !== null) {
      onHint?.(result.error);
      return;
    }
    if (!fitsIntegerDigits(result.quantity)) {
      return;
    }
    setEntry({ ...next, unit: capture.unit });
    onChange(result.quantity);
    onHint?.(truncated ? minimumHint : null);
  };

  const pulsar = (tecla: string) => {
    onHint?.(null);
    if (shown === null) {
      onChange(pulsarTecla(value, tecla, { allowFractional }));
      return;
    }
    const next = pressCaptureKey(shown, tecla, siblingRules);
    if (next !== shown) {
      commit(next);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="numpad">
      <div className="flex items-center gap-2">
        <input
          id="pos-numpad-quantity"
          name="quantity"
          inputMode="decimal"
          className="h-12 min-w-0 flex-1 rounded-md border bg-background px-3 text-right text-2xl tabular-nums placeholder:text-muted-foreground/60"
          // Recién elegida la unidad, el campo se ve vacío y la conversión va
          // en gris: lo que se teclee la reemplaza, también desde el teclado
          // de la computadora.
          value={shown === null ? value : shown.fresh ? "" : shown.text}
          placeholder={shown?.fresh ? shown.text : undefined}
          aria-label={t("pos.cart.quantity")}
          onChange={(e) => {
            if (shown !== null) {
              const saneada = sanearCantidad(e.target.value, siblingRules);
              commit({ text: saneada.value, fresh: false }, saneada.truncated);
              return;
            }
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
        {/* Del tamaño del campo: se toca con el dedo, como el resto del
            teclado. */}
        <CaptureUnitToggle
          baseUnit={baseUnit}
          atBasePresentation={canToggle}
          value={capture.unit}
          onChange={(unit) => {
            setEntry(null);
            onHint?.(null);
            capture.setUnit(unit);
          }}
          className="[&>button]:h-11 [&>button]:min-w-12 [&>button]:text-base"
        />
      </div>

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
