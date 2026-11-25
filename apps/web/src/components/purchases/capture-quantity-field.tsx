import { type Locale, unitName } from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { QuantityInput } from "@/components/form/quantity-input";
import { CaptureUnitToggle } from "@/components/ui/capture-unit-toggle";
import { useCaptureUnit } from "@/lib/use-capture-unit";

/**
 * F10-BULK-12 — la cantidad de un renglón de compra, orden o recepción, con el
 * botón de unidad (`CaptureUnitToggle`) a su lado: el queso se compra en kilos,
 * pero 600 g se escriben como 600.
 *
 * ── Qué guarda el padre ─────────────────────────────────────────────────
 *
 * El padre sigue guardando la cantidad en la unidad de la PRESENTACIÓN, que
 * es lo que viaja al API (el API no cambia). Este campo lleva lo TECLEADO y
 * la unidad en que se tecleó, y le avisa al padre con la cantidad ya
 * convertida por `useCaptureUnit().toBase`, o con el error si en la unidad
 * hermana no cabe (`common.captureUnit.minimum`).
 *
 * ── Cuándo cambia el número guardado ────────────────────────────────────
 *
 * - Al teclear, y SOLO al teclear.
 * - Tocar el botón de unidad NUNCA lo cambia (la regla única de F10-BULK,
 *   Carlos, 2026-11-25): «5» kg pasan a verse como «5000» g y lo guardado
 *   sigue en 5 (`useCaptureUnit().switchUnit`). Antes el número se volvía a
 *   leer en la otra unidad y los 5 kg pasaban a ser 5 g. Si en la unidad
 *   nueva no se puede escribir (7 in en pies), el campo queda vacío con «7 in»
 *   en gris y lo guardado no se toca. Un texto que no se podía guardar
 *   («0.05» en gramos) tampoco se vuelve a leer: el campo muestra lo guardado.
 * - Si la unidad cambia sin que nadie toque el botón (el renglón pasa a un
 *   empaque, la compra se confirma y el campo se apaga), la cantidad guardada
 *   se queda y solo se vuelve a ESCRIBIR en la unidad nueva: 0.6 kg se ven
 *   como 600 en gramos y como 0.6 en la base.
 *
 * Apagado (`disabled`) no hay botón y la cantidad se ve en la base, como antes.
 */
export interface CapturedQuantity {
  /** En la unidad de la presentación, lista para el API. Vacía si lo tecleado no cabe. */
  quantity: string;
  /** Por qué lo tecleado en la unidad hermana no se puede guardar, ya traducido. */
  captureError: string | null;
}

interface CaptureQuantityFieldProps {
  /** La unidad base del producto; `undefined` mientras su ficha no llega. */
  baseUnit: string | undefined;
  /** ¿El renglón está en la presentación de la unidad base? (`isBasePresentation`). */
  atBasePresentation: boolean;
  /** Lo que el padre tiene guardado, en la unidad de la presentación. */
  quantity: string;
  onChange: (next: CapturedQuantity) => void;
  /** «Solo enteros» de la presentación (`lineaAdmiteDecimales`). */
  allowsDecimals: boolean;
  invalid: boolean;
  disabled?: boolean;
  name: string;
  "aria-label": string;
}

/** Lo tecleado, en qué unidad, y la cantidad del padre que corresponde. */
interface Field {
  typed: string;
  unit: string;
  synced: string;
  /** La cantidad guardada, en gris, cuando el botón eligió una unidad en la que no se escribe. */
  placeholder: string | null;
}

