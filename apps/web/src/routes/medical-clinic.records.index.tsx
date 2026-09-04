import { localCalendarDate } from "@sellpoint/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { RecordsTable } from "@/components/medical-clinic/records-table";
import { Card, CardContent } from "@/components/ui/card";
import { Paginator } from "@/components/ui/paginator";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useRecords } from "@/lib/medical-clinic/hooks";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/medical-clinic/records/")({
  component: RecordsPage,
});

function RecordsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <RecordsContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F9-CLINIC-WEB-28 — el buscador de historias clínicas.
 *
 * Abre con las consultas de HOY —el día del negocio, en su zona— de la más
 * reciente a la más antigua, que es lo que el médico quiere ver al entrar. El
 * nombre y las fechas son filtros del usuario: los puede vaciar para ver todo.
 * El API ordena; aquí solo se pide y se pinta.
 */
function RecordsContent() {
  const { t } = useTranslation();
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone ?? "UTC");
  const [hoy] = useState(() => localCalendarDate(timeZone, new Date()));
  const [query, setQuery] = useState("");
  const termino = useDebouncedValue(query.trim());
  const [rango, setRango] = useState<RangoDeFechas>({ from: hoy, to: hoy });
  const [pagina, setPagina] = useState(1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: las deps SON los filtros
  useEffect(() => {
    setPagina(1);
  }, [termino, rango.from, rango.to]);

  const { data, error, isPending } = useRecords({
    query: termino || undefined,
    from: rango.from || undefined,
    to: rango.to || undefined,
    page: pagina,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("medicalClinic.history.title")}</h1>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("medicalClinic.history.search")}
            placeholder={t("medicalClinic.history.searchPlaceholder")}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <DateRangeFilter id="records" from={rango.from} to={rango.to} onChange={setRango} />
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {apiErrorMessage(t, error, "medicalClinic.history.loadFailed")}
        </p>
      ) : isPending || data === undefined ? (
        <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
      ) : data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("medicalClinic.history.empty")}</p>
      ) : (
        <>
          <RecordsTable rows={data.rows} showPatient />
          <Paginator
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPagina}
          />
        </>
      )}
    </div>
  );
}
