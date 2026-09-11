import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Expense } from "@/lib/expenses/api";

export const Route = createFileRoute("/expenses/new")({
  component: NewExpensePage,
});

/** F9-EXP-14 — alta de gasto en pantalla completa, en tarjeta; Guardar abre la ficha. */
function NewExpensePage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="expenses:manage">
            <NewExpenseContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewExpenseContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listado = () => navigate({ to: "/expenses" });
  const ficha = (expense?: Expense) =>
    expense === undefined
      ? listado()
      : navigate({ to: "/expenses/$expenseId", params: { expenseId: expense.id } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("expenses.form.createTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ExpenseForm onDone={ficha} onCancel={listado} />
      </CardContent>
    </Card>
  );
}
