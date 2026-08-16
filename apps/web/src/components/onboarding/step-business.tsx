import { zodResolver } from "@hookform/resolvers/zod";
import { type Currency, ISO_COUNTRY_CODES, localeToBcp47 } from "@sellpoint/shared";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { TenantBlock } from "@/lib/tenant/api";
import {
  getCuratedTimezones,
  getDefaultCurrency,
  getTaxIdAbbreviation,
  resolveCountryTimezones,
} from "@/lib/tenant/markets";
import { type BusinessStepValues, businessStepSchema } from "@/lib/tenant/schemas";
import { CurrencySelector } from "./currency-selector";

// Catálogo curado de zonas horarias por país (decisiones de Carlos,
// 2026-08-16): vive en `@/lib/tenant/markets` (`CURATED_TIMEZONES`), acá
// solo se traduce cada IANA id con las MISMAS 45 claves i18n que existían
// antes de reorganizar el catálogo plano en un mapa país→zonas
// (`onboarding.step1.timezoneOptions.*`, es/en) — ver `markets.ts` para el
// detalle de qué zonas trae cada país curado.
const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");
const ALL_TIMEZONES_SET = new Set(ALL_TIMEZONES);

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

interface StepBusinessProps {
  tenant: TenantBlock;
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: (values: BusinessStepValues) => void;
}

/**
 * F1-WEB-ONBOARD-01, paso 1. A4 del design: `defaultValues` SIEMPRE salen
 * del tenant del server (nunca de un draft en memoria); el container le pasa
 * `key={effectiveStep}` para forzar un remount limpio en cada paso.
 *
 * `country` (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2): PRIMER campo,
 * requerido. Maneja tres derivaciones cuando el usuario CAMBIA de país (no
 * al montar — `defaultValues` respeta A4 y nunca se pisa solo, decisión 7):
 * 1. Etiqueta de identificación fiscal (sigla por país curado, genérica sin
 *    sigla para el resto del mundo).
 * 2. Zona horaria: país curado → SOLO sus zonas (si la actual no pertenece,
 *    se resetea a la única del país o a elegir); país no curado → catálogo
 *    IANA completo con la del navegador preseleccionada si es válida.
 * 3. Moneda: se re-preselecciona SOLO si el usuario no la tocó
 *    explícitamente — un `ref` booleano (no estado, no dispara re-render
 *    por sí solo) marca el toque real en el `onChange` de `CurrencySelector`.
 */
