import {
  addQuantities,
  captureHint,
  formatQuantity,
  formatQuantityWithUnit,
  multiplyQuantities,
  unitSymbol,
} from "@sellpoint/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CaptureUnitToggle } from "@/components/ui/capture-unit-toggle";
import { resolveUiLocale } from "@/lib/accept-language";
import type {
  CountBreakdownEntry,
  CountBreakdownView,
  DocumentPresentation,
  DocumentProduct,
  DocumentRow,
} from "@/lib/inventory/types";
import { quantityInputError } from "@/lib/quantity";
import { useCaptureUnit } from "@/lib/use-capture-unit";

type Locale = Parameters<typeof captureHint>[2];

/**
 * F10-BULK-10 — «Contar por presentaciones».
 *
 * El inventario físico sigue en unidad base (decisión del 2026-08-31): el
 * «Contado» del queso son kilogramos. Lo que faltaba es sumar bolsas y sueltos
 * sin calculadora: 2 «Bolsa 1 Kg» + 1 «Bolsa 10 Kg» + 600 g son 12.600
 * kilogramos. Este panel hace esa cuenta y la manda al API como desglose; el
 * API la valida, calcula el contado y lo guarda con el renglón (F10-BULK-11).
 *
 * Va en una fila de una sola celda bajo el renglón (skill sellpoint-tables,
 * patrón 7): en un celular queda a la vista aunque la tabla esté deslizada, y
 * no la tapa el recorte de la caja con scroll, como pasaría con un popover.
 */

/** Los empaques que se cuentan: las presentaciones activas que NO son la base. */
export function breakdownPresentations(product: DocumentProduct): DocumentPresentation[] {
  return product.presentations.filter((presentation) => presentation.isBase !== true);
}

/**
 * «2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g»: cómo se contó el renglón. Los
 * ceros se omiten («0 × Bolsa 10 Kg» no dice nada), salvo que todo sea cero.
 */
export function formatCountBreakdown(
  entries: CountBreakdownView[],
  product: DocumentProduct | undefined,
  locale: Locale,
): string {
  const withQuantity = entries.filter((entry) => Number(entry.quantity) !== 0);
  const shown = withQuantity.length === 0 ? entries : withQuantity;
  return shown
    .map((entry) => {
      if (entry.presentationId === null) {
        return looseText(entry.quantity, product?.baseUnit ?? "", locale);
      }
      const name =
        entry.presentationName ??
        product?.presentations.find((p) => p.id === entry.presentationId)?.name ??
        "—";
      return `${entry.quantity} × ${name}`;
    })
    .join(" + ");
}

/** Los sueltos con su símbolo: «600 g» si es menos de un kilogramo, «1.500 kg» si no. */
function looseText(quantity: string, baseUnit: string, locale: Locale): string {
  const hint = captureHint(quantity, baseUnit, locale);
  if (hint !== null) {
    // «(600 g)» → «600 g»: la misma conversión que la pista junto a la cantidad.
    return hint.slice(1, -1);
  }
  return `${formatQuantity(quantity, baseUnit)} ${unitSymbol(baseUnit)}`;
}

interface CountBreakdownPanelProps {
  row: DocumentRow;
  product: DocumentProduct;
  /** El `id` del panel: el botón que lo abre lo nombra en `aria-controls`. */
  id: string;
  saving: boolean;
  /** El rechazo del API, ya traducido. */
  error: string | null;
  onApply: (entries: CountBreakdownEntry[]) => void;
  onClose: () => void;
}

