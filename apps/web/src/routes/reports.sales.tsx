import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import type { SalesFiltersInitial } from "@/components/reports/sales-filters";
import { SalesReport } from "@/components/reports/sales-report";

/**
 * F5-SALES-03 — las ventas del período.
 *
 * `reports:read` y no `pos:view`: el historial del POS es el mostrador y esta
 * pantalla es el análisis. Dos audiencias, dos permisos.
 */
function SalesReportRoute() {
  const search = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <SalesReport initialFilters={search} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

const fecha = z.iso.date();

/**
 * F10-KPI-12 — Ventas acepta `status`, `discounted`, `from` y `to` en la URL,
 * para llegar ya filtrada desde el panel, como `/reports/stock?belowMin=true`.
 *
 * `validateSearch` es la aduana: lo que venga en la URL es texto que escribió
 * cualquiera. Un valor inválido se descarta (la pantalla abre como siempre)
 * en vez de romper el render o mandarle al API algo que respondería 400.
 *
 * Devuelve las cuatro claves SIEMPRE, en `undefined` si no sirven: el router
 * mezcla lo validado ENCIMA de lo crudo de la URL, así que omitir una clave
 * dejaría pasar el valor inválido tal como llegó.
 */
function validateSalesSearch(search: Record<string, unknown>): SalesFiltersInitial {
  const desde = fecha.safeParse(search.from);
  const hasta = fecha.safeParse(search.to);
  return {
    status:
      search.status === "completed" || search.status === "canceled" ? search.status : undefined,
    discounted: search.discounted === true || search.discounted === "true" ? true : undefined,
    from: desde.success ? desde.data : undefined,
    to: hasta.success ? hasta.data : undefined,
  };
}

export const Route = createFileRoute("/reports/sales")({
  component: SalesReportRoute,
  validateSearch: validateSalesSearch,
});
