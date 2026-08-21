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
 * reimplementa ni la valida, solo la ANUNCIA.
 *
 * ── Por qué el aviso se fue y volvió ────────────────────────────────────
 *
 * Se retiró el 2026-08-16 (decisión de Carlos) y estuvo bien: por entonces
 * `TenantTransactionsGate.hasTransactions()` devolvía `false` SIEMPRE desde
 * F1, así que el aviso prometía un bloqueo que no ocurría. Un aviso que no se
 * cumple es peor que no tenerlo — enseña a ignorar los avisos.
 *
 * **F3-GUARDS-01 arregló ese gate**: hoy cuenta `stock_movements` de verdad y
 * la moneda SÍ se congela con el primer movimiento. El texto que era mentira
 * pasó a ser cierto, y nadie lo notó durante días porque arreglar un guard no
 * avisa que revive una advertencia jubilada. Volvió el 2026-08-21.
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
      <p className="text-muted-foreground text-xs">{t("onboarding.step1.currencyWarning")}</p>
      {/* Decisión 5 (2026-08-16): la moneda SIEMPRE es visible y editable —
          esta línea aclara que la lista de 5 no es un techo, solo lo
          habilitado hoy. */}
      <p className="text-xs text-muted-foreground">{t("onboarding.step1.currencyRequestHint")}</p>
    </div>
  );
}

export { CurrencySelector };