export function CountBreakdownPanel({
  row,
  product,
  id,
  saving,
  error,
  onApply,
  onClose,
}: CountBreakdownPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveUiLocale(i18n);
  const packages = breakdownPresentations(product);
  const saved = row.countBreakdown ?? [];
  const savedLoose = saved.find((entry) => entry.presentationId === null)?.quantity ?? null;
  // Los sueltos van en la unidad base, con su botón (600 g se escriben como 600).
  const capture = useCaptureUnit(product.baseUnit, true);

  // Al volver a abrirlo trae lo guardado: corregir una bolsa no obliga a
  // teclear todo otra vez.
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      packages.map((p) => [
        p.id,
        saved.find((entry) => entry.presentationId === p.id)?.quantity ?? "",
      ]),
    ),
  );
  /**
   * Los sueltos, en la unidad del botón. Si lo guardado no se puede escribir
   * en ella (7 in en pies), el campo queda vacío con lo guardado en gris y,
   * mientras nadie teclee, se conserva — el mismo criterio que el renglón.
   */
  const [loose, setLoose] = useState(() => {
    if (savedLoose === null) {
      return { text: "", placeholder: null as string | null };
    }
    const text = capture.fromBase(savedLoose);
    return text === null
      ? { text: "", placeholder: `${savedLoose} ${unitSymbol(product.baseUnit)}` }
      : { text, placeholder: null };
  });

  const firstField = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const packageErrors = new Map<string, string>();
  for (const p of packages) {
    const key = quantityInputError(typed[p.id] ?? "", { allowsDecimals: p.allowFractionalInput });
    if (key !== null) {
      packageErrors.set(p.id, t(key, { presentation: p.name }));
    }
  }

  // Lo suelto en la base: en la hermana valida `toBase`; en la base, la
  // validación de cantidad de siempre.
  const keepsSavedLoose = loose.text.trim() === "" && loose.placeholder !== null;
  const looseBase = keepsSavedLoose
    ? { quantity: savedLoose ?? "", error: null }
    : capture.toBase(loose.text);
  const looseKey =
    capture.unit === product.baseUnit
      ? quantityInputError(loose.text, { allowsDecimals: true })
      : null;
  const looseError = looseKey === null ? looseBase.error : t(looseKey);

  // Lo que viaja: solo lo que se escribió. Un campo vacío no es «cero».
  const entries: CountBreakdownEntry[] = [];
  for (const p of packages) {
    const text = (typed[p.id] ?? "").trim();
    if (text !== "" && !packageErrors.has(p.id)) {
      entries.push({ presentationId: p.id, quantity: addQuantities(text, "0") });
    }
  }
  if (looseError === null && looseBase.quantity !== null && looseBase.quantity !== "") {
    entries.push({ presentationId: null, quantity: addQuantities(looseBase.quantity, "0") });
  }

  // `multiplyQuantities` y `addQuantities`, no `Number`: 0.1 + 0.2 tiene que dar 0.3.
  const total = entries.reduce((sum, entry) => {
    const factor =
      entry.presentationId === null
        ? "1"
        : (packages.find((p) => p.id === entry.presentationId)?.factor ?? "1");
    return addQuantities(sum, multiplyQuantities(entry.quantity, factor));
  }, "0");

  const hasErrors = packageErrors.size > 0 || looseError !== null;
  const canApply = !saving && !hasErrors && entries.length > 0;

  const changeLooseUnit = (next: string) => {
    const kept = keepsSavedLoose ? (savedLoose ?? "") : (looseBase.quantity ?? "");
    const switched = capture.switchUnit(next, kept);
    setLoose({ text: switched.text, placeholder: switched.placeholder });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  // Lote y ubicación: con lotes, el desglose es de ESTE renglón.
  const where = [product.name, row.lotCode, row.location].filter(Boolean).join(" · ");
  const fieldClass = "w-24 rounded-md border border-input bg-background px-2 py-1 text-sm";

  return (
    <form
      id={id}
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply) {
          onApply(entries);
        }
      }}
      onKeyDown={onKeyDown}
      className="w-fit min-w-72 rounded-lg border border-border bg-background p-3 shadow-sm"
    >
      <fieldset disabled={saving} className="flex flex-col gap-2">
        <legend className="mb-2 text-sm">
          <span className="font-medium">{t("inventory.count.byPresentation")}</span>
          <span className="text-muted-foreground"> · {where}</span>
        </legend>
        {packages.map((p, index) => {
          const fieldId = `${id}-${p.id}`;
          const fieldError = packageErrors.get(p.id) ?? null;
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <label htmlFor={fieldId} className="w-36 text-sm">
                {p.name}
              </label>
              <span aria-hidden="true" className="text-muted-foreground">
                ×
              </span>
              <input
                id={fieldId}
                ref={index === 0 ? firstField : undefined}
                type="text"
                inputMode={p.allowFractionalInput ? "decimal" : "numeric"}
                value={typed[p.id] ?? ""}
                aria-invalid={fieldError !== null ? true : undefined}
                onChange={(event) => setTyped((prev) => ({ ...prev, [p.id]: event.target.value }))}
                className={fieldClass}
              />
              {fieldError !== null && (
                <span className="text-destructive text-xs">{fieldError}</span>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-loose`} className="w-36 text-sm">
            {t("inventory.count.loose")}
          </label>
          {/* El hueco del «×»: los campos quedan en columna. */}
          <span aria-hidden="true" className="invisible">
            ×
          </span>
          <input
            id={`${id}-loose`}
            ref={packages.length === 0 ? firstField : undefined}
            type="text"
            inputMode="decimal"
            value={loose.text}
            placeholder={loose.placeholder ?? undefined}
            aria-invalid={looseError !== null ? true : undefined}
            onChange={(event) => setLoose({ text: event.target.value, placeholder: null })}
            className={fieldClass}
          />
          <CaptureUnitToggle
            baseUnit={product.baseUnit}
            atBasePresentation
            value={capture.unit}
            onChange={changeLooseUnit}
          />
          {looseError !== null && <span className="text-destructive text-xs">{looseError}</span>}
        </div>
        <p aria-live="polite" className="font-medium text-sm">
          {t("inventory.count.breakdownTotal", {
            quantity: formatQuantityWithUnit(total, product.baseUnit, locale),
          })}
        </p>
        {error !== null && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!canApply}>
            {t("inventory.count.breakdownApply")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t("common.form.cancel")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
