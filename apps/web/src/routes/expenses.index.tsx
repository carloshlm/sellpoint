import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ExpensesList } from "@/components/expenses/expenses-list";
import { AppLayout } from "@/components/layout/app-layout";
import type { ExpensePaymentStatus } from "@/lib/expenses/api";

const PAGOS = ["pending", "paid"] as const satisfies readonly ExpensePaymentStatus[];

/**
 * F10-KPI-17 — el listado acepta `paymentStatus` en la URL, para llegar ya
 * filtrado desde el aviso del panel («2 gastos vencidos sin pagar»). Lo que
 * venga en la URL es texto de cualquiera: un valor inválido se descarta y la
 * pantalla abre como siempre. La clave va SIEMPRE, en `undefined` si no
 * sirve: el router mezcla lo validado encima de lo crudo de la URL.
 */
function validateExpensesSearch(search: Record<string, unknown>): {
  paymentStatus?: ExpensePaymentStatus;
} {
  const pago = z.enum(PAGOS).safeParse(search.paymentStatus);
  return { paymentStatus: pago.success ? pago.data : undefined };
}

export const Route = createFileRoute("/expenses/")({
  component: ExpensesPage,
  validateSearch: validateExpensesSearch,
});

/** F9-EXP-14 — «Gastos»: el listado con su resumen. Sin `expenses:read` la pantalla NO existe. */
function ExpensesPage() {
  const { paymentStatus } = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="expenses:read">
            <ExpensesList initialPaymentStatus={paymentStatus} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
