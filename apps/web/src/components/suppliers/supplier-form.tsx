import {
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  isPostalCode,
  normalizeCode,
  normalizePostalCode,
  normalizeTaxId,
  resolveAddressFormat,
  splitE164,
  taxIdExample,
  taxIdLabel,
} from "@sellpoint/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { AddressFields } from "@/components/form/address-fields";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { TextField } from "@/components/form/text-field";
import { DuplicateSupplierCard } from "@/components/suppliers/duplicate-supplier-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import { useCatalogFields, useCatalogs } from "@/lib/catalogs/hooks";
import { fieldErrorsOf } from "@/lib/field-errors";
import type {
  CreateSupplierInput,
  Supplier,
  SupplierContactInput,
  UpdateSupplierInput,
} from "@/lib/suppliers/api";
import { useCreateSupplier, useUpdateSupplier } from "@/lib/suppliers/hooks";
import {
  composeSupplierPhone,
  SUPPLIER_EXTRA_CONTACTS_MAX,
  supplierContactSchema,
  supplierFormSchema,
} from "@/lib/suppliers/schemas";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";
import { useAuthStore } from "@/stores/auth.store";

/** El E.164 guardado, de vuelta a país + número (mismo patrón que clientes). */
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

type Errores = Partial<Record<"name" | "taxId" | "phone" | "email", string>>;

/** Un contacto adicional como TEXTO de formulario; `key` es su identidad en la lista. */
interface ExtraContact {
  key: number;
  name: string;
  phoneCountry: string;
  phoneNumber: string;
  email: string;
  jobTitle: string;
}

type ContactErrors = Partial<Record<"name" | "phone" | "email", string>>;

/**
 * Los contactos adicionales que ya trae el proveedor, en el orden del API.
 * Se arma con la misma forma que manda el formulario para que comparar con
 * lo capturado diga si cambiaron.
 */
function savedContactsOf(supplier: Supplier | undefined): SupplierContactInput[] {
  return (supplier?.contacts ?? []).map(({ name, phone, email, jobTitle }) => ({
    name,
    phone,
    email,
    jobTitle,
  }));
}

/**
 * F9-SUPPL-07 — alta y edición de proveedor en el MISMO formulario,
 * discriminado por la prop `supplier` (molde: `customer-form.tsx`, cambiando
 * persona por empresa). La etiqueta y el ejemplo del registro fiscal los
 * decide el país del negocio; al salir del campo el valor se normaliza para
 * que se VEA lo que se va a guardar, y si ya existe otro proveedor con ese
 * registro, avisa sin bloquear. La edición manda al PATCH solo lo que cambió.
 *
 * Carlos, 2026-10-31: arriba lo del proveedor (código, nombre, registro
 * fiscal, la dirección en los campos del país como Sucursales, los campos
 * propios y las notas) y abajo sus contactos. El Contacto 1 es el de siempre
 * (vive en las columnas del proveedor y lo muestra la lista) y suma «Puesto /
 * Cargo»; los adicionales se numeran desde el 2 y se renumeran al quitar uno.
 * El botón de agregar va en el encabezado de la sección, lejos de Guardar.
 */
