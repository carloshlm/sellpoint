import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DynamicForm } from "@/components/catalog/dynamic-form";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paginator } from "@/components/ui/paginator";
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
import type { CatalogField, CatalogRecord } from "@/lib/catalogs/api";
import {
  useCatalogFields,
  useCatalogRecords,
  useCatalogs,
  useCreateRecord,
  useDeleteRecord,
  useLookupOptions,
  useUpdateRecord,
} from "@/lib/catalogs/hooks";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";

export const Route = createFileRoute("/catalog/lists")({
  component: CatalogListsPage,
});

/**
 * F2-SUBCAT-01..03 — registros de los subcatálogos.
 *
 * Las COLUMNAS se generan de los campos del catálogo elegido: acá no hay una
 * sola columna hardcodeada, que es lo que hace que el mismo componente sirva a
 * "Unidad de Medida" y a "Proveedores" sin tocar código.
 */
function CatalogListsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="catalogs:read">
            <CatalogListsContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function CatalogListsContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canWrite = has("catalogs:write");
  const { data: catalogs, isPending } = useCatalogs();

  // Solo SUBCATÁLOGOS: los productos tienen su propia pantalla porque su tabla
  // es de primera clase (presentaciones, composición, stock).
  const subCatalogs = (catalogs ?? []).filter((catalog) => !catalog.isSystem);
  const [selectedId, setSelectedId] = useState("");
  const catalogId = selectedId || subCatalogs[0]?.id || "";

  const { data: fields } = useCatalogFields(catalogId || undefined);
  const [pagina, setPagina] = useState(1);
  // Cambiar de subcatálogo vuelve a la página 1.
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dep ES el filtro
  useEffect(() => {
    setPagina(1);
  }, [catalogId]);
  const { data: recordsPage } = useCatalogRecords(catalogId || undefined, pagina);
  const records = recordsPage?.rows;
  const [editing, setEditing] = useState<CatalogRecord | null>(null);
  const [creating, setCreating] = useState(false);

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  if (subCatalogs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("catalogs.records.title")}</h1>
        <p className="text-sm text-muted-foreground" data-testid="no-subcatalogs">
          {t("catalogs.records.noCatalogs")}
        </p>
      </div>
    );
  }

  const visibleFields = (fields ?? []).filter((field) => !field.isArchived);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("catalogs.records.title")}</h1>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelectField
          className="min-w-64"
          label={t("catalogs.records.selector")}
          value={catalogId}
          options={subCatalogs.map((catalog) => ({ value: catalog.id, label: catalog.name }))}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setEditing(null);
            setCreating(false);
          }}
        />
        {canWrite && !creating && !editing && (
          <Button onClick={() => setCreating(true)}>{t("catalogs.records.add")}</Button>
        )}
      </div>

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("catalogs.records.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordForm
              key={editing?.id ?? "create"}
              catalogId={catalogId}
              fields={visibleFields}
              record={editing ?? undefined}
              onDone={() => {
                setEditing(null);
                setCreating(false);
              }}
            />
          </CardContent>
        </Card>
      )}

      <RecordsTable
        fields={visibleFields}
        records={records ?? []}
        canWrite={canWrite}
        catalogId={catalogId}
        onEdit={(record) => {
          setCreating(false);
          setEditing(record);
        }}
      />

      <Paginator
        page={pagina}
        pageSize={recordsPage?.pageSize ?? 20}
        total={recordsPage?.total ?? 0}
        onPageChange={setPagina}
      />
    </div>
  );
}

