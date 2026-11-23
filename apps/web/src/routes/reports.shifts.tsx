import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { type ShiftsFiltersInitial, ShiftsReport } from "@/components/reports/shifts-report";

const fecha = z.iso.date();
const DIFERENCIAS = ["shortage", "overage", "balanced"] as const;

/**
 * F10-KPI-13 — Cierres de turno acepta `difference`, `from` y `to` en la URL,
 * para llegar ya filtrada (los turnos con faltante de la semana, por ejemplo).
 * Lo que venga en la URL es texto de cualquiera: un valor inválido se
 * descarta y la pantalla abre como siempre. Las tres claves van SIEMPRE, en
 * `undefined` si no sirven: el router mezcla lo validado encima de lo crudo.
 */
function validateShiftsSearch(search: Record<string, unknown>): ShiftsFiltersInitial {
  const diferencia = z.enum(DIFERENCIAS).safeParse(search.difference);
  const desde = fecha.safeParse(search.from);
  const hasta = fecha.safeParse(search.to);
  return {
    difference: diferencia.success ? diferencia.data : undefined,
    from: desde.success ? desde.data : undefined,
    to: hasta.success ? hasta.data : undefined,
  };
}

/**
 * F5-SHIFT-04 — los cierres de turno: cada turno con su arqueo. Misma llave
 * que las ventas (`reports:read`): es análisis, no mostrador.
 */
export const Route = createFileRoute("/reports/shifts")({
  component: ShiftsReportRoute,
  validateSearch: validateShiftsSearch,
});

function ShiftsReportRoute() {
  const search = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <ShiftsReport initialFilters={search} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
