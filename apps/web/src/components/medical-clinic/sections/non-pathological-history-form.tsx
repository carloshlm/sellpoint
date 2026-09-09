import {
  ACTIVITY_LEVELS,
  ALCOHOL_STATUSES,
  BLOOD_TYPES,
  DRUG_STATUSES,
  HOUSING_MATERIALS,
  HOUSING_SERVICES,
  HOUSING_TYPES,
  IMMUNIZATION_STATUSES,
  parseMeasure,
  QUALITY_LEVELS,
  SMOKING_STATUSES,
  smokingIndex,
} from "@sellpoint/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { type NumberRule, numberFieldError, numberFieldMessage } from "@/lib/measure";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const objeto = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const ANIO: NumberRule = { decimals: 0, min: 1900, max: new Date().getUTCFullYear() };
const RESIDENTES: NumberRule = { decimals: 0, min: 1, max: 50 };
const CUARTOS: NumberRule = { decimals: 0, min: 1, max: 30 };
const CIGARROS: NumberRule = { decimals: 0, min: 1, max: 200 };
const ANIOS_FUMANDO: NumberRule = { decimals: 0, min: 1, max: 100 };

/**
 * F9-CLINIC-HC-08 — Antecedentes Personales No Patológicos: vivienda,
 * hábitos, consumo y otros. Todo opcional; lo vacío se omite. El índice
 * tabáquico se calcula al lado y NO se guarda (`smokingIndex` en shared).
 * Quien nunca fumó no tiene cigarros ni años: esos campos ni se dibujan.
 */
