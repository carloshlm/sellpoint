import { type Currency, formatMoney, splitLineTax, type TaxMode } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { MoneyField } from "@/components/form/money-field";
import { TaxGroupSelect } from "@/components/form/tax-group-select";
import { useTaxSettings } from "@/lib/tenant/tax-hooks";
import { useAuthStore } from "@/stores/auth.store";

interface PricingFieldsetProps {
  taxGroupId: string | null;
  onTaxGroupChange: (taxGroupId: string | null) => void;
  cost: string;
  onCostChange: (value: string) => void;
  /** Etiqueta y ayuda YA traducidas: cada formulario conserva sus claves de i18n literales. */
  costLabel: string;
  costHint: string;
  costError?: string;
  price: string;
  onPriceChange: (value: string) => void;
  priceLabel: string;
  priceHint: string;
  priceError?: string;
  disabled?: boolean;
}

/**
 * El bloque «Impuesto, costo y precio» de los formularios de artículo
 * (Carlos, 2026-09-12: «aún es confuso poner el costo y el precio»).
 *
 * Tres decisiones de UX, en orden de importancia:
 *
 * 1. **El impuesto va PRIMERO.** Es el dato que decide cómo se leen los otros
 *    dos; ponerlo después obligaba a capturar importes sin saber en qué base.
 * 2. **La regla del negocio se dice UNA vez, arriba, con sus dos mitades**
 *    («el costo se captura SIN impuesto», «el precio va CON impuesto incluido»)
 *    y un enlace a donde se cambia. Las etiquetas repiten la base entre
 *    paréntesis para que no haya que volver a leer la regla.
 * 3. **El desglose en vivo.** Debajo del precio se muestra lo que verá el
 *    cliente en el ticket con el impuesto del artículo ya aplicado: en México
 *    «$23.00, que ya incluye $3.17 de IVA 16%»; en Canadá «$23.00 + $2.76 de
 *    GST 5% + PST 7% = $25.76». Es la explicación que ningún texto reemplaza:
 *    el usuario ve el número que le importa. Con el costo capturado con
 *    impuesto, se muestra también su neto, que es el que entra a la utilidad.
 *
 * La aritmética es la del ticket (`splitLineTax`, en centavos), con el grupo
 * elegido o, si no eligió, el predeterminado del negocio.
 */
export function PricingFieldset({
  taxGroupId,
  onTaxGroupChange,
  cost,
  onCostChange,
  costLabel,
  costHint,
  costError,
  price,
  onPriceChange,
  priceLabel,
  priceHint,
  priceError,
  disabled,
}: PricingFieldsetProps) {
  const { t } = useTranslation();
  const priceMode = useAuthStore((s) => s.user?.tenant?.taxMode ?? "included");
  const costMode = useAuthStore((s) => s.user?.tenant?.costTaxMode ?? "excluded");
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant?.currency) ?? "MXN") as Currency;
  const { data } = useTaxSettings();

  const grupo =
    data?.groups.find((g) => g.id === taxGroupId) ??
    data?.groups.find((g) => g.isDefault && g.isActive);
  const componentes = grupo?.rates ?? [];
  const nombres = componentes.map((r) => r.name).join(" + ");
  const dinero = (cents: number) => formatMoney(cents / 100, currency, locale);

  const desglosePrecio = desglose(price, priceMode, componentes);
  const precioEnTicket =
    desglosePrecio === null
      ? null
      : componentes.length === 0
        ? t("common.pricing.breakdownNone", { gross: dinero(desglosePrecio.gross) })
        : priceMode === "included"
          ? t("common.pricing.breakdownIncluded", {
              gross: dinero(desglosePrecio.gross),
              tax: dinero(desglosePrecio.tax),
              taxes: nombres,
            })
          : t("common.pricing.breakdownExcluded", {
              net: dinero(desglosePrecio.net),
              tax: dinero(desglosePrecio.tax),
              taxes: nombres,
              gross: dinero(desglosePrecio.gross),
            });

  const desgloseCosto = costMode === "included" ? desglose(cost, "included", componentes) : null;
  const costoNeto =
    desgloseCosto === null || desgloseCosto.tax === 0
      ? null
      : t("common.pricing.costNet", { net: dinero(desgloseCosto.net) });

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-4" data-testid="pricing-fieldset">
      <legend className="px-1 font-medium text-sm">{t("common.pricing.legend")}</legend>
      <p className="text-muted-foreground text-xs" data-testid="pricing-rule">
        {t(
          costMode === "included"
            ? "common.pricing.costRuleIncluded"
            : "common.pricing.costRuleExcluded",
        )}{" "}
        {t(
          priceMode === "included"
            ? "common.pricing.priceRuleIncluded"
            : "common.pricing.priceRuleExcluded",
        )}{" "}
        <Link to="/profile" className="text-primary underline-offset-2 hover:underline">
          {t("common.pricing.changeLink")}
        </Link>
      </p>
      <TaxGroupSelect value={taxGroupId} onChange={onTaxGroupChange} disabled={disabled} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <MoneyField
            label={costLabel}
            hint={costHint}
            error={costError}
            value={cost}
            disabled={disabled}
            onChange={onCostChange}
          />
          {costoNeto !== null && (
            <p className="text-xs" data-testid="cost-breakdown">
              {costoNeto}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <MoneyField
            label={priceLabel}
            hint={priceHint}
            error={priceError}
            value={price}
            disabled={disabled}
            onChange={onPriceChange}
          />
          {precioEnTicket !== null && (
            <p className="text-xs" data-testid="price-breakdown" role="status">
              {precioEnTicket}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

/** El importe tecleado, partido como lo haría el ticket; `null` si aún no hay un número. */
function desglose(
  raw: string,
  mode: TaxMode,
  components: readonly { code: string; name: string; rate: string }[],
): { net: number; tax: number; gross: number } | null {
  if (raw.trim() === "") return null;
  const numero = Number(raw);
  if (!Number.isFinite(numero) || numero < 0) return null;
  const amountCents = Math.round(numero * 100);
  const split = splitLineTax({ amountCents, mode, components });
  return {
    net: split.netCents,
    tax: split.taxCents,
    gross: mode === "included" ? amountCents : amountCents + split.taxCents,
  };
}
