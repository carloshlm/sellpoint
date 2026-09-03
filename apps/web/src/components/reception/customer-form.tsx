import {
  ageFromBirthDate,
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  localCalendarDate,
  splitE164,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
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

type Errores = Partial<
  Record<"firstName" | "lastNamePaternal" | "birthDate" | "phone" | "email", string>
>;

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
}: {
  customer?: Customer;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const tenantCountry = useAuthStore((state) => state.user?.tenant.country ?? null);
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const [firstName, setFirstName] = useState(customer?.firstName ?? "");
  const [lastNamePaternal, setLastNamePaternal] = useState(customer?.lastNamePaternal ?? "");
  const [lastNameMaternal, setLastNameMaternal] = useState(customer?.lastNameMaternal ?? "");
  const [birthDate, setBirthDate] = useState(customer?.birthDate ?? "");
  const initialPhone = phonePartsOf(customer?.phone, tenantCountry);
  const [phoneCountry, setPhoneCountry] = useState(initialPhone.country);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.number);
  const [email, setEmail] = useState(customer?.email ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [errores, setErrores] = useState<Errores>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);

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
      lastNamePaternal,
      lastNameMaternal,
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
        lastNamePaternal: valores.lastNamePaternal,
        ...(valores.lastNameMaternal ? { lastNameMaternal: valores.lastNameMaternal } : {}),
        ...(valores.birthDate ? { birthDate: valores.birthDate } : {}),
        ...(telefono.phone ? { phone: telefono.phone } : {}),
        ...(valores.email ? { email: valores.email } : {}),
        ...(valores.notes ? { notes: valores.notes } : {}),
      };
      createCustomer.mutate(input, { onSuccess: onDone, onError });
      return;
    }

    // Solo lo que cambió: vacío pasa a null (se limpia), igual no viaja.
    const cambios: UpdateCustomerInput = {};
    if (valores.firstName !== customer.firstName) cambios.firstName = valores.firstName;
    if (valores.lastNamePaternal !== customer.lastNamePaternal) {
      cambios.lastNamePaternal = valores.lastNamePaternal;
    }
    const maternal = valores.lastNameMaternal || null;
    if (maternal !== customer.lastNameMaternal) cambios.lastNameMaternal = maternal;
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
      {/* De a pares, como Servicios: el ancho lo da la tarjeta, no el form. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("reception.form.firstName")}
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          error={errores.firstName}
          required
        />
        <TextField
          label={t("reception.form.lastNamePaternal")}
          value={lastNamePaternal}
          onChange={(event) => setLastNamePaternal(event.target.value)}
          error={errores.lastNamePaternal}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("reception.form.lastNameMaternal")}
          value={lastNameMaternal}
          onChange={(event) => setLastNameMaternal(event.target.value)}
        />
        <TextField
          type="date"
          label={t("reception.form.birthDate")}
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <PhonePartsField
          countryLabel={t("reception.form.phoneCountry")}
          countryPlaceholder={t("reception.form.phoneCountryPlaceholder")}
          numberLabel={t("reception.form.phone")}
          country={phoneCountry}
          number={phoneNumber}
          onCountryChange={setPhoneCountry}
          onNumberChange={setPhoneNumber}
          numberError={errores.phone}
        />
        <TextField
          type="email"
          label={t("reception.form.email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errores.email}
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
