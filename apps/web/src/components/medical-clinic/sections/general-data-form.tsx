import {
  COUNTRY_DIAL_CODES,
  type CountryCode,
  EDUCATION_LEVELS,
  ISO_COUNTRY_CODES,
  MARITAL_STATUSES,
  MEDICAL_SEXES,
  splitE164,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { composePhone } from "@/lib/reception/schemas";
import { useAuthStore } from "@/stores/auth.store";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** El E.164 guardado, de vuelta a país + número (mismo patrón que el cliente de Recepción). */
function phonePartsOf(phone: string, tenantCountry: string): { country: string; number: string } {
  const parts = phone ? splitE164(phone) : null;
  if (parts) {
    const candidates = ISO_COUNTRY_CODES.filter(
      (code) => COUNTRY_DIAL_CODES[code as CountryCode] === parts.dialCode,
    );
    return {
      country: candidates.find((c) => c === tenantCountry) ?? candidates[0] ?? "",
      number: parts.nationalNumber,
    };
  }
  return { country: tenantCountry, number: "" };
}

/**
 * F9-CLINIC-WEB-14 — Datos Generales. Todo es opcional: lo vacío se OMITE
 * del objeto (el schema del API acepta claves ausentes, no strings vacíos).
 */
export function GeneralDataForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const tenantCountry = useAuthStore((s) => s.user?.tenant.country ?? "");
  const telefonoInicial = phonePartsOf(texto(initialData.emergencyContactPhone), tenantCountry);

  const [sex, setSex] = useState(texto(initialData.sex));
  const [maritalStatus, setMaritalStatus] = useState(texto(initialData.maritalStatus));
  const [occupation, setOccupation] = useState(texto(initialData.occupation));
  const [education, setEducation] = useState(texto(initialData.education));
  const [address, setAddress] = useState(texto(initialData.address));
  const [emergencyContactName, setEmergencyContactName] = useState(
    texto(initialData.emergencyContactName),
  );
  const [phoneCountry, setPhoneCountry] = useState(telefonoInicial.country);
  const [phoneNumber, setPhoneNumber] = useState(telefonoInicial.number);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const opciones = (prefijo: string, valores: readonly string[]) => [
    { value: "", label: t("medicalClinic.forms.chooseOption") },
    ...valores.map((v) => ({ value: v, label: t(`${prefijo}.${v}`) })),
  ];

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const telefono = composePhone(phoneCountry, phoneNumber);
    if (telefono.error) {
      setPhoneError(t(telefono.error));
      return;
    }
    setPhoneError(null);
    const data: Record<string, unknown> = {};
    const poner = (clave: string, valor: string | null) => {
      if (valor && valor.trim() !== "") data[clave] = valor.trim();
    };
    poner("sex", sex);
    poner("maritalStatus", maritalStatus);
    poner("occupation", occupation);
    poner("education", education);
    poner("address", address);
    poner("emergencyContactName", emergencyContactName);
    poner("emergencyContactPhone", telefono.phone);
    onSubmit(data);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("medicalClinic.forms.generalData.sex")}
          hint={t("medicalClinic.forms.generalData.sexHint")}
          options={opciones("medicalClinic.forms.generalData.sexOptions", MEDICAL_SEXES)}
          value={sex}
          onChange={(e) => setSex(e.target.value)}
        />
        <SelectField
          label={t("medicalClinic.forms.generalData.maritalStatus")}
          options={opciones(
            "medicalClinic.forms.generalData.maritalStatusOptions",
            MARITAL_STATUSES,
          )}
          value={maritalStatus}
          onChange={(e) => setMaritalStatus(e.target.value)}
        />
        <TextField
          label={t("medicalClinic.forms.generalData.occupation")}
          value={occupation}
          onChange={(e) => setOccupation(e.target.value)}
          maxLength={120}
        />
        <SelectField
          label={t("medicalClinic.forms.generalData.education")}
          options={opciones("medicalClinic.forms.generalData.educationOptions", EDUCATION_LEVELS)}
          value={education}
          onChange={(e) => setEducation(e.target.value)}
        />
        <TextField
          className="sm:col-span-2"
          label={t("medicalClinic.forms.generalData.address")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={300}
        />
        <TextField
          className="sm:col-span-2"
          label={t("medicalClinic.forms.generalData.emergencyContactName")}
          value={emergencyContactName}
          onChange={(e) => setEmergencyContactName(e.target.value)}
          maxLength={120}
        />
        <div className="sm:col-span-2">
          <PhonePartsField
            countryLabel={t("medicalClinic.forms.generalData.emergencyContactPhoneCountry")}
            countryPlaceholder={t("medicalClinic.forms.chooseOption")}
            numberLabel={t("medicalClinic.forms.generalData.emergencyContactPhone")}
            country={phoneCountry}
            number={phoneNumber}
            onCountryChange={setPhoneCountry}
            onNumberChange={(n) => {
              setPhoneNumber(n);
              setPhoneError(null);
            }}
            numberError={phoneError ?? undefined}
          />
        </div>
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