export function NonPathologicalHistoryForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const k = (sufijo: string, args?: Record<string, string>) =>
    t(`medicalClinic.forms.nonPathologicalHistory.${sufijo}`, args);
  const vivienda = objeto(initialData.housing);
  const zoonosis = objeto(initialData.zoonosis);
  const tabaco = objeto(initialData.smoking);
  const alcohol = objeto(initialData.alcohol);
  const drogas = objeto(initialData.drugs);

  const [housingType, setHousingType] = useState(texto(vivienda.type));
  const [materials, setMaterials] = useState(texto(vivienda.materials));
  const [services, setServices] = useState<string[]>(
    Array.isArray(vivienda.services) ? (vivienda.services as string[]) : [],
  );
  const [residents, setResidents] = useState(texto(vivienda.residents));
  const [rooms, setRooms] = useState(texto(vivienda.rooms));
  const [hasAnimals, setHasAnimals] = useState(zoonosis.has === true);
  const [animals, setAnimals] = useState(texto(zoonosis.animals));
  const [diet, setDiet] = useState(texto(initialData.diet));
  const [dietNotes, setDietNotes] = useState(texto(initialData.dietNotes));
  const [hygiene, setHygiene] = useState(texto(initialData.hygiene));
  const [physicalActivity, setPhysicalActivity] = useState(texto(initialData.physicalActivity));
  const [physicalActivityNotes, setPhysicalActivityNotes] = useState(
    texto(initialData.physicalActivityNotes),
  );
  const [immunizations, setImmunizations] = useState(texto(initialData.immunizations));
  const [immunizationsNotes, setImmunizationsNotes] = useState(
    texto(initialData.immunizationsNotes),
  );
  const [smokingStatus, setSmokingStatus] = useState(texto(tabaco.status));
  const [cigarettesPerDay, setCigarettesPerDay] = useState(texto(tabaco.cigarettesPerDay));
  const [smokingYears, setSmokingYears] = useState(texto(tabaco.years));
  const [quitYear, setQuitYear] = useState(texto(tabaco.quitYear));
  const [alcoholStatus, setAlcoholStatus] = useState(texto(alcohol.status));
  const [alcoholNotes, setAlcoholNotes] = useState(texto(alcohol.notes));
  const [drugStatus, setDrugStatus] = useState(texto(drogas.status));
  const [substances, setSubstances] = useState(texto(drogas.substances));
  const [bloodType, setBloodType] = useState(texto(initialData.bloodType));
  const [religion, setReligion] = useState(texto(initialData.religion));
  const [notes, setNotes] = useState(texto(initialData.notes));

  const opciones = (prefijo: string, valores: readonly string[]) => [
    { value: "", label: t("medicalClinic.forms.chooseOption") },
    ...valores.map((v) => ({ value: v, label: k(`${prefijo}.${v}`) })),
  ];
  const errorDe = (raw: string, regla: NumberRule) => {
    const e = numberFieldError(raw, regla);
    return e ? numberFieldMessage(e, t) : undefined;
  };
  const fuma = smokingStatus === "current" || smokingStatus === "former";
  const indice = fuma
    ? smokingIndex(parseMeasure(cigarettesPerDay, 0), parseMeasure(smokingYears, 0))
    : null;
  const errores = [
    errorDe(residents, RESIDENTES),
    errorDe(rooms, CUARTOS),
    ...(fuma ? [errorDe(cigarettesPerDay, CIGARROS), errorDe(smokingYears, ANIOS_FUMANDO)] : []),
    ...(smokingStatus === "former" ? [errorDe(quitYear, ANIO)] : []),
  ];

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (errores.some((e) => e !== undefined)) return;
    const data: Record<string, unknown> = {};
    const casa: Record<string, unknown> = {};
    if (housingType) casa.type = housingType;
    if (materials) casa.materials = materials;
    const servicios = HOUSING_SERVICES.filter((s) => services.includes(s));
    if (servicios.length > 0) casa.services = servicios;
    if (residents.trim()) casa.residents = Number(residents);
    if (rooms.trim()) casa.rooms = Number(rooms);
    if (Object.keys(casa).length > 0) data.housing = casa;
    if (hasAnimals)
      data.zoonosis = { has: true, ...(animals.trim() && { animals: animals.trim() }) };
    if (diet) data.diet = diet;
    if (dietNotes.trim()) data.dietNotes = dietNotes.trim();
    if (hygiene) data.hygiene = hygiene;
    if (physicalActivity) data.physicalActivity = physicalActivity;
    if (physicalActivityNotes.trim()) data.physicalActivityNotes = physicalActivityNotes.trim();
    if (immunizations) data.immunizations = immunizations;
    if (immunizationsNotes.trim()) data.immunizationsNotes = immunizationsNotes.trim();
    if (smokingStatus) {
      data.smoking = {
        status: smokingStatus,
        ...(fuma && cigarettesPerDay.trim() && { cigarettesPerDay: Number(cigarettesPerDay) }),
        ...(fuma && smokingYears.trim() && { years: Number(smokingYears) }),
        ...(smokingStatus === "former" && quitYear.trim() && { quitYear: Number(quitYear) }),
      };
    }
    if (alcoholStatus) {
      data.alcohol = {
        status: alcoholStatus,
        ...(alcoholNotes.trim() && { notes: alcoholNotes.trim() }),
      };
    }
    if (drugStatus) {
      data.drugs = {
        status: drugStatus,
        ...(substances.trim() && { substances: substances.trim() }),
      };
    }
    if (bloodType) data.bloodType = bloodType;
    if (religion.trim()) data.religion = religion.trim();
    if (notes.trim()) data.notes = notes.trim();
    onSubmit(data);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("housing")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={k("housingType")}
              options={opciones("housingTypeOptions", HOUSING_TYPES)}
              value={housingType}
              onChange={(e) => setHousingType(e.target.value)}
            />
            <SelectField
              label={k("materials")}
              options={opciones("materialsOptions", HOUSING_MATERIALS)}
              value={materials}
              onChange={(e) => setMaterials(e.target.value)}
            />
            <NumberField
              label={k("residents")}
              decimals={0}
              value={residents}
              onChange={setResidents}
              error={errorDe(residents, RESIDENTES)}
            />
            <NumberField
              label={k("rooms")}
              decimals={0}
              value={rooms}
              onChange={setRooms}
              error={errorDe(rooms, CUARTOS)}
              hint={k("roomsHint")}
            />
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-muted-foreground text-xs">{k("services")}</legend>
            {HOUSING_SERVICES.map((servicio) => {
              const inputId = `${id}-${servicio}`;
              return (
                <div key={servicio} className="flex items-center gap-1.5">
                  <Checkbox
                    id={inputId}
                    checked={services.includes(servicio)}
                    onCheckedChange={(next) =>
                      setServices(
                        next === true
                          ? [...services, servicio]
                          : services.filter((s) => s !== servicio),
                      )
                    }
                  />
                  <Label htmlFor={inputId} className="font-normal">
                    {k(`servicesOptions.${servicio}`)}
                  </Label>
                </div>
              );
            })}
          </fieldset>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-animals`}
                checked={hasAnimals}
                onCheckedChange={(next) => setHasAnimals(next === true)}
              />
              <Label htmlFor={`${id}-animals`} className="font-normal">
                {k("zoonosis")}
              </Label>
            </div>
            {hasAnimals ? (
              <TextField
                label={k("animals")}
                value={animals}
                onChange={(e) => setAnimals(e.target.value)}
                maxLength={120}
              />
            ) : null}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("habits")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={k("diet")}
              options={opciones("qualityOptions", QUALITY_LEVELS)}
              value={diet}
              onChange={(e) => setDiet(e.target.value)}
            />
            <TextField
              label={k("dietNotes")}
              value={dietNotes}
              onChange={(e) => setDietNotes(e.target.value)}
              maxLength={300}
            />
            <SelectField
              label={k("hygiene")}
              options={opciones("qualityOptions", QUALITY_LEVELS)}
              value={hygiene}
              onChange={(e) => setHygiene(e.target.value)}
            />
            <SelectField
              label={k("physicalActivity")}
              options={opciones("activityOptions", ACTIVITY_LEVELS)}
              value={physicalActivity}
              onChange={(e) => setPhysicalActivity(e.target.value)}
            />
            <TextField
              label={k("physicalActivityNotes")}
              value={physicalActivityNotes}
              onChange={(e) => setPhysicalActivityNotes(e.target.value)}
              maxLength={200}
            />
            <SelectField
              label={k("immunizations")}
              options={opciones("immunizationOptions", IMMUNIZATION_STATUSES)}
              value={immunizations}
              onChange={(e) => setImmunizations(e.target.value)}
            />
            <TextField
              className="sm:col-span-2"
              label={k("immunizationsNotes")}
              value={immunizationsNotes}
              onChange={(e) => setImmunizationsNotes(e.target.value)}
              maxLength={300}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("consumption")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={k("smoking")}
              options={opciones("smokingOptions", SMOKING_STATUSES)}
              value={smokingStatus}
              onChange={(e) => setSmokingStatus(e.target.value)}
            />
            {fuma ? (
              <>
                <NumberField
                  label={k("cigarettesPerDay")}
                  decimals={0}
                  value={cigarettesPerDay}
                  onChange={setCigarettesPerDay}
                  error={errorDe(cigarettesPerDay, CIGARROS)}
                />
                <NumberField
                  label={k("smokingYears")}
                  decimals={0}
                  value={smokingYears}
                  onChange={setSmokingYears}
                  error={errorDe(smokingYears, ANIOS_FUMANDO)}
                  hint={indice !== null ? k("smokingIndex", { index: String(indice) }) : undefined}
                  hintTone={indice !== null && indice >= 20 ? "warning" : "muted"}
                />
              </>
            ) : null}
            {smokingStatus === "former" ? (
              <NumberField
                label={k("quitYear")}
                decimals={0}
                value={quitYear}
                onChange={setQuitYear}
                error={errorDe(quitYear, ANIO)}
              />
            ) : null}
            <SelectField
              label={k("alcohol")}
              options={opciones("alcoholOptions", ALCOHOL_STATUSES)}
              value={alcoholStatus}
              onChange={(e) => setAlcoholStatus(e.target.value)}
            />
            <TextField
              label={k("alcoholNotes")}
              value={alcoholNotes}
              onChange={(e) => setAlcoholNotes(e.target.value)}
              maxLength={200}
            />
            <SelectField
              label={k("drugs")}
              options={opciones("drugOptions", DRUG_STATUSES)}
              value={drugStatus}
              onChange={(e) => setDrugStatus(e.target.value)}
            />
            <TextField
              label={k("substances")}
              value={substances}
              onChange={(e) => setSubstances(e.target.value)}
              maxLength={200}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("others")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={k("bloodType")}
              options={[
                { value: "", label: t("medicalClinic.forms.chooseOption") },
                ...BLOOD_TYPES.map((b) => ({
                  value: b,
                  label: b === "unknown" ? k("bloodTypeUnknown") : b,
                })),
              ]}
              value={bloodType}
              onChange={(e) => setBloodType(e.target.value)}
            />
            <TextField
              label={k("religion")}
              value={religion}
              onChange={(e) => setReligion(e.target.value)}
              maxLength={80}
            />
            <TextAreaField
              className="sm:col-span-2"
              label={k("notes")}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
        </fieldset>
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