export function CaptureQuantityField({
  baseUnit,
  atBasePresentation,
  quantity,
  onChange,
  allowsDecimals,
  invalid,
  disabled = false,
  name,
  "aria-label": ariaLabel,
}: CaptureQuantityFieldProps) {
  const base = baseUnit ?? "";
  const capture = useCaptureUnit(base, atBasePresentation && !disabled);
  const { unit } = capture;

  /**
   * La cantidad del padre escrita en la unidad elegida. Si ahí no es un
   * decimal exacto (7 in en pies), se escribe en la base y el campo vuelve a
   * la base: así lo que se ve sigue siendo lo que se guarda.
   */
  const express = (value: string): Field => {
    const typed = value === "" ? "" : capture.fromBase(value);
    return typed === null
      ? { typed: value, unit: base, synced: value, placeholder: null }
      : { typed, unit, synced: value, placeholder: null };
  };

  const [field, setField] = useState<Field>(() => express(quantity));

  // La cantidad cambió desde afuera (el servidor devolvió las líneas) o la
  // unidad cambió sin el botón: se vuelve a escribir, sin tocar lo guardado.
  // Es el ajuste de estado durante el render que recomienda React.
  let current = field;
  if (quantity !== field.synced || unit !== field.unit) {
    const next = express(quantity);
    if (next.typed !== field.typed || next.unit !== field.unit || next.synced !== field.synced) {
      current = next;
      setField(next);
    }
  }

  // `express` cayó a la base porque en la unidad elegida no era exacta: el
  // botón la acompaña.
  useEffect(() => {
    if (field.unit !== unit) {
      capture.setUnit(field.unit);
    }
  });

  const type = (text: string) => {
    const result = capture.toBase(text);
    const converted = result.quantity ?? "";
    setField({ typed: text, unit, synced: converted, placeholder: null });
    onChange({ quantity: converted, captureError: result.error });
  };

  // La cantidad del padre es la que se queda: el campo solo la vuelve a escribir.
  const toggle = (next: string) => {
    const switched = capture.switchUnit(next, quantity);
    setField({
      typed: switched.text,
      unit: next,
      synced: quantity,
      placeholder: switched.placeholder,
    });
    // El error era de un texto que ya no está en el campo.
    if (capture.toBase(field.typed).error !== null) {
      onChange({ quantity, captureError: null });
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <QuantityInput
        aria-label={ariaLabel}
        name={name}
        // En la unidad hermana siempre hay decimales: 0.5 g, o 1.25 kg sobre gramos.
        allowsDecimals={unit !== base || allowsDecimals}
        invalid={invalid}
        value={current.typed}
        placeholder={current.placeholder ?? undefined}
        disabled={disabled}
        onChange={type}
      />
      <CaptureUnitToggle
        baseUnit={base}
        atBasePresentation={atBasePresentation && !disabled}
        value={unit}
        onChange={toggle}
      />
    </div>
  );
}

/**
 * ¿El renglón está en la presentación BASE del producto? Sin presentación la
 * cantidad va en la base; la presentación base («Kilogramo», la de factor 1
 * que nació con el producto: `isBase` del API) también. Un empaque no: ahí la
 * cantidad son bolsas, y «Bolsa 1 Kg» es un empaque aunque valga 1 (Carlos,
 * 2026-11-25: con «g» recordado, «2» bolsas se guardaban como 2 g).
 */
export function isBasePresentation(
  product: { presentations: { id: string; isBase?: boolean }[] } | undefined,
  presentationId: string | null,
): boolean {
  if (presentationId === null || presentationId === "") {
    return true;
  }
  return product?.presentations.find((p) => p.id === presentationId)?.isBase === true;
}

/**
 * La unidad del costo, para «Costo por {{unit}}» (texto de F10-BULK-02): en la
 * presentación base, el nombre de la unidad en minúscula («kilogramo»); en un
 * empaque, el nombre del empaque («Bolsa 10 Kg»). `null` sin producto.
 */
export function costUnitName(
  product:
    | {
        baseUnit: string;
        presentations: { id: string; name: string; factor: string; isBase?: boolean }[];
      }
    | undefined,
  presentationId: string | null,
  locale: Locale,
): string | null {
  if (product === undefined) {
    return null;
  }
  if (isBasePresentation(product, presentationId)) {
    return unitName(product.baseUnit, locale).toLowerCase();
  }
  return product.presentations.find((p) => p.id === presentationId)?.name ?? null;
}
