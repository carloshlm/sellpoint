import { formatMoney } from "@sellpoint/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useScopedCurrency } from "@/lib/admin/scope";
import { apiErrorMessage } from "@/lib/api-error-message";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import type { ClinicTopItem } from "@/lib/medical-clinic/api";
import { useClinicTop } from "@/lib/medical-clinic/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-CLINIC-WEB-26 — lo más vendido del consultorio, en el Panel.
 *
 * Tres listas y no una: qué RECETA el médico, qué laboratorio pide y qué
 * estudio de imagen manda son tres decisiones distintas, y el top general de
 * productos no responde ninguna —los estudios ni siquiera aparecen ahí, que
 * no son productos, y el medicamento se mezcla con lo que vende el mostrador.
 *
 * El API ya agrupa por id de catálogo y descarta las ventas anuladas
 * (F9-CLINIC-30): acá solo se pinta.
 */
export function ClinicTop({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { hasModule } = usePlan();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const puedeVer = hasModule("medical_clinic") && has("medical_clinic:read");
  const { data, error } = useClinicTop(period, puedeVer);

  if (!puedeVer) {
    return null;
  }

  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {apiErrorMessage(t, error, "medicalClinic.dashboard.error")}
      </p>
    );
  }

  if (data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

  return (
    <div data-testid="clinic-top" className="grid gap-3 lg:grid-cols-3">
      <Lista
        titulo={t("medicalClinic.dashboard.medications")}
        items={data.medications}
        dinero={dinero}
      />
      <Lista
        titulo={t("medicalClinic.dashboard.labStudies")}
        items={data.labStudies}
        dinero={dinero}
      />
      <Lista
        titulo={t("medicalClinic.dashboard.diagnosticStudies")}
        items={data.diagnosticStudies}
        dinero={dinero}
      />
    </div>
  );
}

function Lista({
  titulo,
  items,
  dinero,
}: {
  titulo: string;
  items: ClinicTopItem[];
  dinero: (valor: string) => string;
}) {
  const { t } = useTranslation();
  const tituloId = useId();

  return (
    <section
      aria-labelledby={tituloId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4"
    >
      <h2 id={tituloId} className="font-medium text-sm">
        {titulo}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.dashboard.empty")}</p>
      ) : (
        // Dos líneas por renglón, no cuatro columnas: son TRES listas lado a
        // lado, y en una columna de ~21rem el nombre, las unidades y el
        // importe en fila obligan a un scroll horizontal que corta justo los
        // números (verificado en el navegador a 1440, Carlos 2026-09-04).
        // Así el nombre manda y el dato va debajo, sin desbordar ni en móvil.
        <ol className="flex flex-col gap-2 text-sm">
          {items.map((item, i) => (
            <li key={item.id} className="flex min-w-0 items-baseline gap-2">
              <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("medicalClinic.dashboard.units", { count: Number(item.units) })} ·{" "}
                  {dinero(item.revenue)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
