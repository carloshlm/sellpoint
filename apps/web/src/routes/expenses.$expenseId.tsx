import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ExpenseDetail } from "@/components/expenses/expense-detail";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExpense } from "@/lib/expenses/hooks";

export const Route = createFileRoute("/expenses/$expenseId")({
  component: ExpensePage,
});

/** F9-EXP-13 — la ficha del gasto; «Editar» abre el formulario en su lugar (`key` por gasto). */
function ExpensePage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="expenses:read">
            <ExpenseContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function ExpenseContent() {
  const { t } = useTranslation();
  const { expenseId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isPending, isError } = useExpense(expenseId);
  const [editando, setEditando] = useState(false);

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("common.form.loading")}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("expenses.detail.loadFailed")}
      </p>
    );
  }
  if (editando) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t("expenses.form.editTitle")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ExpenseForm
            key={data.id}
            expense={data}
            onDone={() => setEditando(false)}
            onCancel={() => setEditando(false)}
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        className="self-start text-primary text-sm hover:underline"
        onClick={() => navigate({ to: "/expenses" })}
      >
        ← {t("expenses.list.title")}
      </button>
      <ExpenseDetail expense={data} onEdit={() => setEditando(true)} />
    </div>
  );
}
