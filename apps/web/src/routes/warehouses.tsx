import {
  COUNTRY_DIAL_CODES,
  type CountryCode,
  ISO_COUNTRY_CODES,
  splitE164,
} from "@sellpoint/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ImportDialog } from "@/components/common/import-dialog";
import { PhonePartsField } from "@/components/form/phone-parts-field";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RowAction } from "@/components/ui/row-action";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { useCatalogFields, useCatalogs } from "@/lib/catalogs/hooks";
import { fieldErrorsOf } from "@/lib/field-errors";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";
import type { Warehouse } from "@/lib/warehouses/api";
import {
  useCreateWarehouse,
  useDeleteWarehouse,
  useUpdateWarehouse,
  useWarehouses,
} from "@/lib/warehouses/hooks";
import { downloadWarehouseImportTemplate, runWarehouseImport } from "@/lib/warehouses/import-api";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/warehouses")({
  component: WarehousesPage,
});

/** F2-WH-02/03 — lista y alta/edición de almacenes. */
function WarehousesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="warehouses:read">
            <WarehousesContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function WarehousesContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("warehouses:manage") && canWrite;
  const { data: warehouses, isPending } = useWarehouses();
  // Buscador (Carlos, 2026-09-01). Se filtra en el cliente: el API devuelve
  // los almacenes COMPLETOS sin paginar, así que pedirle al server que
  // busque sería un viaje de ida y vuelta por una lista que ya está aquí.
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visibles = (warehouses ?? []).filter(
    (warehouse) =>
      !needle ||
      warehouse.code.toLowerCase().includes(needle) ||
      warehouse.name.toLowerCase().includes(needle) ||
      (warehouse.address ?? "").toLowerCase().includes(needle),
  );
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const updateWarehouse = useUpdateWarehouse();
  const deleteWarehouse = useDeleteWarehouse();
  const [error, setError] = useState<string | null>(null);

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("warehouses.page.title")}</h1>
        {canManage && !creating && !editing && !importing && (
          <div className="flex gap-2">
            {/* Importar por Excel (Carlos, 2026-09-01): el mismo flujo de
                productos y servicios, match por código. */}
            <Button variant="outline" onClick={() => setImporting(true)}>
              {t("warehouses.import.button")}
            </Button>
            <Button onClick={() => setCreating(true)}>{t("warehouses.add")}</Button>
          </div>
        )}
      </header>

      {importing && (
        <ImportDialog
          testIdPrefix="warehouse-import"
          i18nPrefix="warehouses.import"
          downloadTemplate={downloadWarehouseImportTemplate}
          run={runWarehouseImport}
          invalidate={[["warehouses"]]}
          onClose={() => setImporting(false)}
        />
      )}

      {error && (
        <p
          role="alert"
          data-testid="warehouses-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("warehouses.page.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WarehouseForm
              key={editing?.id ?? "create"}
              warehouse={editing ?? undefined}
              onDone={() => {
                setEditing(null);
                setCreating(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="warehouse-search">{t("warehouses.search")}</Label>
        <Input
          id="warehouse-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("warehouses.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      {(warehouses ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="warehouses-empty">
          {t("warehouses.empty")}
        </p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="warehouses-no-matches">
          {t("warehouses.noMatches")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("warehouses.form.code")}</TableHead>
              <TableHead>{t("warehouses.form.name")}</TableHead>
              <TableHead>{t("warehouses.form.address")}</TableHead>
              <TableHead>{t("warehouses.status")}</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((warehouse) => {
              // F3-GUARDS-03, revisado (Carlos, 2026-08-25): el botón ya NO se
              // deshabilita. Deshabilitado tenía `pointer-events: none`, así
              // que el tooltip con el motivo no podía aparecer NUNCA — parecía
              // un botón muerto sin explicación. Ahora el `title` avisa al
              // hover, y si igual se hace clic, el 409 del server cuenta el
              // mismo motivo en el alert. Reactivar nunca se bloquea.
              const bloqueo =
                warehouse.isActive && warehouse.deactivationBlockedBy
                  ? t(
                      warehouse.deactivationBlockedBy === "stock"
                        ? "warehouses.blocked.stock"
                        : "warehouses.blocked.transfersInTransit",
                    )
                  : null;

              return (
                <TableRow key={warehouse.id} data-testid={`warehouse-${warehouse.id}`}>
                  <TableCell className="font-mono">{warehouse.code}</TableCell>
                  <TableCell className="font-medium">{warehouse.name}</TableCell>
                  <TableCell>{warehouse.address ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={warehouse.isActive ? "success" : "default"}>
                      {warehouse.isActive ? t("warehouses.active") : t("warehouses.inactive")}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <RowAction
                        intent="edit"
                        onClick={() => {
                          setCreating(false);
                          setEditing(warehouse);
                        }}
                      />
                      <RowAction
                        intent={warehouse.isActive ? "deactivate" : "reactivate"}
                        title={bloqueo ?? undefined}
                        onClick={() => {
                          setError(null);
                          updateWarehouse.mutate(
                            { id: warehouse.id, input: { isActive: !warehouse.isActive } },
                            { onError: (apiError: ApiError) => setError(apiError.message) },
                          );
                        }}
                      />
                      <RowAction
                        intent="delete"
                        onClick={() => {
                          setError(null);
                          setDeleting(warehouse);
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Eliminar de verdad solo aplica a un almacén que nunca operó: con
          historia el API contesta 409 (has_history) y la salida es
          desactivarlo. El error se muestra arriba, la fila no desaparece. */}
      {deleting && (
        <ConfirmDialog
          data-testid="delete-warehouse-dialog"
          title={t("warehouses.delete.title")}
          body={t("warehouses.delete.body", { name: deleting.name })}
          confirmLabel={t("warehouses.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={deleteWarehouse.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleteWarehouse.mutate(deleting.id, {
              onError: (apiError: ApiError) => setError(apiError.message),
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
    </div>
  );
}

/** El E.164 guardado, de vuelta a país + número (patrón de Datos del negocio). */
function phonePartsOf(
  phone: string | null | undefined,
  tenantCountry: string | null,
): { country: string; number: string } {
  if (phone) {
    const parts = splitE164(phone);
    if (parts) {
      const candidates = ISO_COUNTRY_CODES.filter(
        (code) => COUNTRY_DIAL_CODES[code] === parts.dialCode,
      );
      const matched = candidates.find((code) => code === tenantCountry);
      return { country: matched ?? candidates[0] ?? "", number: parts.nationalNumber };
    }
  }
  return { country: tenantCountry ?? "", number: "" };
}

function WarehouseForm({ warehouse, onDone }: { warehouse?: Warehouse; onDone: () => void }) {
  const { t } = useTranslation();
  // La respuesta visible al clic en «Editar»: el form entra a la vista y el
  // cursor queda en el primer campo (ver el docblock del hook).
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const tenantCountry = useAuthStore((state) => state.user?.tenant.country ?? null);
  const [code, setCode] = useState(warehouse?.code ?? "");
  const [name, setName] = useState(warehouse?.name ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const initialPhone = phonePartsOf(warehouse?.phone, tenantCountry);
  const [phoneCountry, setPhoneCountry] = useState(initialPhone.country);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.number);
  const [email, setEmail] = useState(warehouse?.email ?? "");
  const [attributes, setAttributes] = useState<Record<string, unknown>>(
    warehouse?.attributes ?? {},
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const isSubmitting = createWarehouse.isPending || updateWarehouse.isPending;

  // Los campos dinámicos del catálogo de sistema "warehouses" — por
  // systemKey, NUNCA `find(isSystem)`: hay tres catálogos del sistema.
  const { data: catalogs } = useCatalogs();
  const warehousesCatalog = catalogs?.find((c) => c.systemKey === "warehouses");
  const { data: dynamicFields } = useCatalogFields(warehousesCatalog?.id);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        const onError = (apiError: ApiError) => {
          const byField = fieldErrorsOf(apiError);
          if (byField.size > 0) {
            setFieldErrors(
              Object.fromEntries([...byField].map(([key, message]) => [key, t(message)])),
            );
            return;
          }
          setError(apiError.message);
        };

        // El canónico: dial del país + número sin espacios. Vacío = sin
        // teléfono (null en el PATCH; ausente en el POST).
        const digits = phoneNumber.replaceAll(" ", "").trim();
        const composedPhone =
          digits === "" ? null : `+${COUNTRY_DIAL_CODES[phoneCountry as CountryCode]}${digits}`;
        const trimmedEmail = email.trim();

        if (warehouse) {
          updateWarehouse.mutate(
            {
              id: warehouse.id,
              input: {
                code: code.trim(),
                name,
                address: address || null,
                phone: composedPhone,
                email: trimmedEmail === "" ? null : trimmedEmail,
                attributes,
              },
            },
            { onSuccess: onDone, onError },
          );
          return;
        }
        createWarehouse.mutate(
          {
            code: code.trim(),
            name,
            ...(address ? { address } : {}),
            ...(composedPhone !== null ? { phone: composedPhone } : {}),
            ...(trimmedEmail !== "" ? { email: trimmedEmail } : {}),
            attributes,
          },
          { onSuccess: onDone, onError },
        );
      }}
    >
      {error && (
        <p
          role="alert"
          data-testid="warehouse-form-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {/* El código estándar (Carlos, 2026-09-01): la llave visible del
          almacén y la del match de la importación. Obligatorio acá aunque el
          API lo genere si falta — quien captura a mano decide su código. */}
      <TextField
        label={t("warehouses.form.code")}
        hint={t("warehouses.form.codeHint")}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <TextField
        label={t("warehouses.form.name")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {/* Texto libre y opcional: los formatos postales difieren entre los 26
          mercados (MERCADOS.md § 4). */}
      <TextField
        label={t("warehouses.form.address")}
        hint={t("warehouses.form.addressHint")}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      {/* El contacto de la SUCURSAL (2026-08-26): el ticket lo pinta con
          fallback al dato del negocio. */}
      <PhonePartsField
        countryLabel={t("warehouses.form.phoneCountry")}
        countryPlaceholder={t("warehouses.form.phoneCountryPlaceholder")}
        numberLabel={t("warehouses.form.phone")}
        country={phoneCountry}
        number={phoneNumber}
        onCountryChange={setPhoneCountry}
        onNumberChange={setPhoneNumber}
      />
      <TextField
        label={t("warehouses.form.email")}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <DynamicForm
        fields={dynamicFields ?? []}
        values={attributes}
        errors={fieldErrors}
        onChange={(key, value) => setAttributes((previous) => ({ ...previous, [key]: value }))}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !name.trim() || !code.trim()}>
          {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
