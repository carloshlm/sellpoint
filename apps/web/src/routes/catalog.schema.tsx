import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { FieldForm, type FieldFormValues } from "@/components/catalog/field-form";
import { FieldList } from "@/components/catalog/field-list";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import type { CatalogField } from "@/lib/catalogs/api";
import {
  useCatalogFields,
  useCatalogs,
  useCreateCatalog,
  useCreateField,
  useRemoveField,
  useUpdateField,
} from "@/lib/catalogs/hooks";

export const Route = createFileRoute("/catalog/schema")({
  component: CatalogSchemaPage,
});

/**
 * F2-SCHEMA-01..05 — editor de campos de CUALQUIER catálogo.
 *
 * Sin versiones ni publicación: los cambios aplican al guardar cada campo
 * (decisión de Carlos, 2026-08-16). Las guardas viven en el API; acá se
 * anticipan para que el usuario entienda antes de chocar.
 */
function CatalogSchemaPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="catalogs:manage">
            <CatalogSchemaContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function CatalogSchemaContent() {
  const { t } = useTranslation();
  const { data: catalogs, isPending } = useCatalogs();
  const [selectedId, setSelectedId] = useState<string>("");
  const [editing, setEditing] = useState<CatalogField | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    field: CatalogField;
    recordCount: number;
  } | null>(null);

  // Sin selección explícita manda el primero, que el API ya devuelve con el
  // catálogo del sistema al frente.
  const catalogId = selectedId || catalogs?.[0]?.id || "";
  const catalog = catalogs?.find((item) => item.id === catalogId);
  const { data: fields } = useCatalogFields(catalogId || undefined);

  const createField = useCreateField(catalogId);
  const updateField = useUpdateField(catalogId);
  const removeField = useRemoveField(catalogId);

  const standardLabels = catalog?.isSystem
    ? [
        t("catalogs.standard.code"),
        t("catalogs.standard.name"),
        t("catalogs.standard.price"),
        t("catalogs.standard.cost"),
        t("catalogs.standard.baseUnit"),
      ]
    : [t("catalogs.standard.code")];

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setFormError(null);
  }

  function submitField(values: FieldFormValues) {
    setFormError(null);
    const payload = {
      label: values.label,
      fieldType: values.fieldType,
      required: values.required,
      ...(values.fieldType === "lookup" ? { lookupCatalogId: values.lookupCatalogId } : {}),
    };

    const onError = (error: ApiError) => setFormError(error.message);

    if (editing) {
      updateField.mutate(
        {
          fieldId: editing.id,
          input: {
            ...payload,
            // Salir de lookup exige limpiar el destino: el API valida el
            // estado resultante, no el delta.
            lookupCatalogId: values.fieldType === "lookup" ? values.lookupCatalogId : null,
          },
        },
        { onSuccess: closeForm, onError },
      );
      return;
    }

    createField.mutate(payload, { onSuccess: closeForm, onError });
  }

  function requestRemoval(field: CatalogField) {
    removeField.mutate(
      { fieldId: field.id },
      {
        onError: (error: ApiError) => {
          // 409 con el conteo: el campo tiene datos y hay que confirmar.
          const count = (error as unknown as { recordCount?: number }).recordCount;
          if (error.statusCode === 409) {
            setPendingRemoval({ field, recordCount: count ?? 0 });
            return;
          }
          setFormError(error.message);
        },
      },
    );
  }

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("catalogs.schema.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("catalogs.schema.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          className="min-w-64"
          label={t("catalogs.schema.selector")}
          value={catalogId}
          options={(catalogs ?? []).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(event) => {
            setSelectedId(event.target.value);
            closeForm();
          }}
        />
        <NewCatalogButton onCreated={(id) => setSelectedId(id)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("catalogs.fields.title")}</CardTitle>
            {!creating && !editing && (
              <Button size="sm" onClick={() => setCreating(true)}>
                {t("catalogs.fields.add")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(creating || editing) && (
              <FieldForm
                // `key` fuerza remount al cambiar de campo: sin esto el form
                // arrastraría los valores del anterior (lección C1 de
                // f1-web-users).
                key={editing?.id ?? "create"}
                field={editing ?? undefined}
                catalogs={catalogs ?? []}
                currentCatalogId={catalogId}
                isSubmitting={createField.isPending || updateField.isPending}
                error={formError}
                onSubmit={submitField}
                onCancel={closeForm}
              />
            )}

            {pendingRemoval && (
              <div
                role="alertdialog"
                aria-label={t("catalogs.fields.removeDialog.title")}
                data-testid="remove-field-dialog"
                className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3"
              >
                <p className="text-sm">
                  {t("catalogs.fields.removeDialog.body", {
                    count: pendingRemoval.recordCount,
                    label: pendingRemoval.field.label,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      removeField.mutate(
                        { fieldId: pendingRemoval.field.id, confirm: true },
                        { onSuccess: () => setPendingRemoval(null) },
                      );
                    }}
                  >
                    {t("catalogs.fields.removeDialog.confirm")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingRemoval(null)}>
                    {t("common.form.cancel")}
                  </Button>
                </div>
              </div>
            )}

            <FieldList
              fields={fields ?? []}
              catalogs={catalogs ?? []}
              canManage
              standardLabels={standardLabels}
              onEdit={(field) => {
                setCreating(false);
                setFormError(null);
                setEditing(field);
              }}
              onRemove={requestRemoval}
              onRestore={(field) =>
                updateField.mutate({ fieldId: field.id, input: { isArchived: false } })
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("catalogs.schema.preview")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">{t("catalogs.schema.previewHint")}</p>
            <TextField label={t("catalogs.standard.code")} disabled value="" />
            <DynamicForm fields={fields ?? []} values={{}} disabled onChange={() => {}} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** F2-SCHEMA-01: crear un subcatálogo sin salir del editor. */
function NewCatalogButton({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createCatalog = useCreateCatalog();

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("catalogs.schema.newCatalog")}
      </Button>
    );
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        createCatalog.mutate(
          { name },
          {
            onSuccess: (catalog) => {
              onCreated(catalog.id);
              setName("");
              setOpen(false);
            },
            onError: (apiError: ApiError) => setError(apiError.message),
          },
        );
      }}
    >
      <TextField
        label={t("catalogs.schema.newCatalogName")}
        value={name}
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" disabled={createCatalog.isPending || !name.trim()}>
        {t("common.form.save")}
      </Button>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        {t("common.form.cancel")}
      </Button>
    </form>
  );
}
