import { captureUnitsFor, unitName, unitSymbol } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { resolveUiLocale } from "@/lib/accept-language";
import { cn } from "@/lib/utils";

/**
 * F10-BULK-04 — el botón de unidad junto a la cantidad: «kg | g», «L | ml»,
 * «m | cm», «lb | oz». Una sola pieza para la caja, las entradas, salidas y
 * traspasos, el conteo y las compras: copiarlo en cada pantalla sería tener
 * una regla por pantalla.
 *
 * Es presentacional: la unidad elegida, el recuerdo y la conversión viven en
 * `useCaptureUnit` (`lib/use-capture-unit.ts`), que la pantalla usa junto con
 * este botón:
 *
 *   const capture = useCaptureUnit(baseUnit, atBasePresentation);
 *   <CaptureUnitToggle baseUnit={baseUnit} atBasePresentation={atBasePresentation}
 *     value={capture.unit} onChange={capture.setUnit} />
 *
 * No aparece en un empaque (`atBasePresentation` falso: ahí la cantidad son
 * empaques) ni en una base sin hermana que quepa (`unit`, `ft`).
 *
 * Mismo molde que el selector de idioma (`auth/language-switcher.tsx`): un
 * grupo segmentado compacto con `aria-pressed`, porque con dos opciones dos
 * botones visibles cambian con un toque y no se confunden con otro campo. Son
 * `<button>` nativos: se llega con Tab y se activan con Enter o Espacio.
 * Cada uno muestra el SÍMBOLO y se nombra con el texto aprobado «Escribir la
 * cantidad en gramos», que un lector de pantalla entiende mejor que «g».
 */
interface CaptureUnitToggleProps {
  baseUnit: string;
  /** ¿El renglón está en la presentación de la unidad base (factor 1)? */
  atBasePresentation: boolean;
  /** La unidad elegida (`useCaptureUnit().unit`). */
  value: string;
  onChange: (unit: string) => void;
  disabled?: boolean;
  className?: string;
}

function CaptureUnitToggle({
  baseUnit,
  atBasePresentation,
  value,
  onChange,
  disabled = false,
  className,
}: CaptureUnitToggleProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveUiLocale(i18n);
  const units = captureUnitsFor(baseUnit);

  if (!atBasePresentation || units.length < 2) {
    return null;
  }

  return (
    // `<fieldset>` y no un `<div role="group">`, como en el selector de idioma
    // (lint de Biome `a11y/useSemanticElements`).
    <fieldset
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5",
        className,
      )}
    >
      {units.map((unit) => {
        const isActive = unit === value;
        return (
          <button
            key={unit}
            type="button"
            aria-pressed={isActive}
            aria-label={t("common.captureUnit.label", {
              unit: unitName(unit, locale, { plural: true }).toLowerCase(),
            })}
            onClick={() => {
              if (!isActive) {
                onChange(unit);
              }
            }}
            className={cn(
              "min-w-8 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {unitSymbol(unit)}
          </button>
        );
      })}
    </fieldset>
  );
}

export { CaptureUnitToggle };