function RecordsTable({
  fields,
  records,
  canWrite,
  catalogId,
  onEdit,
}: {
  fields: readonly CatalogField[];
  records: readonly CatalogRecord[];
  canWrite: boolean;
  catalogId: string;
  onEdit: (record: CatalogRecord) => void;
}) {
  const { t } = useTranslation();
  const updateRecord = useUpdateRecord(catalogId);
  const deleteRecord = useDeleteRecord(catalogId);
  const [deleting, setDeleting] = useState<CatalogRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="records-empty">
        {t("catalogs.records.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p
          role="alert"
          data-testid="records-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("catalogs.records.code")}</TableHead>
            {fields.map((field) => (
              <TableHead key={field.id}>{field.label}</TableHead>
            ))}
            <TableHead>{t("catalogs.records.status")}</TableHead>
            {canWrite && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id} data-testid={`record-${record.code}`}>
              <TableCell className="font-medium">{record.code}</TableCell>
              {fields.map((field) => (
                <TableCell key={field.id}>
                  {field.fieldType === "lookup" ? (
                    <LookupCell field={field} value={record.attributes[field.key]} />
                  ) : (
                    renderValue(record.attributes[field.key])
                  )}
                </TableCell>
              ))}
              <TableCell>
                <Badge variant={record.isActive ? "success" : "default"}>
                  {record.isActive ? t("catalogs.records.active") : t("catalogs.records.inactive")}
                </Badge>
              </TableCell>
              {canWrite && (
                <TableCell className="text-right">
                  <RowAction intent="edit" onClick={() => onEdit(record)} />
                  <RowAction
                    intent={record.isActive ? "deactivate" : "reactivate"}
                    onClick={() => {
                      setError(null);
                      updateRecord.mutate(
                        { recordId: record.id, input: { isActive: !record.isActive } },
                        {
                          // 409 cuando alguien lo referencia por lookup: se
                          // muestra el motivo, la fila NO desaparece.
                          onError: (apiError: ApiError) => setError(apiError.message),
                        },
                      );
                    }}
                  />
                  <RowAction
                    intent="delete"
                    onClick={() => {
                      setError(null);
                      setDeleting(record);
                    }}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Eliminar de verdad solo aplica a un registro que nadie referencia:
          el 409 (record_referenced) se muestra arriba y la fila no
          desaparece. Un typo libre sí se borra — no merece quedarse
          eternamente como "inactivo". */}
      {deleting && (
        <ConfirmDialog
          data-testid="delete-record-dialog"
          title={t("catalogs.records.delete.title")}
          body={t("catalogs.records.delete.body", { code: deleting.code })}
          confirmLabel={t("catalogs.records.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={deleteRecord.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleteRecord.mutate(deleting.id, {
              onError: (apiError: ApiError) => setError(apiError.message),
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
    </div>
  );
}

function RecordForm({
  catalogId,
  fields,
  record,
  onDone,
}: {
  catalogId: string;
  fields: readonly CatalogField[];
  record?: CatalogRecord;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  // La respuesta visible al clic en «Editar»: el form entra a la vista y el
  // cursor queda en el primer campo (ver el docblock del hook).
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const [code, setCode] = useState(record?.code ?? "");
  const [values, setValues] = useState<Record<string, unknown>>(record?.attributes ?? {});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const createRecord = useCreateRecord(catalogId);
  const updateRecord = useUpdateRecord(catalogId);
  const isSubmitting = createRecord.isPending || updateRecord.isPending;

  function handleError(apiError: ApiError) {
    // El API devuelve errores POR CAMPO; se pintan bajo cada input y no como
    // un mensaje suelto que obligue a adivinar cuál falló.
    const errors = (apiError as unknown as { errors?: { key: string; message: string }[] }).errors;
    if (errors?.length) {
      setFieldErrors(Object.fromEntries(errors.map((item) => [item.key, t(item.message)])));
      return;
    }
    setError(apiError.message);
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        const payload = { code, attributes: values };

        if (record) {
          updateRecord.mutate(
            { recordId: record.id, input: payload },
            { onSuccess: onDone, onError: handleError },
          );
          return;
        }
        createRecord.mutate(payload, { onSuccess: onDone, onError: handleError });
      }}
    >
      {error && (
        <p
          role="alert"
          data-testid="record-form-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <TextField
        label={t("catalogs.records.code")}
        hint={t("catalogs.records.codeHint")}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />

      <DynamicForm
        fields={fields}
        values={values}
        errors={fieldErrors}
        onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !code.trim()}>
          {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Una celda de lookup guarda el ID del registro destino; mostrarlo crudo sería
 * un UUID ilegible. Se resuelve a su código contra las opciones del catálogo
 * destino — react-query dedupe la consulta, así que todas las celdas de la
 * misma columna comparten UNA sola petición.
 */
function LookupCell({ field, value }: { field: CatalogField; value: unknown }) {
  const { data: options } = useLookupOptions(field.lookupCatalogId ?? undefined);

  if (typeof value !== "string") {
    return <>—</>;
  }

  const option = options?.find((item) => item.id === value);
  if (!option) {
    // Todavía cargando, o el destino se archivó: el código crudo no ayuda,
    // pero tampoco se inventa nada.
    return <>…</>;
  }

  return <>{option.code === option.display ? option.code : `${option.code} — ${option.display}`}</>;
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }
  return String(value);
}
