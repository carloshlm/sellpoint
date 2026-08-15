import { zodResolver } from "@hookform/resolvers/zod";
import type { Currency } from "@sellpoint/shared";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { TenantBlock } from "@/lib/tenant/api";
import { type BusinessStepValues, businessStepSchema } from "@/lib/tenant/schemas";
import { CurrencySelector } from "./currency-selector";

const TIMEZONE_OPTIONS = [
  "America/Mexico_City",
  "America/Tijuana",
  "America/Monterrey",
  "America/Cancun",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
] as const;

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
 */
function StepBusiness({ tenant, isSubmitting, formError, onSubmit }: StepBusinessProps) {
  const { t } = useTranslation();

  const defaultValues = React.useMemo<BusinessStepValues>(
    () => ({
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

  const currency = watch("currency");

  const submit = handleSubmit((values) => onSubmit(values));

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
      <TextField
        label={t("onboarding.step1.legalName")}
        error={errors.legalName?.message ? t(errors.legalName.message) : undefined}
        {...register("legalName")}
      />
      <TextField
        label={t("onboarding.step1.taxId")}
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
        options={TIMEZONE_OPTIONS.map((tz) => ({
          value: tz,
          label: t(`onboarding.step1.timezoneOptions.${tz}`),
        }))}
        {...register("timezone")}
      />
      <CurrencySelector
        value={currency}
        onChange={(next) => setValue("currency", next, { shouldValidate: true })}
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
