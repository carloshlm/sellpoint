import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SuppliersList } from "@/components/suppliers/suppliers-list";

export const Route = createFileRoute("/suppliers/")({
  component: SuppliersPage,
});

/**
 * F9-SUPPL-08 — «Proveedores», el catálogo compartido por Compras y Gastos.
 * Sin `suppliers:read` la pantalla NO existe (no se deshabilita). No hay
 * candado de módulo: proveedores es core; el enlace del menú es el que solo
 * aparece con Compras o Gastos.
 */
function SuppliersPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="suppliers:read">
            <SuppliersList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
