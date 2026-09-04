import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import type { MedicalRecord } from "@/lib/medical-clinic/api";
import { FUNCTIONAL_SECTION_KEYS, sectionStatus } from "@/lib/medical-clinic/sections";

/**
 * F9-CLINIC-WEB-11 — el encabezado del expediente: quién es el paciente,
 * qué folio es y cuánto va capturado. Pegajoso en pantallas anchas para que
 * el médico no pierda de vista a quién está atendiendo.
 *
 * La edad la calcula el API contra la fecha de consulta (no contra hoy): el
 * expediente cuenta lo que pasó ese día. Aquí solo se pinta.
 */
export function RecordHeader({ record }: { record: MedicalRecord }) {
  const { t, i18n } = useTranslation();
  const done = FUNCTIONAL_SECTION_KEYS.filter(
    (key) => sectionStatus(record, key) === "completed",
  ).length;
  const total = FUNCTIONAL_SECTION_KEYS.length;
  const progreso = t("medicalClinic.record.progress", { done, total });
  const sex = record.patient.sex;

  const fila = (etiqueta: string, valor: React.ReactNode) => (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{etiqueta}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  );

  return (
    <Card data-testid="record-header" className="lg:sticky lg:top-0 lg:z-10">
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* La pantalla es «Historia clínica» (h1 de la ruta) y los h2 son los
              grupos del tablero: el paciente es un dato del encabezado, no
              una sección. */}
          <p className="font-semibold text-2xl">{record.patient.name}</p>
          <span className="font-mono text-muted-foreground text-sm">{record.folio}</span>
          {/* Abierta, Vencida o Cerrada: el motivo del candado manda sobre el status. */}
          <Badge variant={record.editable ? "success" : "default"}>
            {t(
              `medicalClinic.consultationStatus.${record.lockReason === "expired" ? "expired" : record.status}`,
            )}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {fila(
            t("medicalClinic.record.age"),
            record.patient.age === null
              ? "—"
              : t("medicalClinic.attend.years", { count: record.patient.age }),
          )}
          {fila(
            t("medicalClinic.record.sex"),
            sex ? (
              t(`medicalClinic.record.sexValues.${sex}`)
            ) : (
              <span className="flex flex-col">
                <span>—</span>
                <Link
                  to="/medical-clinic/records/$recordId/sections/$sectionKey"
                  params={{ recordId: record.id, sectionKey: "general_data" }}
                  className="text-primary text-xs underline-offset-2 hover:underline"
                >
                  {t("medicalClinic.record.missingSex")}
                </Link>
              </span>
            ),
          )}
          {fila(
            t("medicalClinic.record.birthDate"),
            record.patient.birthDate
              ? formatCalendarDate(record.patient.birthDate, i18n.language)
              : "—",
          )}
          {fila(
            t("medicalClinic.record.consultationDate"),
            formatCalendarDate(record.consultationDate, i18n.language),
          )}
          {fila(t("medicalClinic.record.doctor"), record.doctor.name)}
          {fila(
            t("medicalClinic.record.recordNumber"),
            <span className="font-mono">{record.folio}</span>,
          )}
        </dl>
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={progreso}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">{progreso}</p>
        </div>
      </CardContent>
    </Card>
  );
}
