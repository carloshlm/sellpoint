import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { FieldForm, type FieldFormValues } from "@/components/catalog/field-form";
import { FieldList, ordenarCampos } from "@/components/catalog/field-list";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import type { CatalogField, CatalogSummary } from "@/lib/catalogs/api";
import {
  useCatalogFields,
  useCatalogs,
  useCreateCatalog,
  useCreateField,
  useRemoveField,
  useUpdateCatalog,
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
  // `recordCount: null` = todavía no se sabe si el campo tiene datos (primer
  // paso). Un número = el API ya dijo cuántos registros lo usan.
  const [pendingRemoval, setPendingRemoval] = useState<{
    field: CatalogField;
    recordCount: number | null;
  } | null>(null);

  // Sin selección explícita manda el primero, que el API ya devuelve con el
  // catálogo del sistema al frente.
  const catalogId = selectedId || catalogs?.[0]?.id || "";
  const catalog = catalogs?.find((item) => item.id === catalogId);
  const { data: fields } = useCatalogFields(catalogId || undefined);

  const createField = useCreateField(catalogId);
  const updateField = useUpdateField(catalogId);
  const removeField = useRemoveField(catalogId);

  // El mismo orden que el formulario de alta de cada entidad (Carlos,
  // 2026-08-24 y 2026-08-26): los estándar son POR CATÁLOGO del sistema —
  // el viejo ternario `isSystem ? [5 de producto]` mentía para almacenes y
  // servicios. Un subcatálogo solo trae su código.
  const standardLabelsBySystemKey: Record<string, string[]> = {
    products: [
      t("catalogs.standard.code"),
      t("catalogs.standard.name"),
      t("catalogs.standard.baseUnit"),
      t("catalogs.standard.cost"),
      t("catalogs.standard.price"),
    ],
    warehouses: [
      t("catalogs.standard.name"),
      t("catalogs.standard.address"),
      t("catalogs.standard.phone"),
      t("catalogs.standard.email"),
    ],
    services: [
      t("catalogs.standard.code"),
      t("catalogs.standard.name"),
      t("catalogs.standard.description"),
      t("catalogs.standard.cost"),
      t("catalogs.standard.price"),
    ],
  };
  const standardLabels = (catalog?.systemKey != null
    ? standardLabelsBySystemKey[catalog.systemKey]
    : undefined) ?? [t("catalogs.standard.code")];

  /**
   * Subir o bajar un campo (Carlos, 2026-08-24). Se calcula el orden DESEADO
   * y se persiste `position = índice` solo en las filas donde difiera — que
   * de paso SANEA los campos heredados que nacieron todos con `position: 0` y
   * hasta hoy se ordenaban por etiqueta. Secuencial a propósito: dos PATCH en
   * paralelo podrían aterrizar cruzados y dejar un empate nuevo.
   */
  async function moverCampo(field: CatalogField, direccion: -1 | 1) {
    const orden = ordenarCampos(fields ?? []);
    const desde = orden.findIndex((candidato) => candidato.id === field.id);
    const hasta = desde + direccion;
    if (desde === -1 || hasta < 0 || hasta >= orden.length) {
      return;
    }
    const deseado = [...orden];
    const [movido] = deseado.splice(desde, 1);
    if (movido === undefined) {
      return;
    }
    deseado.splice(hasta, 0, movido);

    for (const [indice, candidato] of deseado.entries()) {
      if (candidato.position !== indice) {
        await updateField.mutateAsync({ fieldId: candidato.id, input: { position: indice } });
      }
    }
  }

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

  /**
   * Quitar un campo pregunta SIEMPRE, en dos pasos:
   *
   * 1. Confirmación normal. Antes se llamaba al API de una: un campo sin datos
   *    se borraba de verdad al primer clic, sin preguntar nada.
   * 2. Si el API responde 409, el campo TIENE datos y no se borra sino que se
   *    oculta. Eso es información nueva —cuántos registros lo usan y que los
   *    valores se conservan—, así que el diálogo cambia de texto y se vuelve a
   *    preguntar. No es preguntar dos veces lo mismo: es otra pregunta.
   */
  function confirmRemoval(field: CatalogField, recordCount: number | null) {
    removeField.mutate(
      { fieldId: field.id, ...(recordCount === null ? {} : { confirm: true }) },
      {
        onSuccess: () => setPendingRemoval(null),
        onError: (error: ApiError) => {
          const count = (error as unknown as { recordCount?: number }).recordCount;
          if (error.statusCode === 409 && recordCount === null) {
            setPendingRemoval({ field, recordCount: count ?? 0 });
            return;
          }
          setPendingRemoval(null);
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
        {/* Renombrar solo aparece en los SUBcatálogos. El de sistema no lo
            muestra deshabilitado sino ausente — mismo criterio que los campos
            estándar: ofrecer algo que el servidor va a rechazar hace que el
            usuario descubra la regla a los golpes. */}
        {catalog !== undefined && !catalog.isSystem && <RenameCatalogButton catalog={catalog} />}
        <NewCatalogButton onCreated={(id) => setSelectedId(id)} />
      </div>

      {/* `min-w-0` en las tarjetas NO es decorativo: un ítem de grid tiene
          `min-width: auto`, o sea que se niega a encoger por debajo del ancho
          mínimo de su contenido. En un celular angosto eso ensancha la columna
          más allá de la pantalla y la tarjeta entera se sale del margen —era
          justo lo que se veía—. Con `min-w-0` la columna puede encoger y el
          `truncate` de adentro recién ahí tiene efecto. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="min-w-0 truncate">{t("catalogs.fields.title")}</CardTitle>
            {!creating && !editing && (
              <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>
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
              <ConfirmDialog
                data-testid="remove-field-dialog"
                title={t("catalogs.fields.removeDialog.title")}
                // Dos textos para dos situaciones distintas: sin datos el campo
                // se BORRA; con datos se oculta y sus valores se conservan.
                body={
                  pendingRemoval.recordCount === null
                    ? t("catalogs.fields.removeDialog.bodyEmpty", {
                        label: pendingRemoval.field.label,
                      })
                    : t("catalogs.fields.removeDialog.body", {
                        count: pendingRemoval.recordCount,
                        label: pendingRemoval.field.label,
                      })
                }
                confirmLabel={
                  pendingRemoval.recordCount === null
                    ? t("catalogs.fields.removeDialog.confirmEmpty")
                    : t("catalogs.fields.removeDialog.confirm")
                }
                cancelLabel={t("common.form.cancel")}
                busy={removeField.isPending}
                onCancel={() => setPendingRemoval(null)}
                onConfirm={() => confirmRemoval(pendingRemoval.field, pendingRemoval.recordCount)}
              />
            )}

            <FieldList
              fields={fields ?? []}
              catalogs={catalogs ?? []}
              canManage
              standardLabels={standardLabels}
              onMove={(field, direction) => void moverCampo(field, direction)}
              moving={updateField.isPending}
              onEdit={(field) => {
                setCreating(false);
                setFormError(null);
                setEditing(field);
              }}
              onRemove={(field) => setPendingRemoval({ field, recordCount: null })}
              onRestore={(field) =>
                updateField.mutate({ fieldId: field.id, input: { isArchived: false } })
              }
            />
          </CardContent>
        </Card>

        <Card className="min-w-0">
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

/**
 * Renombrar un subcatálogo (Carlos, 2026-08-24).
 *
 * El API ya lo permitía y ya protegía al de sistema con
 * `catalogs.system_cannot_be_renamed`; faltaba la pantalla — y
 * `useUpdateCatalog` existía sin que nadie lo llamara.
 */
function RenameCatalogButton({ catalog }: { catalog: CatalogSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(catalog.name);
  const [error, setError] = useState<string | null>(null);
  const updateCatalog = useUpdateCatalog();

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          // Se resiembra al ABRIR y no solo al montar: si el usuario cambia de
          // catálogo con el form cerrado, el nombre viejo quedaría cargado.
          // Es el patrón de estado espejo que costó el C1 de f1-web-users.
          setName(catalog.name);
          setError(null);
          setOpen(true);
        }}
      >
        {t("catalogs.schema.renameCatalog")}
      </Button>
    );
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        updateCatalog.mutate(
          { id: catalog.id, input: { name: name.trim() } },
          {
            onSuccess: () => setOpen(false),
            // El error del servidor NUNCA se traga y el form NO se cierra:
            // lección del confirm mudo de F3.
            onError: (apiError: ApiError) => setError(apiError.message),
          },
        );
      }}
    >
      <TextField
        label={t("catalogs.schema.catalogName")}
        value={name}
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" disabled={updateCatalog.isPending || !name.trim()}>
        {t("common.form.save")}
      </Button>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        {t("common.form.cancel")}
      </Button>
    </form>
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
