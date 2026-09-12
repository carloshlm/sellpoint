import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RowAction } from "@/components/ui/row-action";
import { SuccessNotice } from "@/components/ui/success-notice";
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
import type { ExpenseCategory } from "@/lib/expenses/categories-api";
import {
  useCreateExpenseCategory,
  useExpenseCategories,
  useRemoveExpenseCategory,
  useUpdateExpenseCategory,
} from "@/lib/expenses/categories-hooks";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";

export const Route = createFileRoute("/expenses/categories")({
  component: ExpenseCategoriesPage,
});

/**
 * F9-EXP-03 — las categorías de gasto: las 18 de fábrica más las del negocio,
 * con formulario inline en tarjeta (molde: Servicios). Desactivar la esconde
 * del selector sin perder el historial; borrar una en uso rebota (409) y el
 * aviso lo dice.
 */
function ExpenseCategoriesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="expenses:read">
            <CategoriesContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function CategoriesContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("expenses:manage") && canWrite;

  const { data, isPending } = useExpenseCategories({ pageSize: 100 });
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null);
  // El nombre de la que se acaba de borrar: el éxito tiene que VERSE (Carlos, 2026-09-12).
  const [deleted, setDeleted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateCategory = useUpdateExpenseCategory();
  const removeCategory = useRemoveExpenseCategory();

  const rows = data?.rows ?? [];
  const cerrarForm = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("expenses.categories.title")}</h1>
        {canManage && !creating && !editing && (
          <Button
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            {t("expenses.categories.add")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t("expenses.categories.intro")}</p>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {deleted !== null && (
        <SuccessNotice testId="category-deleted">
          {t("expenses.categories.delete.done", { name: deleted })}
        </SuccessNotice>
      )}

      {(creating || editing) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t(editing ? "expenses.categories.editTitle" : "expenses.categories.createTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryForm
              key={editing?.id ?? "create"}
              category={editing ?? undefined}
              onDone={cerrarForm}
              onError={setError}
            />
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("expenses.categories.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("expenses.categories.columns.name")}</TableHead>
              <TableHead className="px-2">{t("expenses.categories.columns.code")}</TableHead>
              <TableHead className="px-2">{t("expenses.categories.columns.status")}</TableHead>
              {canManage && <TableHead className="px-2" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((category) => (
              <TableRow key={category.id} data-testid={`expense-category-${category.id}`}>
                <TableCell className="px-2 font-medium">{category.name}</TableCell>
                <TableCell className="px-2 font-mono text-muted-foreground">
                  {category.code}
                </TableCell>
                <TableCell className="px-2">
                  <Badge variant={category.isActive ? "success" : "default"}>
                    {t(
                      category.isActive
                        ? "expenses.categories.status.active"
                        : "expenses.categories.status.inactive",
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
                        setEditing(category);
                      }}
                    />
                    <RowAction
                      intent={category.isActive ? "deactivate" : "reactivate"}
                      disabled={updateCategory.isPending}
                      onClick={() => {
                        setError(null);
                        updateCategory.mutate(
                          { id: category.id, input: { isActive: !category.isActive } },
                          { onError: (apiError: ApiError) => setError(apiError.message) },
                        );
                      }}
                    />
                    <RowAction
                      intent="delete"
                      onClick={() => {
                        setError(null);
                        setDeleted(null);
                        setDeleting(category);
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
          title={t("expenses.categories.delete.title", { name: deleting.name })}
          body={t("expenses.categories.delete.body")}
          confirmLabel={t("expenses.categories.delete.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={removeCategory.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const objetivo = deleting;
            removeCategory.mutate(objetivo.id, {
              onSuccess: () => setDeleted(objetivo.name),
              onError: (apiError: ApiError) => setError(apiError.message),
              onSettled: () => setDeleting(null),
            });
          }}
        />
      )}
    </div>
  );
}

/** Alta y edición en el MISMO formulario: solo el nombre; el código se deriva al crear. */
function CategoryForm({
  category,
  onDone,
  onError,
}: {
  category?: ExpenseCategory;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const [name, setName] = useState(category?.name ?? "");
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const busy = createCategory.isPending || updateCategory.isPending;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const limpio = name.trim();
    if (limpio === "") return;
    const handlers = { onSuccess: onDone, onError: (e: ApiError) => onError(e.message) };
    if (category) {
      if (limpio === category.name) {
        onDone();
        return;
      }
      updateCategory.mutate({ id: category.id, input: { name: limpio } }, handlers);
      return;
    }
    createCategory.mutate({ name: limpio }, handlers);
  };

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("expenses.categories.form.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint={category ? undefined : t("expenses.categories.form.codeHint")}
          required
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {busy ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
