import {
  ageFromBirthDate,
  asksSecondSurname,
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  localCalendarDate,
  splitE164,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BirthDateField } from "@/components/form/birth-date-field";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { TextField } from "@/components/form/text-field";
import {
  type CheckedContact,
  DuplicateContactCard,
} from "@/components/reception/duplicate-contact-card";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { LAST_NAME_LABEL_KEY, nameFormatOf } from "@/lib/name-format";
import type { CreateCustomerInput, Customer, UpdateCustomerInput } from "@/lib/reception/api";
import { useCreateCustomer, useUpdateCustomer } from "@/lib/reception/hooks";
import { composePhone, customerFormSchema } from "@/lib/reception/schemas";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";
import { useAuthStore } from "@/stores/auth.store";

/** El E.164 guardado, de vuelta a país + número (mismo patrón que almacenes). */
function phonePartsOf(
  phone: string | null | undefined,
  tenantCountry: string | null,
): { country: string; number: string } {
  if (phone) {
    const parts = splitE164(phone);
    if (parts) {
      const candidates = ISO_COUNTRY_CODES.filter(
        (code) => COUNTRY_DIAL_CODES[code as CountryCode] === parts.dialCode,
      );
      const matched = candidates.find((code) => code === tenantCountry);
      return { country: matched ?? candidates[0] ?? "", number: parts.nationalNumber };
    }
  }
  return { country: tenantCountry ?? "", number: "" };
}

type Errores = Partial<Record<"firstName" | "lastName" | "birthDate" | "phone" | "email", string>>;

/**
 * F9-RECEP-12 — alta y edición de cliente en el MISMO formulario, discriminado
 * por la prop `customer`. Pantalla completa, no modal (Carlos, 2026-09-02).
 *
 * «Fecha de nacimiento» con la edad calculada al lado, en vivo: lo que
 * Carlos pidió ver es la edad; lo que se guarda es la fecha, porque un
 * entero de edad se pudre solo. La edición manda al PATCH solo lo que cambió.
 */
