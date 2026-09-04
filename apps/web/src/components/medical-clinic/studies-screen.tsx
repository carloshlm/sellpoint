import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StudyForm } from "@/components/medical-clinic/study-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { usePlan } from "@/lib/billing/use-plan";
import type { Study, StudyKind } from "@/lib/medical-clinic/api";
import { useRemoveStudy, useStudies, useUpdateStudy } from "@/lib/medical-clinic/hooks";
import { StudyImportDialog } from "./study-import-dialog";

/**
 * F9-CLINIC-WEB-04/05 — la pantalla de un catálogo de estudios. Una sola
 * para laboratorio y diagnóstico (prop `kind`): cambian el título, las
 * claves y el endpoint. Clon de Servicios SIN almacenes: el catálogo es del
 * negocio, no de una sucursal.
 */
export function StudiesScreen({ kind }: { kind: StudyKind }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("medical_clinic:manage") && canWrite;

  const [query, setQuery] = useState("");
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dep ES el filtro
  useEffect(() => {
    setPagina(1);
  }, [query]);
  const { data, isPending } = useStudies(kind, { query: query.trim() || undefined, page: pagina });
  const [editing, setEditing] = useState<Study | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Study | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const updateStudy = useUpdateStudy(kind);
  const removeStudy = useRemoveStudy(kind);

  const rows = data?.rows ?? [];
  const cerrarForm = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t(`medicalClinic.studies.${kind}.title`)}</h1>
        {canManage && !creating && !editing && (
          <div className="flex gap-2">
            {/* Mismo par de botones que Servicios: importar al lado de agregar. */}
            <Button variant="outline" onClick={() => setImportando(true)}>
              {t(`medicalClinic.studies.${kind}.import.title`)}
            </Button>
            <Button
              onClick={() => {
                setError(null);
                setCreating(true);
              }}
            >
              {t("medicalClinic.studies.add")}
            </Button>
          </div>
        )}
      </div>

      {importando && <StudyImportDialog kind={kind} onClose={() => setImportando(false)} />}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t(
                editing
                  ? "medicalClinic.studies.form.editTitle"
                  : "medicalClinic.studies.form.createTitle",
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StudyForm
              key={editing?.id ?? "create"}
              kind={kind}
              study={editing ?? undefined}
              onDone={cerrarForm}
              onError={(message) => setError(message || null)}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`study-search-${kind}`}>{t("medicalClinic.studies.search")}</Label>
        <Input
          id={`study-search-${kind}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("medicalClinic.studies.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="studies-empty" className="text-muted-foreground text-sm">
          {t("medicalClinic.studies.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("medicalClinic.studies.columns.code")}</TableHead>
              <TableHead className="px-2">{t("medicalClinic.studies.columns.name")}</TableHead>
              <TableHead className="px-2">{t("medicalClinic.studies.columns.cost")}</TableHead>
              <TableHead className="px-2">{t("medicalClinic.studies.columns.price")}</TableHead>
              <TableHead className="px-2">{t("medicalClinic.studies.columns.status")}</TableHead>
              {canManage && <TableHead className="px-2" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((study) => (
              <TableRow key={study.id} data-testid={`study-${study.id}`}>
                <TableCell className="px-2 font-mono">{study.code}</TableCell>
                <TableCell className="px-2 font-medium">{study.name}</TableCell>
                <TableCell className="px-2 tabular-nums">{study.cost ?? "—"}</TableCell>
                <TableCell className="px-2 tabular-nums">{study.price ?? "—"}</TableCell>
                <TableCell className="px-2">
                  <Badge variant={study.isActive ? "success" : "default"}>
                    {t(
                      study.isActive
                        ? "medicalClinic.studies.active"
                        : "medicalClinic.studies.inactive",
                    )}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="px-2 text-right whitespace-nowrap">
                    <RowAction
                      intent="edit"
                      onClick={() => {
                        setError(null);
                        setCreating(false);
                        setEditing(study);
                      }}
                    />
                    <RowAction
                      intent={study.isActive ? "deactivate" : "reactivate"}
                      onClick={() => {
                        setError(null);
                        updateStudy.mutate(
                          { id: study.id, input: { isActive: !study.isActive } },
                          { onError: (apiError: ApiError) => setError(apiError.message) },
                        );
                      }}
                    />
                    <RowAction
                      intent="delete"
                      onClick={() => {
                        setError(null);
                        setDeleting(study);
                      }}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {deleting && (
        <ConfirmDialog
          title={t("medicalClinic.studies.delete.title", { name: deleting.name })}
          body={t("medicalClinic.studies.delete.body")}
          confirmLabel={t("medicalClinic.studies.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={removeStudy.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            removeStudy.mutate(deleting.id, {
              onError: (apiError: ApiError) => setError(apiError.message),
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </div>
  );
}