function StepBusiness({ tenant, isSubmitting, formError, onSubmit }: StepBusinessProps) {
  const { t, i18n } = useTranslation();
  const bcp47 = localeToBcp47(i18n.language.startsWith("en") ? "en" : "es");

  const defaultValues = React.useMemo<BusinessStepValues>(
    () => ({
      country: tenant.country ?? "",
      legalName: tenant.legalName ?? "",
      taxId: tenant.taxId ?? "",
      address: tenant.address ?? "",
      timezone: tenant.timezone,
      currency: tenant.currency as Currency,
    }),
    [tenant],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BusinessStepValues>({
    resolver: zodResolver(businessStepSchema),
    defaultValues,
  });

  const country = watch("country");
  const currency = watch("currency");

  // Decisión 7: solo re-preselecciona la moneda si el usuario NO la tocó a
  // mano. `ref`, no `useState` — tocar la moneda no debe disparar un
  // re-render extra, solo cambiar el comportamiento de la próxima derivación.
  const currencyTouchedRef = React.useRef(false);

  // Deriva timezone/moneda SOLO ante un cambio real de país post-mount — NO
  // al montar (A4: `defaultValues` ya trae lo que el server tiene, nunca se
  // pisa solo). `previousCountryRef` arranca en el país inicial del tenant
  // para que el primer render nunca dispare la derivación.
  const previousCountryRef = React.useRef(country);
  React.useEffect(() => {
    if (country === previousCountryRef.current) {
      return;
    }
    previousCountryRef.current = country;

    const countryZones = country ? resolveCountryTimezones(country) : undefined;
    if (countryZones) {
      const currentTimezone = watch("timezone");
      if (!countryZones.includes(currentTimezone)) {
        // Con una sola zona no hay nada que elegir; con varias, se intenta la
        // del navegador y si tampoco es de ese país, se deja vacío para que
        // el usuario elija (nunca se le adjudica una zona ajena en silencio).
        const browserTimezone = detectBrowserTimezone();
        const fallback = countryZones.includes(browserTimezone) ? browserTimezone : "";
        setValue("timezone", countryZones.length === 1 ? (countryZones.at(0) ?? "") : fallback, {
          shouldValidate: true,
        });
      }
    } else {
      const browserTimezone = detectBrowserTimezone();
      setValue("timezone", ALL_TIMEZONES_SET.has(browserTimezone) ? browserTimezone : "", {
        shouldValidate: true,
      });
    }

    if (!currencyTouchedRef.current) {
      setValue("currency", getDefaultCurrency(country), { shouldValidate: true });
    }
    // `watch`/`setValue` son referencias estables de react-hook-form — se
    // listan para satisfacer el linter, no porque cambien entre renders.
  }, [country, watch, setValue]);

  const submit = handleSubmit((values) => onSubmit(values));

  const countryOptions = React.useMemo(() => {
    const displayNames = new Intl.DisplayNames([bcp47], { type: "region" });
    return [...ISO_COUNTRY_CODES]
      .map((code) => ({ value: code, label: displayNames.of(code) ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label, bcp47));
  }, [bcp47]);

  const taxIdAbbreviation = getTaxIdAbbreviation(country);
  const taxIdLabel = taxIdAbbreviation
    ? t("onboarding.step1.taxIdWithAbbr", { abbr: taxIdAbbreviation })
    : t("onboarding.step1.taxId");

  // Las zonas de un país curado tienen etiqueta propia en i18n; las del resto
  // del mundo se muestran con su identificador IANA (no hay 418 traducciones).
  const curatedZones = getCuratedTimezones(country);
  const countryZones = resolveCountryTimezones(country);
  const timezoneOptions = curatedZones
    ? curatedZones.map((tz) => ({ value: tz, label: t(`onboarding.step1.timezoneOptions.${tz}`) }))
    : (countryZones ?? ALL_TIMEZONES).map((tz) => ({ value: tz, label: tz }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step1.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step1.subtitle")}</p>
      </div>
      {formError && (
        <p
          role="alert"
          data-testid="step-business-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <SelectField
        label={t("onboarding.step1.country")}
        error={errors.country?.message ? t(errors.country.message) : undefined}
        options={[
          { value: "", label: t("onboarding.step1.countryPlaceholder") },
          ...countryOptions,
        ]}
        {...register("country")}
      />
      <TextField
        label={t("onboarding.step1.legalName")}
        error={errors.legalName?.message ? t(errors.legalName.message) : undefined}
        {...register("legalName")}
      />
      <TextField
        label={taxIdLabel}
        error={errors.taxId?.message ? t(errors.taxId.message) : undefined}
        {...register("taxId")}
      />
      <TextField
        label={t("onboarding.step1.address")}
        error={errors.address?.message ? t(errors.address.message) : undefined}
        {...register("address")}
      />
      <SelectField
        label={t("onboarding.step1.timezone")}
        error={errors.timezone?.message ? t(errors.timezone.message) : undefined}
        options={timezoneOptions}
        {...register("timezone")}
      />
      <CurrencySelector
        value={currency}
        onChange={(next) => {
          currencyTouchedRef.current = true;
          setValue("currency", next, { shouldValidate: true });
        }}
        error={errors.currency?.message ? t(errors.currency.message) : undefined}
      />
      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("common.form.submitting") : t("onboarding.step1.continue")}
        </Button>
      </div>
    </form>
  );
}

export { StepBusiness };