export function CustomerForm({
  customer,
  onDone,
  onCancel,
  submitCreate,
}: {
  customer?: Customer;
  /** Recibe el cliente creado (react-query ya lo entregaba; solo faltaba el tipo). */
  onDone: (customer?: Customer) => void;
  onCancel: () => void;
  /**
   * F9-CLINIC-WEB-08: el consultorio da de alta por SU endpoint
   * (`POST /medical-clinic/patients`, llave `:attend`). Sin esta prop, el alta
   * de Recepción de siempre.
   */
  submitCreate?: (input: CreateCustomerInput) => Promise<Customer>;
}) {
  const { t } = useTranslation();
  // F1-NAME-08: la etiqueta del apellido la decide el país del negocio.
  const formatoDeNombre = nameFormatOf();
  // F1-NAME-09 — LA LEY: el FORMATO decide qué se PIDE, el DATO decide qué se
  // MUESTRA. Un segundo apellido ya guardado se ve y se edita aunque el país
  // sea de uno solo, y si el campo NO se dibuja su llave no viaja: esconder
  // jamás es borrar. Va con el valor PERSISTIDO, no con el del input, porque
  // si no el campo se esfumaría en el instante en que alguien lo vacía.
  const pideSegundoApellido =
    asksSecondSurname(formatoDeNombre) || (customer?.secondLastName ?? "") !== "";
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const tenantCountry = useAuthStore((state) => state.user?.tenant.country ?? null);
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const [firstName, setFirstName] = useState(customer?.firstName ?? "");
  const [lastName, setLastName] = useState(customer?.lastName ?? "");
  const [secondLastName, setSecondLastName] = useState(customer?.secondLastName ?? "");
  const [birthDate, setBirthDate] = useState(customer?.birthDate ?? "");
  const initialPhone = phonePartsOf(customer?.phone, tenantCountry);
  const [phoneCountry, setPhoneCountry] = useState(initialPhone.country);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.number);
  const [email, setEmail] = useState(customer?.email ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [errores, setErrores] = useState<Errores>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);
  // El contacto que se COMPRUEBA contra otros registros (Carlos, 2026-09-08).
  // Arranca con lo persistido, para que al editar se vea de entrada con quién
  // comparte teléfono o correo, y se actualiza al SALIR del campo: comprobar
  // tecla a tecla haría una consulta por letra sin que ninguna pueda
  // coincidir exacta hasta el final.
  const [contacto, setContacto] = useState<CheckedContact>({
    phone: customer?.phone ?? null,
    email: customer?.email ?? null,
  });
  const comprobarTelefono = () =>
    setContacto((previo) => ({ ...previo, phone: composePhone(phoneCountry, phoneNumber).phone }));
  const comprobarCorreo = () => {
    const limpio = email.trim();
    const valido = customerFormSchema.pick({ email: true }).safeParse({ email: limpio }).success;
    setContacto((previo) => ({ ...previo, email: valido && limpio ? limpio : null }));
  };

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const busy = createCustomer.isPending || updateCustomer.isPending;

  // La edad en vivo: con el día del negocio, igual que la calcula el API.
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && !Number.isNaN(Date.parse(birthDate));
  const edad = fechaValida
    ? ageFromBirthDate(birthDate, localCalendarDate(timeZone ?? "UTC", new Date()))
    : null;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorApi(null);
    const parsed = customerFormSchema.safeParse({
      firstName,
      lastName,
      secondLastName,
      birthDate,
      email,
      notes,
    });
    const telefono = composePhone(phoneCountry, phoneNumber);
    const nuevos: Errores = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0] as keyof Errores | undefined;
        if (campo && !nuevos[campo]) {
          nuevos[campo] = t(issue.message);
        }
      }
    }
    if (telefono.error) {
      nuevos.phone = t(telefono.error);
    }
    setErrores(nuevos);
    if (!parsed.success || telefono.error) {
      return;
    }

    const valores = parsed.data;
    const onError = (apiError: ApiError) => setErrorApi(apiError.message);

    if (!customer) {
      const input: CreateCustomerInput = {
        firstName: valores.firstName,
        lastName: valores.lastName,
        ...(pideSegundoApellido && valores.secondLastName
          ? { secondLastName: valores.secondLastName }
          : {}),
        ...(valores.birthDate ? { birthDate: valores.birthDate } : {}),
        ...(telefono.phone ? { phone: telefono.phone } : {}),
        ...(valores.email ? { email: valores.email } : {}),
        ...(valores.notes ? { notes: valores.notes } : {}),
      };
      if (submitCreate !== undefined) {
        submitCreate(input).then(onDone).catch(onError);
        return;
      }
      createCustomer.mutate(input, { onSuccess: onDone, onError });
      return;
    }

    // Solo lo que cambió: vacío pasa a null (se limpia), igual no viaja.
    const cambios: UpdateCustomerInput = {};
    if (valores.firstName !== customer.firstName) cambios.firstName = valores.firstName;
    if (valores.lastName !== customer.lastName) {
      cambios.lastName = valores.lastName;
    }
    // Defensa en PROFUNDIDAD, no la barrera principal: con la ley del dato
    // puesta el campo se dibuja siempre que haya algo que perder, así que este
    // `if` no es matable por un test. Protege del día en que alguien cambie la
    // condición de visibilidad y deje pasar un borrado silencioso.
    if (pideSegundoApellido) {
      const segundo = valores.secondLastName || null;
      if (segundo !== customer.secondLastName) cambios.secondLastName = segundo;
    }
    const nacimiento = valores.birthDate || null;
    if (nacimiento !== customer.birthDate) cambios.birthDate = nacimiento;
    if (telefono.phone !== customer.phone) cambios.phone = telefono.phone;
    const correo = valores.email || null;
    if (correo !== customer.email) cambios.email = correo;
    const notas = valores.notes || null;
    if (notas !== customer.notes) cambios.notes = notas;

    if (Object.keys(cambios).length === 0) {
      onDone();
      return;
    }
    updateCustomer.mutate({ id: customer.id, input: cambios }, { onSuccess: onDone, onError });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {errorApi && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {errorApi}
        </p>
      )}
      {/* Teléfono y correo ARRIBA del nombre (Carlos, 2026-09-08): identificar
          antes de capturar. Si la persona ya existe, se sabe antes de teclear
          apellidos y fecha de nacimiento. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PhonePartsField
          countryLabel={t("reception.form.phoneCountry")}
          countryPlaceholder={t("reception.form.phoneCountryPlaceholder")}
          numberLabel={t("reception.form.phone")}
          country={phoneCountry}
          number={phoneNumber}
          onCountryChange={setPhoneCountry}
          onNumberChange={setPhoneNumber}
          onNumberBlur={comprobarTelefono}
          numberError={errores.phone}
        />
        <TextField
          type="email"
          label={t("reception.form.email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={comprobarCorreo}
          error={errores.email}
        />
      </div>
      <DuplicateContactCard contact={contacto} excludeId={customer?.id} />
      {/* De a pares, como Servicios: el ancho lo da la tarjeta, no el form. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("common.name.firstName")}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          error={errores.firstName}
          required
        />
        <TextField
          label={t(LAST_NAME_LABEL_KEY[formatoDeNombre])}
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          error={errores.lastName}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {pideSegundoApellido && (
          <TextField
            label={t("common.name.secondLastName")}
            value={secondLastName}
            onChange={(event) => setSecondLastName(event.target.value)}
          />
        )}
        <BirthDateField
          label={t("reception.form.birthDate")}
          value={birthDate}
          onChange={setBirthDate}
          error={errores.birthDate}
          hint={
            edad !== null
              ? t("reception.form.ageLive", {
                  age: t("reception.customers.years", { count: edad }),
                })
              : undefined
          }
        />
      </div>
      <TextField
        label={t("reception.form.notes")}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
