import { zodResolver } from "@hookform/resolvers/zod";
import {
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  splitE164,
} from "@sellpoint/shared";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import type { TenantBlock, UpdateTenantInput } from "@/lib/tenant/api";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import { getCuratedTimezones, resolveCountryTimezones } from "@/lib/tenant/markets";
import { type BusinessDetailsValues, businessDetailsSchema } from "@/lib/tenant/schemas";
import type { AuthUser } from "@/stores/auth.store";

/**
 * "Datos del negocio" en Mi perfil (Carlos, 2026-08-25). Tarjeta APARTE de
 * "Tus datos": aquella habla de la persona (tu nombre, tu email), esta habla
 * de la empresa — mezclar ambas confunde de quién es cada dato.
 *
 * Lo que el wizard capturó una vez (nombre legal, identificación fiscal,
 * dirección) se edita aquí para siempre; el wizard no se toca.
 *
 * El teléfono se PINTA en dos partes (país con su dial + número nacional)
 * pero se GUARDA como un solo E.164 canónico (`+525512345678`): el split es
 * presentación, no modelo. El dial se preselecciona con el país del negocio,
 * que es también el desempate al descomponer un guardado — un dial no
 * identifica país ("1" es todo el NANP).
 *
 * Sin `tenants:manage` la tarjeta NO EXISTE — mismo criterio que el botón
 * Crear de los movimientos: deshabilitarla sugeriría que falta un clic, no
 * un permiso.
 *
 * El PATCH manda SOLO los campos modificados (dirtyFields): guardar no debe
 * ser una sobreescritura total — un admin con la pantalla abierta desde ayer
 * pisaría los cambios de otro en los campos que ni tocó. `useUpdateMyTenant`
 * re-sincroniza el store al terminar, así el resto de la app ve el tenant
 * fresco sin recargar.
 */

// Mismo respaldo que el wizard para un país NO curado: el catálogo IANA
// completo del runtime (no hay 418 traducciones que mantener).
const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");

/** El E.164 guardado, de vuelta a país + número para el formulario. */
function phoneFormDefaults(tenant: TenantBlock): { phoneCountry: string; phoneNumber: string } {
  if (tenant.phone) {
    const parts = splitE164(tenant.phone);
    if (parts) {
      const candidates = ISO_COUNTRY_CODES.filter(
        (code) => COUNTRY_DIAL_CODES[code] === parts.dialCode,
      );
      const tenantCountry = candidates.find((code) => code === tenant.country);
      return {
        phoneCountry: tenantCountry ?? candidates[0] ?? "",
        phoneNumber: parts.nationalNumber,
      };
    }
  }
  return { phoneCountry: tenant.country ?? "", phoneNumber: "" };
}

