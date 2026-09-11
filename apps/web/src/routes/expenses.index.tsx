import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ExpensesList } from "@/components/expenses/expenses-list";
import { AppLayout } from "@/components/layout/app-layout";

export const Route = createFileRoute("/expenses/")({
  component: ExpensesPage,
});

/** F9-EXP-14 — «Gastos»: el listado con su resumen. Sin `expenses:read` la pantalla NO existe. */
function ExpensesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="expenses:read">
            <ExpensesList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
