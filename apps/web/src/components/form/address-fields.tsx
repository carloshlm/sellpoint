import {
  type AddressField,
  addressRegionName,
  CA_REGIONS,
  MX_REGIONS,
  resolveAddressFormat,
  US_REGIONS,
} from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { cn } from "@/lib/utils";

/** Los cinco campos como TEXTO de formulario: vacío es «sin dato». */
export interface AddressValues {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
}

export const EMPTY_ADDRESS: AddressValues = {
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
};

interface AddressFieldsProps {
  /** El país del NEGOCIO: decide qué se pide, en qué orden y con qué etiqueta. */
  country: string | null | undefined;
  value: AddressValues;
  onChange: (field: AddressField, value: string) => void;
  /** Mensajes YA traducidos, por campo. */
  errors?: Partial<Record<AddressField, string>>;
  /**
   * La región tiene un solo dueño: en Canadá y Estados Unidos es fiscal y se
   * cambia en Impuestos (resiembra tasas). Con esto la lista se muestra
   * deshabilitada y el hint dice dónde cambiarla.
   */
  regionLocked?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Lo que el navegador entiende para autocompletar cada parte. */
const AUTOCOMPLETE: Record<AddressField, string> = {
  line1: "address-line1",
  line2: "address-line2",
  city: "address-level2",
  region: "address-level1",
  postalCode: "postal-code",
};

const FIELD_BY_TOKEN: Record<string, AddressField> = {
  A: "line1",
  D: "line2",
  C: "city",
  S: "region",
  Z: "postalCode",
};

/**
 * El orden de los campos sale del `fmt` del país, no de una lista fija: en
 * México el código postal va antes de la ciudad («06000 Ciudad de México») y
 * en Estados Unidos el ZIP cierra («Austin, TX 78701»). Pedirlos en el orden
 * en que la gente los escribe es la mitad de que se capturen bien.
 */
function fieldsInOrder(fmt: string): AddressField[] {
  return [...fmt.matchAll(/%([ADCSZ])/g)].map(
    (m) => FIELD_BY_TOKEN[m[1] as string] as AddressField,
  );
}

function regionOptions(country: string | null | undefined): { value: string; label: string }[] {
  const codes: readonly string[] =
    country === "MX"
      ? MX_REGIONS
      : country === "CA"
        ? CA_REGIONS
        : country === "US"
          ? US_REGIONS
          : [];
  return codes.map((value) => ({ value, label: addressRegionName(country, value) ?? value }));
}

/**
 * F1-ADDR-04 — la dirección de un negocio o de un almacén, en los campos que
 * su país usa (Carlos, 2026-09-08).
 *
 * Un cliente en Canadá pidió City, Postal Code y Address 2, y la creencia era
 * que «eso no existe en México». Existe, y México suma la colonia. Los tres
 * países piden lo mismo —calle, segunda línea, ciudad, región y código
 * postal— y solo cambian la etiqueta, el orden y la regla del CP: eso es lo
 * que decide `resolveAddressFormat` desde el catálogo de Google copiado en
 * shared. Los campos se llaman universal en la base; la etiqueta habla local.
 *
 * Presentacional y controlado, como `BirthDateField`: el formulario es dueño
 * del estado y lo conecta como ya hace con `CurrencySelector` (`watch` +
 * `setValue`). Por eso cambiar de país NO borra nada: solo cambian etiquetas,
 * orden y reglas, y el texto que la persona ya escribió sigue en su lugar.
 * La región es la excepción y la vacía el formulario, porque es del país.
 */
export function AddressFields({
  country,
  value,
  onChange,
  errors = {},
  regionLocked = false,
  disabled = false,
  className,
}: AddressFieldsProps) {
  const { t } = useTranslation();
  const format = resolveAddressFormat(country);
  const campos = fieldsInOrder(format.fmt).filter(
    (field) => field !== "region" || format.region !== null,
  );
  // Teclado numérico solo donde el código postal son puros dígitos (México,
  // España, Alemania…); Canadá y Reino Unido llevan letras, y el ZIP+4 lleva guion.
  const cpNumerico =
    format.postalCodePattern !== null &&
    !/[A-Za-z[\]\\-]/.test(format.postalCodePattern.source.replace(/\\d/g, ""));

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {campos.map((field) => {
        if (field === "region") {
          return (
            <SelectField
              key={field}
              label={t(`common.address.region.${format.region}`)}
              value={value.region}
              onChange={(event) => onChange("region", event.target.value)}
              options={[
                { value: "", label: t("common.address.region.placeholder") },
                ...regionOptions(country),
              ]}
              error={errors.region}
              hint={regionLocked ? t("common.address.regionLockedHint") : undefined}
              disabled={disabled || regionLocked}
              autoComplete={AUTOCOMPLETE.region}
            />
          );
        }
        const label =
          field === "line2"
            ? t(`common.address.line2.${format.line2}`)
            : field === "postalCode"
              ? t(`common.address.postalCode.${format.postalCode}`)
              : t(`common.address.${field}`);
        return (
          <TextField
            key={field}
            className={field === "line1" || field === "line2" ? "sm:col-span-2" : undefined}
            label={label}
            value={value[field]}
            onChange={(event) => onChange(field, event.target.value)}
            error={errors[field]}
            disabled={disabled}
            autoComplete={AUTOCOMPLETE[field]}
            inputMode={field === "postalCode" && cpNumerico ? "numeric" : undefined}
          />
        );
      })}
    </div>
  );
}