function BusinessDetails({ user }: { user: AuthUser }) {
  const { t, i18n } = useTranslation();
  const updateTenant = useUpdateMyTenant();
  const [apiError, setApiError] = useState<string | null>(null);
  const [sellWithoutStock, setSellWithoutStock] = useState(user.tenant.sellWithoutStock);
  const [usesLocations, setUsesLocations] = useState(user.tenant.usesLocations);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<BusinessDetailsValues>({
    resolver: zodResolver(businessDetailsSchema),
    defaultValues: {
      name: user.tenant.name,
      legalName: user.tenant.legalName ?? "",
      taxId: user.tenant.taxId ?? "",
      address: user.tenant.address ?? "",
      timezone: user.tenant.timezone,
      monthlySalesGoal: user.tenant.monthlySalesGoal ?? "",
      ...phoneFormDefaults(user.tenant),
    },
  });

  // Mismo patrón que el selector de país del wizard (step-business): nombres
  // vía Intl.DisplayNames en el locale del usuario — nunca se guardan.
  const countryOptions = useMemo(() => {
    const displayNames = new Intl.DisplayNames([i18n.language], { type: "region" });
    return [...ISO_COUNTRY_CODES]
      .map((code) => ({
        value: code,
        label: `${displayNames.of(code) ?? code} (+${COUNTRY_DIAL_CODES[code]})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [i18n.language]);

  // El país NO se edita (Carlos, 2026-08-26, segunda pasada): quedó fijo el
  // mismo día que nació editable — los impuestos por país del roadmap
  // dependerán de él, el mismo criterio que congeló la moneda. Solo se
  // muestra su nombre en el locale del usuario.
  const country = user.tenant.country ?? "";
  const countryName = useMemo(() => {
    if (country === "") {
      return "";
    }
    const displayNames = new Intl.DisplayNames([i18n.language], { type: "region" });
    return displayNames.of(country) ?? country;
  }, [country, i18n.language]);

  // Mismo criterio del wizard (step-business): zonas curadas con etiqueta
  // i18n; el resto del mundo con su identificador IANA crudo. Con el país
  // fijo, la lista tampoco cambia.
  const curatedZones = getCuratedTimezones(country);
  const countryZones = country ? resolveCountryTimezones(country) : undefined;
  const timezoneOptions = curatedZones
    ? curatedZones.map((tz) => ({ value: tz, label: t(`onboarding.step1.timezoneOptions.${tz}`) }))
    : (countryZones ?? ALL_TIMEZONES).map((tz) => ({ value: tz, label: tz }));

  if (!user.permissions.includes("tenants:manage")) {
    return null;
  }

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    setSucceeded(false);

    const patch: UpdateTenantInput = {};
    if (dirtyFields.timezone) patch.timezone = values.timezone;
    if (dirtyFields.name) patch.name = values.name.trim();
    if (dirtyFields.legalName) patch.legalName = values.legalName.trim();
    if (dirtyFields.taxId) patch.taxId = values.taxId.trim();
    if (dirtyFields.address) patch.address = values.address.trim();
    if (dirtyFields.monthlySalesGoal) {
      // Vacío BORRA (null) — mismo criterio que phone: capturar la meta una
      // vez no la vuelve obligatoria. La coma decimal se normaliza a punto.
      const meta = values.monthlySalesGoal.trim().replace(",", ".");
      patch.monthlySalesGoal = meta === "" ? null : Number(meta);
    }
    if (dirtyFields.phoneNumber || dirtyFields.phoneCountry) {
      // Componer el canónico: dial del país + número sin espacios. Número
      // vacío BORRA (null): el wizard nunca exigió el teléfono, capturarlo
      // una vez no lo vuelve obligatorio.
      const digits = values.phoneNumber.replaceAll(" ", "").trim();
      const composed =
        digits === ""
          ? null
          : `+${COUNTRY_DIAL_CODES[values.phoneCountry as CountryCode]}${digits}`;
      // Cambiar solo el país con el número vacío compone lo mismo que ya
      // había: no hay nada que mandar (y un PATCH vacío es 400).
      if (composed !== user.tenant.phone) {
        patch.phone = composed;
      }
    }

    if (Object.keys(patch).length === 0) {
      reset(values);
      return;
    }

    updateTenant.mutate(patch, {
      onSuccess: () => {
        setSucceeded(true);
        // `values` pasa a ser el nuevo punto de partida: isDirty vuelve a
        // false y el botón se apaga hasta el próximo cambio real.
        reset(values);
      },
      onError: (error: ApiError) => {
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  });

  return (
    <Card data-testid="business-details">
      <CardHeader>
        <CardTitle>{t("common.profile.business.title")}</CardTitle>
        <CardDescription>{t("common.profile.business.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
          {apiError && (
            <p
              role="alert"
              data-testid="business-details-error"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {apiError}
            </p>
          )}
          {succeeded && (
            <p
              role="status"
              data-testid="business-details-success"
              className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
            >
              {t("common.profile.business.success")}
            </p>
          )}
          {/* El país quedó FIJO: los impuestos por país dependerán de él,
              mismo criterio que la moneda. */}
          <div className="flex flex-col gap-2">
            <Label>{t("common.profile.business.country")}</Label>
            <p data-testid="business-country" className="text-sm">
              {countryName}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("common.profile.business.countryHint")}
            </p>
          </div>
          <TextField
            label={t("common.profile.business.name")}
            autoComplete="organization"
            error={errors.name?.message ? t(errors.name.message) : undefined}
            {...register("name")}
          />
          <TextField
            label={t("common.profile.business.legalName")}
            error={errors.legalName?.message ? t(errors.legalName.message) : undefined}
            {...register("legalName")}
          />
          <TextField
            label={t("common.profile.business.taxId")}
            error={errors.taxId?.message ? t(errors.taxId.message) : undefined}
            {...register("taxId")}
          />
          <TextField
            label={t("common.profile.business.address")}
            autoComplete="street-address"
            error={errors.address?.message ? t(errors.address.message) : undefined}
            {...register("address")}
          />
          <TextField
            label={t("common.profile.business.monthlySalesGoal")}
            hint={t("common.profile.business.monthlySalesGoalHint")}
            error={
              errors.monthlySalesGoal?.message ? t(errors.monthlySalesGoal.message) : undefined
            }
            inputMode="decimal"
            {...register("monthlySalesGoal")}
          />
          <SelectField
            label={t("common.profile.business.timezone")}
            options={[
              { value: "", label: t("common.profile.business.timezonePlaceholder") },
              ...timezoneOptions,
            ]}
            error={errors.timezone?.message ? t(errors.timezone.message) : undefined}
            {...register("timezone")}
          />
          {/* La moneda SOLO se muestra: se congela con la operación y
              editarla prometería una conversión que el sistema no hace. */}
          <div className="flex flex-col gap-2">
            <Label>{t("common.profile.business.currency")}</Label>
            <p data-testid="business-currency" className="text-sm">
              {t(`onboarding.step1.currencyOptions.${user.tenant.currency}`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("common.profile.business.currencyHint")}
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
            <SelectField
              className="sm:w-56 sm:shrink-0"
              label={t("common.profile.business.phoneCountry")}
              options={[
                { value: "", label: t("common.profile.business.phoneCountryPlaceholder") },
                ...countryOptions,
              ]}
              error={errors.phoneCountry?.message ? t(errors.phoneCountry.message) : undefined}
              {...register("phoneCountry")}
            />
            <TextField
              className="sm:flex-1"
              label={t("common.profile.business.phone")}
              type="tel"
              autoComplete="tel-national"
              inputMode="numeric"
              error={errors.phoneNumber?.message ? t(errors.phoneNumber.message) : undefined}
              {...register("phoneNumber")}
            />
          </div>
          {/* F7-POS-05: "Vender sin existencias" — decisión de Carlos
              (2026-08-27). Guardado INMEDIATO (fuera del form): es un toggle
              operativo, no un dato del wizard. En planes sin control de stock
              (Basic/Free) la venta sin existencias es del plan: se muestra
              activado y bloqueado. */}
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="sell-without-stock">
                {t("common.profile.business.sellWithoutStock")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {user.subscription.stockControl
                  ? t("common.profile.business.sellWithoutStockHint")
                  : t("common.profile.business.sellWithoutStockPlanNote")}
              </p>
            </div>
            <Checkbox
              id="sell-without-stock"
              aria-label={t("common.profile.business.sellWithoutStock")}
              checked={!user.subscription.stockControl || sellWithoutStock}
              disabled={!user.subscription.stockControl || updateTenant.isPending}
              onCheckedChange={(checked) => {
                const next = checked === true;
                setSellWithoutStock(next);
                updateTenant.mutate(
                  { sellWithoutStock: next },
                  {
                    // Si el PATCH falla, el switch vuelve a decir la verdad.
                    onError: () => setSellWithoutStock(!next),
                  },
                );
              }}
            />
          </div>

          {/*
            Las UBICACIONES son de NEGOCIO y no de plan: cobrar por un campo
            de texto sería débil, y quien contrata el plan más chico para su
            mostrador es justo quien más necesita acordarse de dónde dejó las
            cosas. Apagado por defecto — un almacén sin pasillos no necesita
            un campo más en cada alta de producto.
          */}
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="uses-locations">{t("common.profile.business.usesLocations")}</Label>
              <p className="text-muted-foreground text-xs">
                {t("common.profile.business.usesLocationsHint")}
              </p>
            </div>
            <Checkbox
              id="uses-locations"
              aria-label={t("common.profile.business.usesLocations")}
              checked={usesLocations}
              disabled={updateTenant.isPending}
              onCheckedChange={(checked) => {
                const next = checked === true;
                setUsesLocations(next);
                updateTenant.mutate(
                  { usesLocations: next },
                  { onError: () => setUsesLocations(!next) },
                );
              }}
            />
          </div>

          <Button type="submit" disabled={!isDirty || updateTenant.isPending}>
            {updateTenant.isPending
              ? t("common.form.submitting")
              : t("common.profile.business.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { BusinessDetails };
