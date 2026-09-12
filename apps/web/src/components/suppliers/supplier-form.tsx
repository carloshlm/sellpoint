import {
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  normalizeCode,
  normalizeTaxId,
  splitE164,
  taxIdExample,
  taxIdLabel,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { TextField } from "@/components/form/text-field";
import { DuplicateSupplierCard } from "@/components/suppliers/duplicate-supplier-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import { useCatalogFields, useCatalogs } from "@/lib/catalogs/hooks";
import { fieldErrorsOf } from "@/lib/field-errors";
import type { CreateSupplierInput, Supplier, UpdateSupplierInput } from "@/lib/suppliers/api";
import { useCreateSupplier, useUpdateSupplier } from "@/lib/suppliers/hooks";
import { composeSupplierPhone, supplierFormSchema } from "@/lib/suppliers/schemas";
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

/**
 * F9-SUPPL-07 — alta y edición de proveedor en el MISMO formulario,
 * discriminado por la prop `supplier` (molde: `customer-form.tsx`, cambiando
 * persona por empresa). La etiqueta y el ejemplo del registro fiscal los
 * decide el país del negocio; al salir del campo el valor se normaliza para
 * que se VEA lo que se va a guardar, y si ya existe otro proveedor con ese
 * registro, avisa sin bloquear. La edición manda al PATCH solo lo que cambió.
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
  const initialPhone = phonePartsOf(supplier?.phone, tenantCountry);
  const [phoneCountry, setPhoneCountry] = useState(initialPhone.country);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.number);
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [errores, setErrores] = useState<Errores>({});
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
    if (!parsed.success || telefono.error) {
      return;
    }

    const valores = parsed.data;
    const onError = (apiError: ApiError) => {
      // Un error POR CAMPO propio se pinta bajo su input, no como mensaje suelto.
      const byField = fieldErrorsOf(apiError);
      if (byField.size > 0) {
        setFieldErrors(Object.fromEntries([...byField].map(([key, msg]) => [key, t(msg)])));
        return;
      }
      setErrorApi(apiError.message);
    };

    if (!supplier) {
      const input: CreateSupplierInput = {
        ...(valores.code ? { code: valores.code } : {}),
        name: valores.name,
        ...(valores.taxId ? { taxId: valores.taxId } : {}),
        ...(valores.contactName ? { contactName: valores.contactName } : {}),
        ...(telefono.phone ? { phone: telefono.phone } : {}),
        ...(valores.email ? { email: valores.email } : {}),
        ...(valores.address ? { address: valores.address } : {}),
        ...(valores.notes ? { notes: valores.notes } : {}),
        // Con campos propios definidos viajan siempre: así el API exige los
        // requeridos y el error llega bajo el input correcto.
        ...(hayCamposPropios ? { attributes } : {}),
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
    if (telefono.phone !== supplier.phone) cambios.phone = telefono.phone;
    const correo = valores.email || null;
    if (correo !== supplier.email) cambios.email = correo;
    const direccion = valores.address || null;
    if (direccion !== supplier.address) cambios.address = direccion;
    const notas = valores.notes || null;
    if (notas !== supplier.notes) cambios.notes = notas;
    if (isActive !== supplier.isActive) cambios.isActive = isActive;
    if (JSON.stringify(attributes) !== JSON.stringify(supplier.attributes)) {
      cambios.attributes = attributes;
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
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("suppliers.form.contactName")}
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
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
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          type="email"
          label={t("suppliers.form.email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errores.email}
        />
        <TextField
          label={t("suppliers.form.address")}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>
      <TextField
        label={t("suppliers.form.notes")}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <DynamicForm
        fields={dynamicFields ?? []}
        values={attributes}
        errors={fieldErrors}
        onChange={(key, value) => setAttributes((previous) => ({ ...previous, [key]: value }))}
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