export function SupplierForm({
  supplier,
  onDone,
  onCancel,
}: {
  supplier?: Supplier;
  onDone: (supplier?: Supplier) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const tenantCountry = useAuthStore((state) => state.user?.tenant.country ?? null);
  const [code, setCode] = useState(supplier?.code ?? "");
  const [name, setName] = useState(supplier?.name ?? "");
  const [taxId, setTaxId] = useState(supplier?.taxId ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [jobTitle, setJobTitle] = useState(supplier?.jobTitle ?? "");
  const initialPhone = phonePartsOf(supplier?.phone, tenantCountry);
  const [phoneCountry, setPhoneCountry] = useState(initialPhone.country);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.number);
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [addressLine2, setAddressLine2] = useState(supplier?.addressLine2 ?? "");
  const [city, setCity] = useState(supplier?.city ?? "");
  const [region, setRegion] = useState(supplier?.region ?? "");
  const [postalCode, setPostalCode] = useState(supplier?.postalCode ?? "");
  const setDireccion = {
    line1: setAddress,
    line2: setAddressLine2,
    city: setCity,
    region: setRegion,
    postalCode: setPostalCode,
  } as const;
  // El código postal se valida contra el país del NEGOCIO, como en Sucursales.
  const postalCodeError =
    postalCode.trim() !== "" && !isPostalCode(tenantCountry, postalCode)
      ? t("common.address.postalCodeInvalid", {
          example: resolveAddressFormat(tenantCountry).postalCodeExample ?? "",
        })
      : undefined;
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [extras, setExtras] = useState<ExtraContact[]>(() =>
    savedContactsOf(supplier).map((contact, index) => {
      const parts = phonePartsOf(contact.phone, tenantCountry);
      return {
        key: index,
        name: contact.name,
        phoneCountry: parts.country,
        phoneNumber: parts.number,
        email: contact.email ?? "",
        jobTitle: contact.jobTitle ?? "",
      };
    }),
  );
  // La siguiente identidad libre: quitar uno de en medio no la repite.
  const nextContactKey = useRef(extras.length);
  const contactsRef = useRef<HTMLDivElement>(null);
  const [focusContact, setFocusContact] = useState<number | null>(null);
  const contactsHeadingId = useId();
  const [errores, setErrores] = useState<Errores>({});
  const [contactErrors, setContactErrors] = useState<Record<number, ContactErrors>>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);
  // F9-SUPPCAT-06: los campos propios del catálogo `suppliers` (mismo motor que
  // almacenes). Se resuelve por `systemKey`, nunca por `isSystem`.
  const [attributes, setAttributes] = useState<Record<string, unknown>>(supplier?.attributes ?? {});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { data: catalogs } = useCatalogs();
  const suppliersCatalog = catalogs?.find((c) => c.systemKey === "suppliers");
  const { data: dynamicFields } = useCatalogFields(suppliersCatalog?.id);
  const hayCamposPropios = (dynamicFields ?? []).some((field) => !field.isArchived);
  // El registro fiscal que se COMPRUEBA contra otros (al salir del campo).
  const [fiscalComprobado, setFiscalComprobado] = useState<string | null>(supplier?.taxId ?? null);

  // El contacto recién agregado recibe el cursor en su nombre, para seguir tecleando.
  useEffect(() => {
    if (focusContact === null) return;
    contactsRef.current
      ?.querySelector<HTMLInputElement>(`[data-contact-key="${focusContact}"] input`)
      ?.focus();
    setFocusContact(null);
  }, [focusContact]);

  const schema = supplierFormSchema(tenantCountry);
  const abreviatura = taxIdLabel(tenantCountry);
  const etiquetaFiscal = abreviatura
    ? t("suppliers.form.taxIdWithAbbr", { abbr: abreviatura })
    : t("suppliers.form.taxId");
  const ejemploFiscal = taxIdExample(tenantCountry);

  const comprobarFiscal = () => {
    const normalizado = normalizeTaxId(tenantCountry, taxId);
    setTaxId(normalizado);
    setFiscalComprobado(normalizado === "" ? null : normalizado);
  };

  const lleno = extras.length >= SUPPLIER_EXTRA_CONTACTS_MAX;
  const agregarContacto = () => {
    if (lleno) return;
    const key = nextContactKey.current++;
    setExtras((previous) => [
      ...previous,
      {
        key,
        name: "",
        phoneCountry: tenantCountry ?? "",
        phoneNumber: "",
        email: "",
        jobTitle: "",
      },
    ]);
    setFocusContact(key);
  };
  const quitarContacto = (key: number) => {
    setExtras((previous) => previous.filter((contact) => contact.key !== key));
    setContactErrors(({ [key]: _quitado, ...resto }) => resto);
  };
  const cambiarContacto = (key: number, changes: Partial<ExtraContact>) =>
    setExtras((previous) =>
      previous.map((contact) => (contact.key === key ? { ...contact, ...changes } : contact)),
    );

  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const busy = createSupplier.isPending || updateSupplier.isPending;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorApi(null);
    setFieldErrors({});
    const parsed = schema.safeParse({
      code,
      name,
      taxId: normalizeTaxId(tenantCountry, taxId),
      contactName,
      jobTitle,
      email,
      address,
      notes,
    });
    const telefono = composeSupplierPhone(phoneCountry, phoneNumber);
    const nuevos: Errores = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0] as keyof Errores | undefined;
        if (campo && !nuevos[campo]) {
          nuevos[campo] =
            campo === "taxId"
              ? t(
                  ejemploFiscal === null
                    ? "suppliers.form.errors.taxIdNoExample"
                    : "suppliers.form.errors.taxId",
                  { example: ejemploFiscal ?? "" },
                )
              : t(issue.message);
        }
      }
    }
    if (telefono.error) {
      nuevos.phone = t(telefono.error);
    }
    setErrores(nuevos);

    // Los contactos adicionales: una fila sin ningún dato no viaja; una con
    // datos pide su nombre y revisa teléfono y correo como el contacto 1.
    const contactos: SupplierContactInput[] = [];
    const erroresDeContactos: Record<number, ContactErrors> = {};
    for (const extra of extras) {
      const vacio = [extra.name, extra.phoneNumber, extra.email, extra.jobTitle].every(
        (valor) => valor.trim() === "",
      );
      if (vacio) continue;
      const contacto = supplierContactSchema.safeParse({
        name: extra.name,
        email: extra.email,
        jobTitle: extra.jobTitle,
      });
      const telefonoContacto = composeSupplierPhone(extra.phoneCountry, extra.phoneNumber);
      const suyos: ContactErrors = {};
      if (!contacto.success) {
        for (const issue of contacto.error.issues) {
          const campo = issue.path[0] as keyof ContactErrors | undefined;
          if (campo && !suyos[campo]) suyos[campo] = t(issue.message);
        }
      }
      if (telefonoContacto.error) suyos.phone = t(telefonoContacto.error);
      if (!contacto.success || telefonoContacto.error) {
        erroresDeContactos[extra.key] = suyos;
        continue;
      }
      contactos.push({
        name: contacto.data.name,
        phone: telefonoContacto.phone,
        email: contacto.data.email || null,
        jobTitle: contacto.data.jobTitle || null,
      });
    }
    setContactErrors(erroresDeContactos);
    const contactosConError = Object.keys(erroresDeContactos).length > 0;

    if (!parsed.success || telefono.error || contactosConError || postalCodeError) {
      return;
    }

    const valores = parsed.data;
    // El resto de la dirección: vacío es «sin dato»; el CP, en su forma canónica.
    const direccion = {
      addressLine2: addressLine2.trim() || null,
      city: city.trim() || null,
      region: region || null,
      postalCode: postalCode.trim() ? normalizePostalCode(tenantCountry, postalCode) : null,
    };
    const onError = (apiError: ApiError) => {
      // Un error POR CAMPO se pinta bajo su input, no como mensaje suelto: los
      // campos propios y la región o el CP (el 422 de la dirección, como en
      // Sucursales). Si alguno no tiene dónde pintarse, el mensaje va arriba.
      const byField = fieldErrorsOf(apiError);
      setFieldErrors(Object.fromEntries([...byField].map(([key, msg]) => [key, t(msg)])));
      const conCampo = new Set<string>(["region", "postalCode"]);
      for (const field of dynamicFields ?? []) {
        if (!field.isArchived) conCampo.add(field.key);
      }
      if (byField.size === 0 || [...byField.keys()].some((key) => !conCampo.has(key))) {
        setErrorApi(apiError.message);
      }
    };

    if (!supplier) {
      const input: CreateSupplierInput = {
        ...(valores.code ? { code: valores.code } : {}),
        name: valores.name,
        ...(valores.taxId ? { taxId: valores.taxId } : {}),
        ...(valores.contactName ? { contactName: valores.contactName } : {}),
        ...(valores.jobTitle ? { jobTitle: valores.jobTitle } : {}),
        ...(telefono.phone ? { phone: telefono.phone } : {}),
        ...(valores.email ? { email: valores.email } : {}),
        ...(valores.address ? { address: valores.address } : {}),
        ...(direccion.addressLine2 ? { addressLine2: direccion.addressLine2 } : {}),
        ...(direccion.city ? { city: direccion.city } : {}),
        ...(direccion.region ? { region: direccion.region } : {}),
        ...(direccion.postalCode ? { postalCode: direccion.postalCode } : {}),
        ...(valores.notes ? { notes: valores.notes } : {}),
        // Con campos propios definidos viajan siempre: así el API exige los
        // requeridos y el error llega bajo el input correcto.
        ...(hayCamposPropios ? { attributes } : {}),
        ...(contactos.length > 0 ? { contacts: contactos } : {}),
      };
      createSupplier.mutate(input, { onSuccess: onDone, onError });
      return;
    }

    // Solo lo que cambió: vacío pasa a null (se limpia), igual no viaja.
    const cambios: UpdateSupplierInput = {};
    if (valores.code && valores.code !== supplier.code) cambios.code = valores.code;
    if (valores.name !== supplier.name) cambios.name = valores.name;
    const fiscal = valores.taxId || null;
    if (fiscal !== supplier.taxId) cambios.taxId = fiscal;
    const contacto = valores.contactName || null;
    if (contacto !== supplier.contactName) cambios.contactName = contacto;
    const puesto = valores.jobTitle || null;
    if (puesto !== (supplier.jobTitle ?? null)) cambios.jobTitle = puesto;
    if (telefono.phone !== supplier.phone) cambios.phone = telefono.phone;
    const correo = valores.email || null;
    if (correo !== supplier.email) cambios.email = correo;
    const calle = valores.address || null;
    if (calle !== supplier.address) cambios.address = calle;
    if (direccion.addressLine2 !== (supplier.addressLine2 ?? null)) {
      cambios.addressLine2 = direccion.addressLine2;
    }
    if (direccion.city !== (supplier.city ?? null)) cambios.city = direccion.city;
    if (direccion.region !== (supplier.region ?? null)) cambios.region = direccion.region;
    if (direccion.postalCode !== (supplier.postalCode ?? null)) {
      cambios.postalCode = direccion.postalCode;
    }
    const notas = valores.notes || null;
    if (notas !== supplier.notes) cambios.notes = notas;
    if (isActive !== supplier.isActive) cambios.isActive = isActive;
    if (JSON.stringify(attributes) !== JSON.stringify(supplier.attributes)) {
      cambios.attributes = attributes;
    }
    // `contacts` REEMPLAZA a todos los adicionales: viaja completo, y solo si cambió.
    if (JSON.stringify(contactos) !== JSON.stringify(savedContactsOf(supplier))) {
      cambios.contacts = contactos;
    }

    if (Object.keys(cambios).length === 0) {
      onDone();
      return;
    }
    updateSupplier.mutate({ id: supplier.id, input: cambios }, { onSuccess: onDone, onError });
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
        {/* F9-SUPPCAT-04: el código PRIMERO, como en los demás catálogos. Se
            sube a mayúsculas al teclear; vacío al crear = lo genera el API. */}
        <TextField
          label={t("suppliers.form.code")}
          value={code}
          hint={supplier ? undefined : t("suppliers.form.codeHint")}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
        />
        <TextField
          label={t("suppliers.form.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errores.name}
          required
        />
        <TextField
          label={etiquetaFiscal}
          value={taxId}
          onChange={(event) => setTaxId(event.target.value)}
          onBlur={comprobarFiscal}
          error={errores.taxId}
          hint={
            ejemploFiscal === null
              ? undefined
              : t("suppliers.form.taxIdHint", { example: ejemploFiscal })
          }
        />
      </div>
      <DuplicateSupplierCard taxId={fiscalComprobado} excludeId={supplier?.id} />
      {/* La dirección en los campos del país del negocio, igual que Sucursales
          y Mi perfil. Opcional; la que ya traía el proveedor es la calle. */}
      <AddressFields
        country={tenantCountry}
        value={{ line1: address, line2: addressLine2, city, region, postalCode }}
        onChange={(field, next) => setDireccion[field](next)}
        errors={{
          region: fieldErrors.region,
          postalCode: postalCodeError ?? fieldErrors.postalCode,
        }}
      />
      {/* Los campos propios del catálogo (p. ej. «Crédito máximo») son datos del
          proveedor: van con la dirección, antes de las notas. */}
      <DynamicForm
        fields={dynamicFields ?? []}
        values={attributes}
        errors={fieldErrors}
        onChange={(key, value) => setAttributes((previous) => ({ ...previous, [key]: value }))}
      />
      <TextField
        label={t("suppliers.form.notes")}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      {/* Solo al editar: un proveedor nuevo nace activo, no hay nada que decidir. */}
      {supplier && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="supplier-active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            <Label htmlFor="supplier-active">{t("suppliers.form.isActive")}</Label>
          </div>
          <p className="text-muted-foreground text-xs">{t("suppliers.form.isActiveHint")}</p>
        </div>
      )}
      <section
        aria-labelledby={contactsHeadingId}
        className="flex flex-col gap-4 border-t pt-4"
        ref={contactsRef}
      >
        {/* «Agregar contacto» arriba a la derecha del Contacto 1: lejos de
            Guardar y Cancelar, donde se busca al empezar la sección. */}
        <div className="flex items-center justify-between gap-2">
          <h2 id={contactsHeadingId} className="font-medium text-sm">
            {t("suppliers.form.contacts.title")}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregarContacto}
            disabled={busy || lleno}
          >
            <Plus aria-hidden="true" />
            {t("suppliers.form.contacts.add")}
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("suppliers.form.contacts.name", { number: 1 })}
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
          <TextField
            label={t("suppliers.form.jobTitle")}
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
          />
          <PhonePartsField
            countryLabel={t("suppliers.form.phoneCountry")}
            countryPlaceholder={t("suppliers.form.phoneCountryPlaceholder")}
            numberLabel={t("suppliers.form.phone")}
            country={phoneCountry}
            number={phoneNumber}
            onCountryChange={setPhoneCountry}
            onNumberChange={setPhoneNumber}
            numberError={errores.phone}
          />
          <TextField
            type="email"
            label={t("suppliers.form.email")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errores.email}
          />
        </div>
        {extras.map((extra, index) => {
          // El 1 es el principal: los adicionales empiezan en el 2.
          const numero = index + 2;
          const suyos = contactErrors[extra.key] ?? {};
          return (
            <div
              key={extra.key}
              data-contact-key={extra.key}
              className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3"
            >
              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                <TextField
                  label={t("suppliers.form.contacts.name", { number: numero })}
                  value={extra.name}
                  onChange={(event) => cambiarContacto(extra.key, { name: event.target.value })}
                  error={suyos.name}
                />
                <TextField
                  label={t("suppliers.form.jobTitle")}
                  value={extra.jobTitle}
                  onChange={(event) => cambiarContacto(extra.key, { jobTitle: event.target.value })}
                />
                <PhonePartsField
                  countryLabel={t("suppliers.form.phoneCountry")}
                  countryPlaceholder={t("suppliers.form.phoneCountryPlaceholder")}
                  numberLabel={t("suppliers.form.phone")}
                  country={extra.phoneCountry}
                  number={extra.phoneNumber}
                  onCountryChange={(next) => cambiarContacto(extra.key, { phoneCountry: next })}
                  onNumberChange={(next) => cambiarContacto(extra.key, { phoneNumber: next })}
                  numberError={suyos.phone}
                />
                <TextField
                  type="email"
                  label={t("suppliers.form.email")}
                  value={extra.email}
                  onChange={(event) => cambiarContacto(extra.key, { email: event.target.value })}
                  error={suyos.email}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("suppliers.form.contacts.remove", { number: numero })}
                title={t("suppliers.form.contacts.remove", { number: numero })}
                onClick={() => quitarContacto(extra.key)}
                disabled={busy}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </section>
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
