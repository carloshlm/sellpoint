import { COUNTRY_DIAL_CODES, ISO_COUNTRY_CODES } from "@sellpoint/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";

/**
 * El par país (con su dial) + número nacional, presentacional y controlado
 * (2026-08-26). Extraído del patrón de "Datos del negocio": el teléfono se
 * PINTA en dos partes pero se guarda como UN E.164 canónico — la composición
 * y la descomposición son del contenedor, este componente solo captura.
 */
interface PhonePartsFieldProps {
  countryLabel: string;
  countryPlaceholder: string;
  numberLabel: string;
  country: string;
  number: string;
  onCountryChange: (country: string) => void;
  onNumberChange: (number: string) => void;
  numberError?: string;
}

function PhonePartsField({
  countryLabel,
  countryPlaceholder,
  numberLabel,
  country,
  number,
  onCountryChange,
  onNumberChange,
  numberError,
}: PhonePartsFieldProps) {
  const { i18n } = useTranslation();

  const countryOptions = useMemo(() => {
    const displayNames = new Intl.DisplayNames([i18n.language], { type: "region" });
    return [...ISO_COUNTRY_CODES]
      .map((code) => ({
        value: code,
        label: `${displayNames.of(code) ?? code} (+${COUNTRY_DIAL_CODES[code]})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [i18n.language]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
      <SelectField
        className="sm:w-56 sm:shrink-0"
        label={countryLabel}
        options={[{ value: "", label: countryPlaceholder }, ...countryOptions]}
        value={country}
        onChange={(event) => onCountryChange(event.target.value)}
      />
      <TextField
        className="sm:flex-1"
        label={numberLabel}
        type="tel"
        autoComplete="tel-national"
        inputMode="numeric"
        error={numberError}
        value={number}
        onChange={(event) => onNumberChange(event.target.value)}
      />
    </div>
  );
}

export { PhonePartsField };
