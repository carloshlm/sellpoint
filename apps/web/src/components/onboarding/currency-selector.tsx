import { type Currency, SUPPORTED_CURRENCIES } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";

interface CurrencySelectorProps {
  value: Currency;
  onChange: (value: Currency) => void;
  error?: string;
}

/**
 * F1-LOCALE-07 (F1-WEB-ONBOARD-01, paso 1). Presentacional puro: solo
 * emite `onChange`, NUNCA llama al API directo — la persistencia real la
 * hace `PATCH /tenants/me` desde el form contenedor (`step-business.tsx`).
 * La regla de inmutabilidad post-transacciones vive ÚNICAMENTE en
 * `TenantCurrencyChangeableGuard` (backend) — este componente no la
 * reimplementa ni la valida. Su copy de advertencia se retiró el 2026-08-16
 * (decisión de Carlos): la regla sigue en pie, solo dejó de anunciarse acá.
 */
function CurrencySelector({ value, onChange, error }: CurrencySelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={t("onboarding.step1.currency")}
        value={value}
        onChange={(event) => onChange(event.target.value as Currency)}
        error={error}
        options={SUPPORTED_CURRENCIES.map((currency) => ({
          value: currency,
          label: t(`onboarding.step1.currencyOptions.${currency}`),
        }))}
      />
      {/* Decisión 5 (2026-08-16): la moneda SIEMPRE es visible y editable —
          esta línea aclara que la lista de 5 no es un techo, solo lo
          habilitado hoy. */}
      <p className="text-xs text-muted-foreground">{t("onboarding.step1.currencyRequestHint")}</p>
    </div>
  );
}

export { CurrencySelector };
