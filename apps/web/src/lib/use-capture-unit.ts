import {
  captureUnitsFor,
  fromBaseQuantity,
  minimumCaptureQuantity,
  toBaseQuantity,
  type UnitCode,
  unitSymbol,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { quantityInputError } from "@/lib/quantity";

/**
 * F10-BULK-04 — la unidad en que se ESCRIBE una cantidad, junto con su botón
 * (`components/ui/capture-unit-toggle.tsx`).
 *
 * El queso va en kilogramos, pero sus 600 g se escriben como 600. Este hook
 * guarda la unidad elegida y convierte lo tecleado a la unidad base con
 * `toBaseQuantity` (aritmética exacta, sin coma flotante) ANTES de que la
 * pantalla lo mande: el API recibe la cantidad en la unidad de la
 * presentación, como siempre.
 *
 * ── Cuándo convierte ────────────────────────────────────────────────────
 *
 * Solo si el renglón está en la presentación de la unidad base (factor 1) y
 * la base tiene una hermana que cabe (`captureUnitsFor`). En un empaque la
 * cantidad son empaques —«2 Bolsa 10 Kg»— y no se toca. Con la base elegida,
 * `toBase` devuelve lo tecleado tal cual: las validaciones de cantidad de cada
 * pantalla (`quantityInputError`) siguen siendo las de siempre.
 *
 * ── El recuerdo ─────────────────────────────────────────────────────────
 *
 * La última unidad usada se guarda en ESTE dispositivo, una por unidad base
 * (`sellpoint.captureUnit.kg` = `gr`): quien pesa en gramos no tiene que
 * elegirlos en cada renglón. Mismo criterio que `ticket-width.ts`: en ventana
 * privada leer o escribir revienta, y se degrada a la base sin recordar.
 */

const STORAGE_PREFIX = "sellpoint.captureUnit.";

/** Un decimal escrito sin signo: lo único que se convierte. */
const DECIMAL_TEXT = /^(\d+\.?\d*|\.\d+)$/;

function readPreference(baseUnit: string, units: readonly UnitCode[]): string {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${baseUnit}`);
    // Un valor que ya no es hermana de esta base (o basura) no gana.
    return units.find((unit) => unit === stored) ?? baseUnit;
  } catch {
    return baseUnit;
  }
}

function writePreference(baseUnit: string, unit: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${baseUnit}`, unit);
  } catch {
    // Modo privado o cuota llena: la elección vale en este montaje y no se
    // recuerda. No rompe nada.
  }
}

/** Lo que tecleado vale en la base, o por qué no se puede guardar. */
export type CaptureToBase = { quantity: string; error: null } | { quantity: null; error: string };

export interface CaptureUnit {
  /** Las unidades que se ofrecen, con la base primero (`captureUnitsFor`). */
  units: readonly UnitCode[];
  /** ¿Se pinta el botón? Solo en la presentación base y con una hermana. */
  showToggle: boolean;
  /** La unidad en que se escribe: la base cuando el botón no aplica. */
  unit: string;
  /** Elige la unidad y la recuerda para esta unidad base. */
  setUnit: (unit: string) => void;
  /**
   * Lo tecleado → la cantidad en la base. Vacío o en la base, pasa tal cual.
   * En la hermana: la cantidad exacta, o el error «La cantidad mínima es
   * 0.1 g.» si no cabe en 4 decimales (o «Escribe una cantidad.» si no es un
   * número).
   */
  toBase: (typed: string) => CaptureToBase;
  /**
   * La cantidad guardada en la base, escrita en la unidad elegida (para
   * volver a pintarla en el campo). `null` si no es un decimal exacto en esa
   * unidad (7 in en pies): quien la pinta la muestra en la base.
   */
  fromBase: (quantityBase: string | number) => string | null;
}

export function useCaptureUnit(baseUnit: string, atBasePresentation: boolean): CaptureUnit {
  const { t } = useTranslation();
  const units = captureUnitsFor(baseUnit);
  const showToggle = atBasePresentation && units.length > 1;

  // La elección va amarrada a SU unidad base: si el renglón cambia de producto
  // (de kilos a litros), se lee el recuerdo de la base nueva.
  const [choice, setChoice] = useState(() => ({
    baseUnit,
    unit: readPreference(baseUnit, units),
  }));
  const chosen = choice.baseUnit === baseUnit ? choice.unit : readPreference(baseUnit, units);
  const unit = showToggle ? chosen : baseUnit;

  const setUnit = (next: string) => {
    if (!units.some((candidate) => candidate === next)) {
      return;
    }
    setChoice({ baseUnit, unit: next });
    writePreference(baseUnit, next);
  };

  const toBase = (typed: string): CaptureToBase => {
    const text = typed.trim();
    if (text === "" || unit === baseUnit) {
      return { quantity: text, error: null };
    }
    if (!DECIMAL_TEXT.test(text)) {
      // La coma, el signo o letras: el mismo mensaje que daría la pantalla.
      const key = quantityInputError(text, { allowsDecimals: true });
      return { quantity: null, error: t(key ?? "purchaseOrders.lines.errors.quantityNaN") };
    }
    const quantity = toBaseQuantity(text, unit, baseUnit);
    if (quantity !== null) {
      return { quantity, error: null };
    }
    const min = minimumCaptureQuantity(unit, baseUnit);
    return {
      quantity: null,
      error: t("common.captureUnit.minimum", { min: `${min} ${unitSymbol(unit)}` }),
    };
  };

  const fromBase = (quantityBase: string | number): string | null =>
    unit === baseUnit ? String(quantityBase) : fromBaseQuantity(quantityBase, unit, baseUnit);

  return { units, showToggle, unit, setUnit, toBase, fromBase };
}
